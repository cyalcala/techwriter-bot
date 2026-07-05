// Captures the chat composer at desktop + mobile widths for before/after
// comparison of the UI refresh. Usage: node scripts/composer-shot.mjs <label>
// (label e.g. "before" or "after"). Follows the playwright-core + system
// Chrome pattern used by scripts/mobile-repro.mjs.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\admin\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core');
const fs = require('fs');

const label = process.argv[2] || 'shot';
const OUT = 'C:\\Users\\admin\\Downloads\\techwriter-bot\\output\\playwright\\composer-ui';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// Desktop
const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const dp = await desktop.newPage();
await dp.goto('https://tw-bot.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
await dp.waitForTimeout(2500);
await dp.locator('[aria-label="Chat input"]').click().catch(() => {});
await dp.waitForTimeout(300);
// Crop to the footer/composer region
const footer = dp.locator('footer').last();
await footer.screenshot({ path: `${OUT}\\${label}-desktop.png` }).catch(async () => {
  await dp.screenshot({ path: `${OUT}\\${label}-desktop.png` });
});
await desktop.close();

// Mobile
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
const mp = await mobile.newPage();
await mp.goto('https://tw-bot.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
await mp.waitForTimeout(2500);
await mp.screenshot({ path: `${OUT}\\${label}-mobile.png` });
await mobile.close();

await browser.close();
console.log('captured', label);
