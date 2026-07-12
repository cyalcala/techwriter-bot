// Re-implements the shipped sanitizeSvg logic (renderer-loader.ts) and verifies
// it in a real browser across: pure-SVG (DOMPurify), foreignObject (regex keeps
// labels), and the encoded-javascript: bypass that motivated the change.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\admin\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright-core');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newContext().then((c) => c.newPage());
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/dompurify@3.4.2/dist/purify.min.js' });

const results = await page.evaluate(() => {
  const DOMPurify = window.DOMPurify;
  function decodeEntitiesForUrlCheck(value) {
    return value
      .replace(/&#x([0-9a-f]+);?/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
      .replace(/&#(\d+);?/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ''; } })
      .replace(/&(?:tab|newline|lt|gt|amp|quot|apos|colon|NewLine|Tab);/gi, (m) => (/colon/i.test(m) ? ':' : ''))
      .replace(/[\s -]+/g, '');
  }
  const DANGEROUS_URL_RE = /^(?:javascript|vbscript|data):/i;
  function stripDangerousUrlAttrs(input) {
    return input.replace(/\s(href|src|xlink:href|xlink:src)\s*=\s*(?:(['"])([\s\S]*?)\2|([^\s>]+))/gi,
      (match, _attr, _q, quoted, bare) => {
        const raw = quoted !== undefined ? quoted : bare || '';
        const decoded = decodeEntitiesForUrlCheck(raw);
        if (DANGEROUS_URL_RE.test(decoded) && !/^data:image\//i.test(decoded)) return '';
        return match;
      });
  }
  function sanitizeHtml(html) {
    return stripDangerousUrlAttrs(html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<(iframe|object|embed|form|meta|link|base)[\s\S]*?<\/\1>/gi, '')
      .replace(/<(iframe|object|embed|form|meta|link|base)\b[^>]*\/?>/gi, '')
      .replace(/\son[\w:-]+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son[\w:-]+\s*=\s*'[^']*'/gi, '')
      .replace(/\son[\w:-]+\s*=\s*[^\s>]+/gi, ''));
  }
  function sanitizeSvg(svg) {
    if (typeof DOMPurify?.sanitize === 'function' && DOMPurify.isSupported && !/<foreignObject/i.test(svg)) {
      return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script','iframe','object','embed','form','meta','link','base'] });
    }
    return sanitizeHtml(svg);
  }

  const check = (name, svg, wantKeep, wantGone) => {
    const clean = sanitizeSvg(svg);
    const keep = wantKeep.every((s) => clean.includes(s));
    const gone = wantGone.every((s) => !new RegExp(s, 'i').test(clean));
    return { name, pass: keep && gone, keep, gone, sample: clean.slice(0, 120) };
  };

  const out = [];
  // 1) pure graphviz-style SVG through DOMPurify: keep text/path, drop script+onclick
  out.push(check('pure-svg-dompurify',
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/><text x="1" y="1">Node A</text><script>window.x=1</script><rect onclick="alert(1)" x="0" y="0"/></svg>',
    ['Node A', '<path', '<text'], ['<script', 'onclick', 'window.x=1']));
  // 2) foreignObject SVG through regex: keep label text + foreignObject, drop script/onclick
  out.push(check('foreignobject-regex-keeps-label',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Login Step</div></foreignObject><script>window.y=1</script><a onclick="x()">z</a></svg>',
    ['Login Step', 'foreignObject'], ['<script', 'onclick', 'window.y=1']));
  // 3) encoded javascript: URL bypass — the whole reason for the change
  out.push(check('encoded-js-url-stripped',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><a href="&#106;avascript:alert(1)">click</a></foreignObject></svg>',
    ['click'], ['javascript:', '&#106;avascript']));
  // 4) data:text/html stripped, data:image kept
  out.push(check('data-url-policy',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><a href="data:text/html,<b>x</b>">a</a><img src="data:image/png;base64,AAAA"/></foreignObject></svg>',
    ['data:image/png'], ['data:text/html']));
  return out;
});

let allPass = true;
for (const r of results) { if (!r.pass) allPass = false; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  keep=${r.keep} gone=${r.gone}`); }
console.log('\nVERDICT:', allPass ? 'PASS' : 'FAIL');
await browser.close();
process.exit(allPass ? 0 : 1);
