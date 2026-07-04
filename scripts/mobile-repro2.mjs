// Mobile interaction pass #2: diagram artifact flow, overlay, tools panel.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\admin\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core');

const OUT = 'C:\\Users\\admin\\Downloads\\techwriter-bot\\output\\playwright\\mobile-audit-2026-07-04';
const results = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], steps: [] };
function log(s) { results.steps.push(s); console.log('STEP:', s); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 360, height: 740 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') results.consoleErrors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => results.pageErrors.push(String(e).slice(0, 600)));
page.on('requestfailed', (r) => results.failedRequests.push({ url: r.url().slice(0, 200), failure: r.failure()?.errorText }));
page.on('response', (r) => { if (r.status() >= 400) results.badResponses.push({ url: r.url().slice(0, 200), status: r.status() }); });

log('navigate');
await page.goto('https://tw-bot.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);

// 1. Ask for a diagram (exercises kroki/artifact pipeline)
const input = page.locator('[aria-label="Chat input"]');
await input.click();
await input.fill('Create a simple mermaid flowchart diagram of a login flow');
await page.locator('button[aria-label="Send message"]').click();
log('diagram-request-sent');

// Wait up to 45s for an artifact chip or diagram to appear
let artifactAppeared = false;
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => {
    const chip = document.querySelector('[class*="artifact"], [data-artifact], button[aria-label*="artifact" i]');
    const svg = document.querySelector('.ai-content svg, [class*="diagram"] svg, img[src*="kroki"]');
    const streaming = document.body.innerText.includes('Thinking') || document.body.innerText.includes('...');
    return { chip: !!chip, svg: !!svg, textLen: document.body.innerText.length };
  });
  if (state.chip || state.svg) { artifactAppeared = true; log('artifact-appeared at ' + i + 's ' + JSON.stringify(state)); break; }
}
if (!artifactAppeared) log('no-artifact-after-45s');
await page.screenshot({ path: `${OUT}\\m4-diagram.png`, fullPage: false });

// Horizontal overflow check after diagram render
const overflow = await page.evaluate(() => ({
  bodyScrollWidth: document.body.scrollWidth, innerWidth: window.innerWidth,
}));
log('overflow ' + JSON.stringify(overflow));

// 2. Try to open artifact chip/overlay if present
const chipBtn = page.locator('button:has-text("View"), [class*="ChatArtifactChip"] button, button[class*="chip" i]').first();
if (await chipBtn.count() > 0) {
  await chipBtn.click().catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}\\m5-overlay.png` });
  log('overlay-attempted');
}

// 3. Open Tools panel
const toolsBtn = page.locator('button[aria-controls="document-tools-panel"]');
if (await toolsBtn.count() > 0) {
  await toolsBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}\\m6-tools.png` });
  log('tools-opened');
}

const fs = require('fs');
fs.writeFileSync(`${OUT}\\mobile-repro2-results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
