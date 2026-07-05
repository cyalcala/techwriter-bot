// Production smoke for RAG Phase 1: generate a REAL PDF (headless Chrome
// print) and a REAL DOCX (docx UMD lib), upload each to production, and
// verify the app extracts + indexes them and answers a grounded question.
// playwright-core + system Chrome (local astro dev/build are blocked here).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\admin\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core');
const fs = require('fs');
const path = require('path');

const OUT = 'C:\\Users\\admin\\Downloads\\techwriter-bot\\output\\playwright\\rag-doc-v1';
fs.mkdirSync(OUT, { recursive: true });
const PDF_PATH = path.join(OUT, 'sample.pdf');
const DOCX_PATH = path.join(OUT, 'sample.docx');
const results = { steps: [], consoleErrors: [], pageErrors: [] };
const log = (s) => { results.steps.push(s); console.log('STEP:', s); };

const BODY = 'Acme API authentication uses bearer tokens sent in the Authorization header. '
  + 'Tokens expire after 24 hours and must be refreshed via the /oauth/token endpoint. '
  + 'Rate limits are 100 requests per minute per key. Rotate API keys every quarter for security.';

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// 1. Real PDF via Chrome print-to-PDF (guaranteed extractable text)
{
  const p = await (await browser.newContext()).newPage();
  await p.setContent(`<html><body style="font:16px sans-serif;padding:40px"><h1>Acme API Guide</h1><p>${BODY}</p></body></html>`);
  const bytes = await p.pdf({ format: 'A4', printBackground: true });
  fs.writeFileSync(PDF_PATH, bytes);
  log('generated-pdf ' + bytes.length + ' bytes');
}

// 2. Real DOCX via docx UMD lib (best-effort — must not abort the PDF proof)
let docxReady = false;
try {
  const p = await (await browser.newContext()).newPage();
  await p.goto('about:blank');
  const cdns = [
    'https://unpkg.com/docx@8.5.0/build/index.umd.js',
    'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',
  ];
  let loaded = false;
  for (const url of cdns) { try { await p.addScriptTag({ url }); if (await p.evaluate(() => !!window.docx)) { loaded = true; break; } } catch {} }
  if (!loaded) throw new Error('docx lib did not load from any CDN');
  const b64 = await p.evaluate(async (body) => {
    const d = window.docx;
    const doc = new d.Document({ sections: [{ children: [
      new d.Paragraph({ text: 'Acme API Guide', heading: 'Heading1' }),
      new d.Paragraph({ text: body }),
    ] }] });
    const blob = await d.Packer.toBlob(doc);
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const byte of buf) s += String.fromCharCode(byte);
    return btoa(s);
  }, BODY);
  fs.writeFileSync(DOCX_PATH, Buffer.from(b64, 'base64'));
  docxReady = true;
  log('generated-docx ' + fs.statSync(DOCX_PATH).size + ' bytes');
} catch (e) {
  log('docx-generation-skipped: ' + String(e.message || e).slice(0, 120));
}

async function uploadAndAsk(label, filePath) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') results.consoleErrors.push(`${label}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => results.pageErrors.push(`${label}: ${String(e).slice(0, 300)}`));
  await page.goto('https://tw-bot.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  await page.locator('input[type=file]').first().setInputFiles(filePath);

  // Wait up to 60s for the "processed ... chunks indexed" confirmation
  let indexed = null;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    const txt = await page.evaluate(() => document.body.innerText);
    const m = txt.match(/processed[\s\S]{0,80}?(\d+)\s+chunks indexed/i);
    if (m) { indexed = Number(m[1]); log(`${label}-indexed ${indexed} chunks at ${i}s`); break; }
    if (/Upload failed|Unsupported|no readable text/i.test(txt)) { log(`${label}-upload-error: ${txt.slice(0,200)}`); break; }
  }
  results[`${label}_chunks`] = indexed;

  if (indexed) {
    const input = page.locator('[aria-label="Chat input"]');
    await input.click();
    await input.fill('According to the document, how long do tokens last and what is the rate limit?');
    await page.locator('button[aria-label="Send message"]').click();
    let answer = '';
    for (let i = 0; i < 45; i++) {
      await page.waitForTimeout(1000);
      answer = await page.evaluate(() => document.body.innerText);
      if (/24 hours|100 requests/i.test(answer)) break;
    }
    const grounded = /24 hours/i.test(answer) && /100 requests/i.test(answer);
    results[`${label}_grounded`] = grounded;
    log(`${label}-grounded-answer ${grounded}`);
  }
  await page.screenshot({ path: path.join(OUT, `${label}-result.png`), fullPage: false });
  await ctx.close();
}

try { await uploadAndAsk('pdf', PDF_PATH); } catch (e) { log('pdf-smoke-error: ' + String(e.message || e).slice(0, 160)); }
if (docxReady) { try { await uploadAndAsk('docx', DOCX_PATH); } catch (e) { log('docx-smoke-error: ' + String(e.message || e).slice(0, 160)); } }

fs.writeFileSync(path.join(OUT, 'rag-doc-smoke-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
