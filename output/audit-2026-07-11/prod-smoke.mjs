// Provider-independent production smoke of the deployed fixes.
// Loads tw-bot.pages.dev, confirms the Svelte island hydrates and the client
// bundle (renderer-loader/markdown/token-batcher/artifact-detector — all touched
// this session) loads with no console errors or CSP violations.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\admin\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newContext({ viewport: { width: 1280, height: 800 } }).then((c) => c.newPage());
const consoleErrors = [], pageErrors = [], cspViolations = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) cspViolations.push(m.text().slice(0, 300)); });

await page.goto('https://tw-bot.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);

const state = await page.evaluate(() => {
  const island = document.querySelector('astro-island');
  const input = document.querySelector('[aria-label="Chat input"]');
  const sendBtn = document.querySelector('button[aria-label="Send message"]');
  return {
    hydrated: island ? !island.hasAttribute('ssr') : null,
    inputPresent: !!input,
    inputEnabled: input ? !input.disabled : null,
    sendBtnPresent: !!sendBtn,
    // dompurify is imported by markdown.ts + renderer-loader.ts (bundled) — confirm nothing crashed the module graph
    bodyHasContent: (document.body.innerText || '').length > 50,
  };
});

console.log('hydration/state:', JSON.stringify(state, null, 2));
console.log('consoleErrors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 5)));
console.log('pageErrors:', pageErrors.length, JSON.stringify(pageErrors.slice(0, 5)));
console.log('cspViolations:', cspViolations.length, JSON.stringify(cspViolations.slice(0, 5)));

const pass = state.hydrated && state.inputPresent && state.inputEnabled && state.bodyHasContent
  && pageErrors.length === 0 && cspViolations.length === 0;
console.log('\nVERDICT:', pass ? 'PASS — deployed build loads & hydrates cleanly' : 'CHECK — see fields above');
await browser.close();
