import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const expand = (p) => resolve(p.startsWith('~/') ? join(os.homedir(), p.slice(2)) : p);

const playwrightPath = process.env.PLAYWRIGHT_PATH ? expand(process.env.PLAYWRIGHT_PATH) : 'playwright';

const { chromium } = require(playwrightPath);

if (!process.argv[2] || !process.argv[3]) {
  console.error('Usage: node scripts/verify-machines.mjs <office.html> <out-dir>');
  process.exit(1);
}
const htmlPath = expand(process.argv[2]);
const outDir = expand(process.argv[3]);

console.log('Testing Factory Office v4 machines proof in Playwright Chromium...');
console.log(`Target: file://${htmlPath}?factory=1`);
console.log(`Output: ${outDir}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const errors = [];
const nonDataRequests = [];

function attachPageListeners(page) {
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
    if (url.startsWith(`file://${htmlPath}`)) return;
    if (!url.startsWith('data:') && !url.startsWith('blob:')) {
      nonDataRequests.push(url);
      console.warn('[Network Request Detected]', url);
    }
  });
}

// 1. Desktop 1440x900 - All view
console.log('1. Capturing All view (1440x900)...');
const page1440 = await browser.newPage({
  viewport: { width: 1440, height: 900 },
});
attachPageListeners(page1440);

await page1440.goto(`file://${htmlPath}?factory=1`);
await page1440.waitForTimeout(2500);

const sAll = `${outDir}/v4-all-1440.png`;
await page1440.screenshot({ path: sAll });
console.log(`Saved screenshot: ${sAll}`);

// 2. Click laptop chip - laptop view 1440x900
console.log('2. Clicking laptop chip and capturing laptop view (1440x900)...');
const laptopChip = page1440.locator('.ui-machine-chip', { hasText: 'laptop' }).first();
await laptopChip.click();
await page1440.waitForTimeout(1000);

// Also open the sidebar to show filtered agents and drawer
const agentCard = page1440.locator('.ui-agent').first();
if (await agentCard.count() > 0) {
  await agentCard.click();
  await page1440.waitForTimeout(500);
}

const sLaptop = `${outDir}/v4-laptop-1440.png`;
await page1440.screenshot({ path: sLaptop });
console.log(`Saved screenshot: ${sLaptop}`);

// 3. Click desktop chip - offline view 1440x900
console.log('3. Clicking desktop chip and capturing offline view (1440x900)...');
const desktopChip = page1440.locator('.ui-machine-chip', { hasText: 'desktop' }).first();
await desktopChip.click();
await page1440.waitForTimeout(1000);

const sOffline = `${outDir}/v4-offline-1440.png`;
await page1440.screenshot({ path: sOffline });
console.log(`Saved screenshot: ${sOffline}`);

await page1440.close();

// 4. Mobile 390x844 - laptop view
console.log('4. Capturing laptop view on mobile (390x844)...');
const page390 = await browser.newPage({
  viewport: { width: 390, height: 844 },
});
attachPageListeners(page390);

await page390.goto(`file://${htmlPath}?factory=1&machine=laptop`);
await page390.waitForTimeout(2500);

const sMobile = `${outDir}/v4-laptop-390.png`;
await page390.screenshot({ path: sMobile });
console.log(`Saved screenshot: ${sMobile}`);

await page390.close();
await browser.close();

console.log('--- Verification Summary ---');
console.log(`Errors: ${errors.length}`);
console.log(`Non-data requests: ${nonDataRequests.length}`);

if (errors.length > 0) {
  console.error('FAIL: Console/page errors detected:');
  console.error(errors);
  process.exit(1);
}

if (nonDataRequests.length > 0) {
  console.warn('FAIL: Non-data requests detected:');
  console.warn(nonDataRequests);
  process.exit(1);
}

console.log('SUCCESS: All 4 screenshots taken with 0 errors and 0 network requests.');
