import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/melek-code/github/bakchich-monorepo/node_modules/playwright');

const htmlPath = resolve('/home/melek-code/factory-pages/proto-office/factory-office-v2.html');
const outDir = resolve('/home/melek-code/factory-pages/proto-office');

console.log('Testing Factory Office v2 standalone in Playwright Chromium...');
console.log(`Target: file://${htmlPath}`);

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
  } else {
    // console.log('[Browser Log]', msg.text());
  }
});

page.on('pageerror', (err) => {
  errors.push(err.message);
  console.error('[Page Error]', err);
});

page.on('request', (req) => {
  const url = req.url();
  if (url === `file://${htmlPath}`) return; // Root HTML navigation
  if (!url.startsWith('data:') && !url.startsWith('blob:')) {
    nonDataRequests.push(url);
    console.warn('[Network Request Detected]', url);
  }
});

// Navigate
await page.goto(`file://${htmlPath}`);

// Wait 3 seconds as required by the brief
console.log('Waiting 3 seconds...');
await page.waitForTimeout(3000);

// Screenshot 1: 1440 desktop overview
const s1440 = `${outDir}/v2-1440.png`;
await page.screenshot({ path: s1440 });
console.log(`Saved screenshot: ${s1440}`);

// Click a waiting agent to open drawer
console.log('Finding and clicking waiting agent...');
// Try clicking the waiting counter button or an agent in the sidebar
const waitingBtn = page.locator('.ui-counter--waiting');
if (await waitingBtn.isVisible()) {
  await waitingBtn.click();
} else {
  // Click agent 2b07 directly
  const agentRow = page.locator('text=2b07').first();
  await agentRow.click();
}

await page.waitForTimeout(1000);

// Screenshot 2: drawer open at 1440
const sDrawer = `${outDir}/v2-drawer-1440.png`;
await page.screenshot({ path: sDrawer });
console.log(`Saved screenshot: ${sDrawer}`);

// Mobile viewport 390
console.log('Switching to mobile viewport 390x844...');
const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const mobilePage = await mobileContext.newPage();
mobilePage.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
mobilePage.on('request', (req) => {
  const url = req.url();
  if (url === `file://${htmlPath}`) return; // Root HTML navigation
  if (!url.startsWith('data:') && !url.startsWith('blob:')) {
    nonDataRequests.push(url);
  }
});

await mobilePage.goto(`file://${htmlPath}`);
await mobilePage.waitForTimeout(3000);

// Screenshot 3: 390 mobile
const s390 = `${outDir}/v2-390.png`;
await mobilePage.screenshot({ path: s390 });
console.log(`Saved screenshot: ${s390}`);

await browser.close();

console.log('\n--- VERIFICATION REPORT ---');
console.log(`Console errors: ${errors.length}`);
if (errors.length > 0) {
  console.error('Errors:', errors);
}
console.log(`Non data/blob network requests: ${nonDataRequests.length}`);
if (nonDataRequests.length > 0) {
  console.error('Non-data requests:', nonDataRequests);
}

if (errors.length === 0 && nonDataRequests.length === 0) {
  console.log('SUCCESS: All checks passed with 0 console errors and 0 network requests!');
} else {
  process.exit(1);
}
