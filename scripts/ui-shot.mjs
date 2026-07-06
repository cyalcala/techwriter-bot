// Full-viewport UI screenshots (desktop + mobile) of the empty state and
// after opening the header overflow menu, for premium-UI verification.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\admin\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core');
const fs = require('fs');
const label = process.argv[2] || 'shot';
const OUT = 'C:\\Users\\admin\\Downloads\\techwriter-bot\\output\\playwright\\ui-modernize';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });

const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const dp = await desktop.newPage();
await dp.goto('https://tw-bot.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
await dp.waitForTimeout(2500);
await dp.screenshot({ path: `${OUT}\\${label}-desktop.png` });
// open overflow menu
await dp.locator('button[title="More"]').click().catch(() => {});
await dp.waitForTimeout(400);
await dp.screenshot({ path: `${OUT}\\${label}-desktop-menu.png` });
await desktop.close();

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const mp = await mobile.newPage();
await mp.goto('https://tw-bot.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
await mp.waitForTimeout(2500);
await mp.screenshot({ path: `${OUT}\\${label}-mobile.png` });
await mobile.close();

await browser.close();
console.log('captured', label);
