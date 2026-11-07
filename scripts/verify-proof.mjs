import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_PATH
  ? (process.env.PLAYWRIGHT_PATH.startsWith('~/')
      ? join(os.homedir(), process.env.PLAYWRIGHT_PATH.slice(2))
      : resolve(process.env.PLAYWRIGHT_PATH))
  : 'playwright';

const { chromium } = require(playwrightPath);

let rawHtml = process.argv[2] ?? 'dist/factory-office-v3.html';
if (rawHtml.startsWith('~/')) rawHtml = join(os.homedir(), rawHtml.slice(2));
const htmlPath = resolve(rawHtml);

let rawOut = process.argv[3] ?? 'dist';
if (rawOut.startsWith('~/')) rawOut = join(os.homedir(), rawOut.slice(2));
const outDir = resolve(rawOut);

console.log('Testing Factory Office v3 standalone in Playwright Chromium...');
console.log(`Target: file://${htmlPath}`);
console.log(`Output: ${outDir}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const errors = [];
const nonDataRequests = [];

const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
});

page.on('console', (msg) => {
  if (msg.type() === 'error') {
    errors.push(msg.text());
    console.error('[Browser Error]', msg.text());
  }
});

page.on('pageerror', (err) => {
  errors.push(err.message);
  console.error('[Page Error]', err);
});

page.on('request', (req) => {
  const url = req.url();
  if (url === `file://${htmlPath}`) return;
  if (!url.startsWith('data:') && !url.startsWith('blob:')) {
    nonDataRequests.push(url);
    console.warn('[Network Request Detected]', url);
  }
});

// Navigate
await page.goto(`file://${htmlPath}`);
await page.waitForTimeout(2500);

// Step 1: Open Inbox Tab in Sidebar
console.log('Clicking Inbox tab...');
const inboxTab = page.locator('button[data-view="inbox"], button:has-text("Inbox")').first();
await inboxTab.click();
await page.waitForTimeout(500);

// Screenshot 1: v3-inbox-1440.png
const sInbox = `${outDir}/v3-inbox-1440.png`;
await page.screenshot({ path: sInbox });
console.log(`Saved screenshot: ${sInbox}`);

// Step 2: Open an urgent item
console.log('Opening an urgent inbox item...');
const urgentCard = page.locator('.ui-inbox-card.is-urgent').first();
await urgentCard.click();
await page.waitForTimeout(500);

// Screenshot 2: v3-item-1440.png
const sItem = `${outDir}/v3-item-1440.png`;
await page.screenshot({ path: sItem });
console.log(`Saved screenshot: ${sItem}`);

// Step 3: Answer / Save the item
console.log('Saving / answering item...');
const saveBtn = page.locator('.ui-inbox-save-btn').first();
await saveBtn.click();
await page.waitForTimeout(500);

// Screenshot 3: v3-answered-1440.png
const sAnswered = `${outDir}/v3-answered-1440.png`;
await page.screenshot({ path: sAnswered });
console.log(`Saved screenshot: ${sAnswered}`);

// Step 4: Mobile viewport 390x844
console.log('Testing mobile viewport 390x844...');
const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const mobilePage = await mobileContext.newPage();
mobilePage.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
mobilePage.on('request', (req) => {
  const url = req.url();
  if (url === `file://${htmlPath}`) return;
  if (!url.startsWith('data:') && !url.startsWith('blob:')) {
    nonDataRequests.push(url);
  }
});

await mobilePage.goto(`file://${htmlPath}`);
await mobilePage.waitForTimeout(2500);

// Open sidebar on mobile if needed, click inbox
const mobileSidebarBtn = mobilePage.locator('.ui-btn-sidebar').first();
if (await mobileSidebarBtn.isVisible()) {
  await mobileSidebarBtn.click();
  await mobilePage.waitForTimeout(300);
}
const mobileInboxTab = mobilePage.locator('button[data-view="inbox"], button:has-text("Inbox")').first();
if (await mobileInboxTab.isVisible()) {
  await mobileInboxTab.click();
  await mobilePage.waitForTimeout(300);
}

// Screenshot 4: v3-inbox-390.png
const sMobile = `${outDir}/v3-inbox-390.png`;
await mobilePage.screenshot({ path: sMobile });
console.log(`Saved screenshot: ${sMobile}`);

await browser.close();

console.log('--- Verification Results ---');
console.log(`Console Errors: ${errors.length}`);
console.log(`Non-Data Requests: ${nonDataRequests.length}`);

if (errors.length > 0 || nonDataRequests.length > 0) {
  process.exit(1);
}
console.log('Verification PASSED!');
