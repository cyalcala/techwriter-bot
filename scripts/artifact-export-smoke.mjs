// Production smoke for Phase 2/3: generate a DOCUMENT artifact and a DECK
// in chat, verify each renders, and actually trigger downloads (PDF/DOCX
// for the document, PDF for the deck) — capturing the browser download
// events proves the client-side exporters run end-to-end. playwright-core
// + system Chrome. Local astro dev/build are blocked in this sandbox.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\admin\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core');
const fs = require('fs');
const path = require('path');

const OUT = 'C:\\Users\\admin\\Downloads\\techwriter-bot\\output\\playwright\\artifact-export-v1';
fs.mkdirSync(OUT, { recursive: true });
const results = { steps: [], consoleErrors: [], pageErrors: [], downloads: [] };
const log = (s) => { results.steps.push(s); console.log('STEP:', s); };

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function run(label, prompt, renderSelector, formatLabels) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') results.consoleErrors.push(`${label}: ${m.text().slice(0, 240)}`); });
  page.on('pageerror', (e) => results.pageErrors.push(`${label}: ${String(e).slice(0, 240)}`));
  await page.goto('https://tw-bot.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  const input = page.locator('[aria-label="Chat input"]');
  await input.click();
  await input.fill(prompt);
  await page.locator('button[aria-label="Send message"]').click();
  log(`${label}-sent`);

  let rendered = false;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000);
    rendered = await page.evaluate((sel) => !!document.querySelector(sel), renderSelector);
    if (rendered) { log(`${label}-rendered at ${i}s`); break; }
  }
  if (!rendered) { log(`${label}-NOT-rendered-after-90s`); await ctx.close(); return; }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${label}-rendered.png`), fullPage: false });

  // Open the download-format menu (the caret button) and trigger each format
  const dlBtn = page.locator('button[title="Download"][aria-haspopup="true"]').first();
  for (const fmt of formatLabels) {
    try {
      if (await dlBtn.count() === 0) { log(`${label}-no-download-menu`); break; }
      await dlBtn.click();
      await page.waitForTimeout(400);
      const item = page.locator(`[role="menuitem"]:has-text("${fmt}")`).first();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        item.click(),
      ]);
      const fname = download.suggestedFilename();
      const save = path.join(OUT, `${label}-${fname}`);
      await download.saveAs(save);
      const size = fs.statSync(save).size;
      results.downloads.push({ label, fmt, fname, size });
      log(`${label}-downloaded ${fname} (${size} bytes)`);
    } catch (e) {
      log(`${label}-download-${fmt}-failed: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  await ctx.close();
}

await run('document', 'Write a formatted report document about REST API pagination best practices with headings, bullet points, and a comparison table', '.document-artifact', ['PDF', 'Word', 'Markdown']);
await run('deck', 'Create a presentation about onboarding new engineers', '.deck-artifact', ['PDF', 'PowerPoint']);

fs.writeFileSync(path.join(OUT, 'artifact-export-smoke-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
