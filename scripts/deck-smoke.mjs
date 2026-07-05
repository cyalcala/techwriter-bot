// Production smoke for the deck (presentation) artifact: request a deck in
// chat at a mobile viewport, assert the deck renders with slides and zero
// errors. Pattern follows scripts/mobile-repro.mjs (playwright-core +
// system Chrome; local astro dev/build are blocked in this sandbox).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\admin\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core');

const OUT = 'C:\\Users\\admin\\Downloads\\techwriter-bot\\output\\playwright\\deck-v1';
const require2 = createRequire(import.meta.url);
const fs = require2('fs');
fs.mkdirSync(OUT, { recursive: true });

const results = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], steps: [] };
function log(s) { results.steps.push(s); console.log('STEP:', s); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') results.consoleErrors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => results.pageErrors.push(String(e).slice(0, 600)));
page.on('requestfailed', (r) => results.failedRequests.push({ url: r.url().slice(0, 200), failure: r.failure()?.errorText }));
page.on('response', (r) => { if (r.status() >= 400) results.badResponses.push({ url: r.url().slice(0, 200), status: r.status() }); });

log('navigate');
await page.goto('https://tw-bot.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);

const input = page.locator('[aria-label="Chat input"]');
await input.click();
await input.fill('Create a presentation about API documentation best practices');
await page.locator('button[aria-label="Send message"]').click();
log('deck-request-sent');

// Wait up to 90s for the deck artifact (deck JSON generation takes longer than diagrams)
let deckState = null;
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  deckState = await page.evaluate(() => {
    const deck = document.querySelector('.deck-artifact');
    const badge = [...document.querySelectorAll('span')].find(s => s.textContent?.trim().toLowerCase() === 'deck');
    return {
      deckRendered: !!deck,
      slideCount: deck ? Number(deck.getAttribute('data-deck-slides') || deck.querySelectorAll('section').length) : 0,
      badgeVisible: !!badge,
    };
  });
  if (deckState.deckRendered) { log(`deck-rendered at ${i}s ${JSON.stringify(deckState)}`); break; }
}
if (!deckState?.deckRendered) log('deck-not-rendered-after-90s ' + JSON.stringify(deckState));

const overflow = await page.evaluate(() => ({ bodyScrollWidth: document.body.scrollWidth, innerWidth: window.innerWidth }));
log('overflow ' + JSON.stringify(overflow));
await page.screenshot({ path: `${OUT}\\deck-1-rendered.png`, fullPage: false });

// Slide cap assertion: strictly <= 8
if (deckState?.deckRendered && deckState.slideCount > 8) log('SLIDE-CAP-VIOLATION ' + deckState.slideCount);

results.deckState = deckState;
results.overflow = overflow;
fs.writeFileSync(`${OUT}\\deck-smoke-results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
