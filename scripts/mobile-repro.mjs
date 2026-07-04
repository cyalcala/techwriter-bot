// Mobile reproduction harness for https://tw-bot.pages.dev/
// Uses cached playwright-core + system Chrome (channel: 'chrome'), emulating a phone.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\admin\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core');

const OUT = 'C:\\Users\\admin\\AppData\\Local\\Temp\\claude\\C--Users-admin-Downloads\\aa319702-84f8-486b-bfcf-172c1982fbdd\\scratchpad';
const results = { consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [], badResponses: [], steps: [] };

function log(step) { results.steps.push(step); console.log('STEP:', step); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
const page = await context.newPage();

page.on('console', (msg) => {
  const entry = { type: msg.type(), text: msg.text().slice(0, 500) };
  if (msg.type() === 'error') results.consoleErrors.push(entry);
  else if (msg.type() === 'warning') results.consoleWarnings.push(entry);
});
page.on('pageerror', (err) => results.pageErrors.push(String(err).slice(0, 800)));
page.on('requestfailed', (req) => results.failedRequests.push({ url: req.url(), failure: req.failure()?.errorText }));
page.on('response', (res) => { if (res.status() >= 400) results.badResponses.push({ url: res.url(), status: res.status() }); });

log('navigate');
await page.goto('https://tw-bot.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}\\m1-initial.png` });

// Is the island hydrated? The SSR input is <input>; hydrated ChatInput may be a textarea.
const inputInfo = await page.evaluate(() => {
  const island = document.querySelector('astro-island');
  const input = document.querySelector('input[aria-label="Chat input"], textarea[aria-label="Chat input"]');
  return {
    islandSsrAttr: island ? island.hasAttribute('ssr') : null,
    inputTag: input ? input.tagName : null,
    inputDisabled: input ? input.disabled : null,
    docHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  };
});
log('hydration-check ' + JSON.stringify(inputInfo));

// Try typing and sending
const input = page.locator('[aria-label="Chat input"]');
try {
  await input.tap({ timeout: 5000 });
} catch { await input.click({ timeout: 5000 }); }
await input.fill('Hello from mobile repro');
await page.screenshot({ path: `${OUT}\\m2-typed.png` });
const sendState = await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="Send message"]');
  return { found: !!btn, disabled: btn ? btn.disabled : null };
});
log('send-button ' + JSON.stringify(sendState));

if (sendState.found && !sendState.disabled) {
  await page.locator('button[aria-label="Send message"]').tap().catch(() => page.locator('button[aria-label="Send message"]').click());
  log('sent-message');
  await page.waitForTimeout(12000);
  await page.screenshot({ path: `${OUT}\\m3-after-send.png` });
}

// Check for horizontal overflow (classic mobile layout bug)
const overflow = await page.evaluate(() => ({
  bodyScrollWidth: document.body.scrollWidth,
  innerWidth: window.innerWidth,
  overflowing: document.body.scrollWidth > window.innerWidth + 1,
}));
log('overflow-check ' + JSON.stringify(overflow));

const fs = require('fs');
fs.writeFileSync(`${OUT}\\mobile-repro-results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
