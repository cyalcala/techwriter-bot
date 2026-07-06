// Verify the conversation view (post-greeting) after the empty-state change:
// send a message, confirm a response renders and per-message actions return.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\admin\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core');
const fs = require('fs');
const OUT = 'C:\\Users\\admin\\Downloads\\techwriter-bot\\output\\playwright\\ui-modernize';
fs.mkdirSync(OUT, { recursive: true });
const errors = [];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto('https://tw-bot.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
await page.locator('[aria-label="Chat input"]').fill('In one sentence, what is REST?');
await page.locator('button[aria-label="Send message"]').click();

let ok = false;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => {
    const groups = document.querySelectorAll('.msg-group');
    const bodyText = document.body.innerText;
    // action buttons present on a real assistant message (not the greeting)
    const hasActions = [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Copy');
    return { groups: groups.length, hasREST: /REST|Representational|API/i.test(bodyText), hasActions };
  });
  if (state.groups >= 2 && state.hasActions) { ok = state.hasREST; console.log('STEP: response rendered, groups=' + state.groups + ' actions=' + state.hasActions + ' answered=' + state.hasREST); break; }
}
await page.screenshot({ path: `${OUT}\\convo-check-desktop.png` });
console.log(JSON.stringify({ ok, consoleErrors: errors }));
await browser.close();
