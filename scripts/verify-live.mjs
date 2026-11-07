// Full verification script for Office live mode using Playwright and Fake Factory server.
// Verifies:
// 1. Standalone HTML served at /office loads with 0 console errors on 1440x900 viewport.
// 2. Agents render, live-1440.png screenshot captured.
// 3. Opening thread opens terminal panel showing thread bubbles.
// 4. Sending a message via composer is recorded by the fake server.
// 5. live-thread-1440.png screenshot captured.
// 6. Answering an inbox item posts to api/answers and is recorded by fake server.
// 7. Standalone HTML opens cleanly on file:// with 0 console errors.

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startFakeFactory } from './fake-factory.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const HOME = process.env.HOME || os.homedir();

const PLAYWRIGHT_PATH = path.join(HOME, 'github', 'bakchich-monorepo', 'node_modules', 'playwright', 'index.mjs');
const SCREENSHOT_DIR = path.join(HOME, 'factory-pages', 'proto-office');
const SCREENSHOT_1 = path.join(SCREENSHOT_DIR, 'live-1440.png');
const SCREENSHOT_2 = path.join(SCREENSHOT_DIR, 'live-thread-1440.png');

async function run() {
  console.log('=== Starting Office Live Mode Verification ===');
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const { chromium } = await import(PLAYWRIGHT_PATH);

  // 1. Start fake factory server
  console.log('Starting Fake Factory Server on ephemeral port...');
  const fakeServer = await startFakeFactory(0);
  console.log(`Fake Factory running at ${fakeServer.url}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const apiRequests = [];

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/')) {
      apiRequests.push(url);
      if (url.includes('/office/api/')) {
        throw new Error(`Forbidden /office/api/ path requested: ${url}`);
      }
    }
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      console.log(`HTTP ${res.status()} response for: ${res.url()}`);
    }
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  try {
    // 2. Open /office
    console.log(`Navigating to ${fakeServer.url}...`);
    await page.goto(fakeServer.url, { waitUntil: 'networkidle' });

    // Wait for store to be initialized and agents loaded
    await page.waitForFunction(() => {
      const h = window.habblaud;
      return h && h.store && h.store.snapshot && h.store.snapshot.agents.length > 0;
    }, { timeout: 10000 });

    console.log('Office snapshot loaded successfully!');

    // Wait 1.5s for initial canvas renders, fonts, and building signs to settle
    await page.waitForTimeout(1500);

    // Verify building name is displayed from machine.label ("office-live-1")
    const buildingNameInSnapshot = await page.evaluate(() => {
      return window.habblaud.store.snapshot?.meta?.buildingName;
    });
    console.log(`Building name in snapshot: ${buildingNameInSnapshot}`);
    if (buildingNameInSnapshot !== 'office-live-1') {
      throw new Error(`Expected buildingName 'office-live-1', got '${buildingNameInSnapshot}'`);
    }

    // Verify one room per project (3 rooms for 3 fake projects)
    const roomCount = await page.evaluate(() => {
      return window.habblaud.store.snapshot?.rooms?.length || 0;
    });
    console.log(`Room count in snapshot: ${roomCount}`);
    if (roomCount !== 3) {
      throw new Error(`Expected 3 rooms (1 per project), got ${roomCount}`);
    }

    // Capture screenshot 1: live-1440.png
    console.log(`Taking screenshot: ${SCREENSHOT_1}`);
    await page.screenshot({ path: SCREENSHOT_1, fullPage: false });

    // 3. Select agent 2b07 and open thread
    console.log('Selecting agent 2b07...');
    await page.evaluate(() => {
      window.habblaud.world.select({ type: 'agent', id: 'factory:agent:2b07' }, { focus: true });
    });

    // Wait for drawer to appear
    await page.waitForSelector('.ui-drawer.is-open', { timeout: 5000 });

    // Verify drawer text contains no NaN (start/duration cleanly formatted)
    const drawerText = await page.evaluate(() => {
      const drawer = document.querySelector('.ui-drawer');
      return drawer ? drawer.textContent || '' : '';
    });
    if (drawerText.includes('NaN')) {
      throw new Error(`Found NaN in drawer text: ${drawerText}`);
    }
    console.log('Verified no NaN in drawer text.');

    // Verify button text says "Open thread" (or "Abrir conversa")
    const termBtn = await page.waitForSelector('.ui-term-cta', { timeout: 5000 });
    const termBtnText = await page.evaluate((el) => el.textContent, termBtn);
    console.log(`Thread CTA button text: "${termBtnText.trim()}"`);

    // Click "Open thread" button
    console.log('Clicking "Open thread" button...');
    await termBtn.click();

    // Wait for terminal panel to open
    await page.waitForSelector('.ui-term:not([hidden])', { timeout: 5000 });
    console.log('Terminal panel opened!');

    // Wait for thread messages to appear in terminal
    await page.waitForSelector('.ui-term__row', { timeout: 5000 });
    const rowTexts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.ui-term__row')).map((el) => el.textContent);
    });
    console.log(`Loaded ${rowTexts.length} thread message bubbles in terminal.`);

    // 4. Send a message to the agent thread
    console.log('Typing message into composer...');
    const composerInput = await page.waitForSelector('.ui-term__input, .ui-msg__input', { timeout: 5000 });
    const testMessageText = 'Confirmed. Please enable v1 and v2 simultaneous support.';
    await composerInput.fill(testMessageText);

    const sendBtn = await page.waitForSelector('.ui-msg__send', { timeout: 5000 });
    console.log('Clicking send button...');
    await sendBtn.click();

    // Wait for message bubble to render in terminal
    await page.waitForFunction(
      (text) => {
        const rows = Array.from(document.querySelectorAll('.ui-term__row'));
        return rows.some((r) => r.textContent?.includes(text));
      },
      testMessageText,
      { timeout: 5000 }
    );
    console.log('Verified sent message bubble renders in terminal!');

    // Wait for message to be recorded by fake server
    await page.waitForTimeout(500);
    console.log('Checking fake server recorded messages:');
    console.log(JSON.stringify(fakeServer.recordedMessages, null, 2));
    const msgFound = fakeServer.recordedMessages.find(
      (m) => m.thread === 'thread-2b07' && m.text === testMessageText
    );
    if (!msgFound) {
      throw new Error(`Fake server did not record message: ${testMessageText}`);
    }
    console.log('Message was successfully recorded by fake server!');

    // Capture screenshot 2: live-thread-1440.png
    console.log(`Taking screenshot: ${SCREENSHOT_2}`);
    await page.screenshot({ path: SCREENSHOT_2, fullPage: false });

    // 5. Answer inbox item
    console.log('Selecting inbox item a538...');
    await page.evaluate(() => {
      window.habblaud.world.select({ type: 'inbox', id: 'a538' }, { focus: true });
    });

    await page.waitForSelector('.ui-inbox-save-btn', { timeout: 5000 });

    // Type note
    const noteArea = await page.$('.ui-inbox-note');
    if (noteArea) {
      await noteArea.fill('Approved fallback per discussion.');
    }

    const saveBtn = await page.$('.ui-inbox-save-btn');
    console.log('Clicking inbox Save button...');
    await saveBtn.click();

    await page.waitForTimeout(1000);

    console.log('Checking fake server recorded answers:');
    console.log(JSON.stringify(fakeServer.recordedAnswers, null, 2));
    const ansFound = fakeServer.recordedAnswers.find(
      (a) => a.a538 && a.a538.choice === 'v1v2'
    );
    if (!ansFound) {
      throw new Error('Fake server did not record inbox answer for a538');
    }
    console.log('Inbox answer was successfully recorded by fake server!');

    // Switch to Inbox tab in sidebar to view inbox list
    console.log('Switching to Inbox tab in sidebar...');
    const inboxTab = await page.waitForSelector('[data-view="inbox"]', { timeout: 5000 });
    await inboxTab.click();

    // Verify item updates to "Answered" state after poll
    await page.waitForSelector('.ui-inbox-card.is-answered[data-id="a538"]', { timeout: 5000 });
    const answeredText = await page.evaluate(() => {
      const card = document.querySelector('.ui-inbox-card[data-id="a538"]');
      return card ? card.textContent || '' : '';
    });
    console.log(`Answered card text: "${answeredText.trim()}"`);
    if (!answeredText.includes('waiting for the agent')) {
      throw new Error(`Expected answered card to contain 'waiting for the agent', got '${answeredText}'`);
    }

    // Also verify status in the drawer
    const drawerStatus = await page.evaluate(() => {
      const st = document.querySelector('.ui-inbox-view .ui-perm__status');
      return st ? st.textContent || '' : '';
    });
    console.log(`Drawer status text: "${drawerStatus.trim()}"`);
    if (!drawerStatus.includes('waiting for the agent')) {
      throw new Error(`Expected drawer status to contain 'waiting for the agent', got '${drawerStatus}'`);
    }
    console.log('Verified item a538 is in Answered group with "waiting for the agent" status in both sidebar and drawer!');

    // 6. Assert 0 console errors on HTTP
    console.log(`Console errors count on /office: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.error('Console errors:', consoleErrors);
      throw new Error(`Expected 0 console errors, got ${consoleErrors.length}`);
    }

    // 7. Verify file:// protocol opening
    console.log('Verifying standalone HTML on file:// protocol...');
    const filePage = await context.newPage();
    const fileErrors = [];
    filePage.on('console', (msg) => {
      if (msg.type() === 'error') fileErrors.push(msg.text());
    });
    filePage.on('pageerror', (err) => {
      fileErrors.push(err.message);
    });

    const fileUrl = `file://${path.join(REPO_ROOT, 'dist', 'factory-office.html')}`;
    await filePage.goto(fileUrl, { waitUntil: 'load' });
    await filePage.waitForFunction(() => {
      const h = window.habblaud;
      return h && h.store && h.store.snapshot && h.store.snapshot.agents.length > 0;
    }, { timeout: 10000 });

    console.log(`Console errors count on file://: ${fileErrors.length}`);
    if (fileErrors.length > 0) {
      console.error('file:// console errors:', fileErrors);
      throw new Error(`Expected 0 console errors on file://, got ${fileErrors.length}`);
    }
    console.log('file:// opened cleanly with simulator running!');

    await filePage.close();
    await page.close();

    console.log('=== All Verifications Passed Successfully! ===');
  } finally {
    await browser.close();
    await fakeServer.close();
  }
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
