// Diagnostic: request several decks; when one shows "renderer unavailable",
// capture the RAW artifact source (the JSON the model produced) + console
// errors so we can see exactly why repairDeckSpec rejected it.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\admin\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core');
const fs = require('fs');
const OUT = 'C:\\Users\\admin\\AppData\\Local\\Temp\\claude\\C--Users-admin-Downloads\\933f71f7-11d0-4862-b555-0a945ee88fa3\\scratchpad';
fs.mkdirSync(OUT, { recursive: true });

// Longer/richer topics are likelier to overflow the token budget and
// truncate — the suspected failure mode. Repeat to catch intermittency.
const BASE = [
  'Create a detailed presentation about Kubernetes architecture, networking, storage, security, and observability with specific examples',
  'Make a comprehensive pitch deck for an enterprise developer platform covering problem, solution, market, product, pricing, roadmap, and team',
  'Create a thorough slide deck comparing microservices vs monoliths across scaling, deployment, testing, cost, and team structure with examples',
];
const PROMPTS = [...BASE, ...BASE, ...BASE];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];

for (const prompt of PROMPTS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  await page.goto('https://tw-bot.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.locator('[aria-label="Chat input"]').fill(prompt);
  await page.locator('button[aria-label="Send message"]').click();

  let outcome = 'timeout';
  let raw = '';
  for (let i = 0; i < 70; i++) {
    await page.waitForTimeout(1000);
    const st = await page.evaluate(() => {
      const deck = document.querySelector('.deck-artifact');
      const errBox = document.body.innerText.includes('renderer unavailable') || document.body.innerText.includes('Deck renderer');
      const badge = [...document.querySelectorAll('span')].some(s => s.textContent.trim().toLowerCase() === 'deck');
      return { deck: !!deck, errBox, badge };
    });
    if (st.deck) { outcome = 'rendered'; break; }
    if (st.errBox && st.badge) {
      outcome = 'error';
      // Try to read the raw artifact source: click the "Code" tab, read the <pre>
      try {
        const codeBtn = page.locator('button:has-text("Code")').first();
        if (await codeBtn.count()) { await codeBtn.click(); await page.waitForTimeout(400); }
      } catch {}
      raw = await page.evaluate(() => {
        const pre = document.querySelector('.artifact-code-scroll pre, pre code, pre');
        return pre ? pre.textContent : '';
      });
      break;
    }
  }
  results.push({ prompt, outcome, consoleErrors, rawLen: raw.length, raw: raw.slice(0, 4000) });
  console.log(`PROMPT: ${prompt}\n  -> ${outcome}${outcome === 'error' ? ' (rawLen ' + raw.length + ')' : ''}`);
  await ctx.close();
}

fs.writeFileSync(`${OUT}\\deck-diag.json`, JSON.stringify(results, null, 2));
await browser.close();
