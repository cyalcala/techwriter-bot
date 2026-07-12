import DOMPurify from 'dompurify';
import type { ArtifactType } from './stream-parser';
import { formatArtifactRendererError } from './artifact-error-boundary';
import { repairDeckSpec, type DeckSlide, type DeckSpec } from './deck-schema';
import { repairDocSpec, type DocBlock, type DocSpec } from './doc-schema';
import { normalizeArtifactSource, normalizeMermaidSource } from './diagram-source-normalizer';
import { KROKI_RENDERABLE } from './kroki-renderer';

const loadedScripts = new Set<string>();
const loadedStyles = new Set<string>();
const loadingScripts = new Map<string, Promise<void>>();
const loadingStyles = new Map<string, Promise<void>>();
const LOAD_TIMEOUT_MS = 12_000;

function loadScript(src: string): Promise<void> {
  if (loadedScripts.has(src)) return Promise.resolve();
  const pending = loadingScripts.get(src);
  if (pending) return pending;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      loadingScripts.delete(src);
      script.remove();
      reject(new Error(`Timed out loading ${src}`));
    }, LOAD_TIMEOUT_MS);
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.src = src;
    script.onload = () => {
      clearTimeout(timer);
      loadedScripts.add(src);
      loadingScripts.delete(src);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      loadedScripts.delete(src);
      loadingScripts.delete(src);
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });
  loadingScripts.set(src, promise);
  return promise;
}

function loadStyle(href: string): Promise<void> {
  if (loadedStyles.has(href)) return Promise.resolve();
  const pending = loadingStyles.get(href);
  if (pending) return pending;
  const promise = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    const timer = setTimeout(() => {
      loadingStyles.delete(href);
      link.remove();
      reject(new Error(`Timed out loading ${href}`));
    }, LOAD_TIMEOUT_MS);
    link.rel = 'stylesheet';
    link.crossOrigin = 'anonymous';
    link.referrerPolicy = 'no-referrer';
    link.href = href;
    link.onload = () => {
      clearTimeout(timer);
      loadedStyles.add(href);
      loadingStyles.delete(href);
      resolve();
    };
    link.onerror = () => {
      clearTimeout(timer);
      loadingStyles.delete(href);
      link.remove();
      reject(new Error(`Failed to load ${href}`));
    };
    document.head.appendChild(link);
  });
  loadingStyles.set(href, promise);
  return promise;
}

// For feature modules (e.g. deck PPTX export) that lazy-load CSP-allowed CDN libs
export function loadExternalScript(src: string): Promise<void> {
  return loadScript(src);
}

export function preloadPopular(): void {
  if (typeof window === 'undefined') return;
  const schedule = window.requestIdleCallback || ((cb: IdleRequestCallback) => window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 1500));
  schedule(() => {
    Promise.allSettled([
      loadStyle('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css'),
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js'),
    ]).catch(() => {});
  });
}

export async function loadRenderer(type: ArtifactType): Promise<void> {
  switch (type) {
    case 'code':
      await Promise.all([
        loadStyle('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css'),
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js'),
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js'),
      ]);
      return;
    case 'mermaid':
      return;
    case 'katex':
      await Promise.all([
        loadStyle('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css'),
        loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js'),
      ]);
      return;
    case 'markmap':
      await loadScript('https://cdn.jsdelivr.net/npm/markmap-autoloader@0.17.0/dist/index.js');
      return;
    case 'd2':
      return;
    case 'vega':
      return;
    case 'graphviz':
      return;
    case 'plantuml':
      return;
    case 'flowchart':
      return;
    case 'svg':
    case 'html':
    case 'react':
    case 'deck':
    case 'document':
      return;
    default:
      if (KROKI_RENDERABLE.has(type as string)) return;
      throw new Error(`Unsupported artifact type: ${type}`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Render timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}

function domReady(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

export function renderCodeArtifact(code: string, language?: string): string {
  const lang = safeClassName(language || detectLanguage(code));
  if (window.Prism) {
    const highlighted = window.Prism.highlight(code, window.Prism.languages[lang] || window.Prism.languages.plaintext, lang);
    return `<pre class="language-${lang}" style="margin:0;font-size:13px;line-height:1.5"><code class="language-${lang}">${highlighted}</code></pre>`;
  }
  return `<pre style="margin:0;background:#1e1e1e;color:#d4d4d4;padding:16px;overflow-x:auto;font-size:13px;line-height:1.5"><code>${escapeHtml(code)}</code></pre>`;
}

export function renderHtmlArtifact(code: string): string {
  const doc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif;color:#1c1917;background:#fff}body{padding:16px;overflow:auto}img,svg,video,canvas{max-width:100%;height:auto}pre,code{white-space:pre-wrap;word-break:break-word}</style></head><body>${sanitizeHtml(code)}</body></html>`;
  return `<iframe title="HTML artifact preview" sandbox="" referrerpolicy="no-referrer" srcdoc="${escapeAttr(doc)}" class="artifact-frame artifact-frame-html"></iframe>`;
}
export function renderSvgArtifact(code: string): string { return `<div class="artifact-svg-host">${sanitizeSvg(code)}</div>`; }

// --- Deck (presentation) rendering: strategy in docs/VIDEO_PRESENTATION_STRATEGY.md.
// Pure sync render from validated JSON; inline styles on the existing
// stone/amber palette so output is immune to Tailwind class scanning.

const DECK_FONT = `font-family:system-ui,-apple-system,'Segoe UI',sans-serif`;
const DECK_TEXT = '#1c1917';
const DECK_MUTED = '#57534e';
const DECK_FAINT = '#a8a29e';
const DECK_ACCENT = '#d97706';
const DECK_BORDER = '#e7e5e4';

function deckStr(data: Record<string, unknown>, key: string, max = 160): string {
  const value = data[key];
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return escapeHtml(String(value).slice(0, max));
}

function deckList(data: Record<string, unknown>, key: string, maxItems: number, maxLen = 140): string[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
    .slice(0, maxItems)
    .map(item => escapeHtml(String(item).slice(0, maxLen)));
}

function deckHeading(text: string, size = 20): string {
  return text ? `<h3 style="margin:0 0 14px;font-size:${size}px;font-weight:700;line-height:1.25;color:${DECK_TEXT}">${text}</h3>` : '';
}

function deckBulletRows(items: string[], marker: (i: number) => string): string {
  return items.map((item, i) => `<div style="display:flex;gap:10px;align-items:baseline;margin:0 0 9px;font-size:15px;line-height:1.5;color:${DECK_MUTED}">${marker(i)}<span>${item}</span></div>`).join('');
}

function deckColumn(title: string, items: string[]): string {
  return `<div><div style="font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${DECK_ACCENT};margin-bottom:10px">${title}</div>${deckBulletRows(items, () => `<span style="color:${DECK_ACCENT}">&bull;</span>`)}</div>`;
}

function renderDeckSlideBody(slide: DeckSlide): string {
  const d = slide.data;
  switch (slide.layout) {
    case 'title': {
      const kicker = deckStr(d, 'kicker', 40);
      return `<div style="text-align:center">${kicker ? `<div style="font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${DECK_ACCENT};margin-bottom:14px">${kicker}</div>` : ''}<h2 style="margin:0;font-size:30px;font-weight:700;line-height:1.2;color:${DECK_TEXT}">${deckStr(d, 'heading', 120) || 'Untitled'}</h2>${deckStr(d, 'subheading') ? `<p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:${DECK_MUTED}">${deckStr(d, 'subheading')}</p>` : ''}</div>`;
    }
    case 'agenda':
      return `${deckHeading(deckStr(d, 'heading', 120) || 'Agenda')}${deckBulletRows(deckList(d, 'items', 6), i => `<span style="font-weight:700;color:${DECK_ACCENT};min-width:20px">${i + 1}</span>`)}`;
    case 'bullets': {
      const icon = deckStr(d, 'icon', 4);
      return `${icon ? `<div style="font-size:22px;margin-bottom:8px">${icon}</div>` : ''}${deckHeading(deckStr(d, 'heading', 120))}${deckBulletRows(deckList(d, 'bullets', 5), () => `<span style="color:${DECK_ACCENT}">&bull;</span>`)}`;
    }
    case 'two-column':
      // auto-fit + minmax lets the two columns stack into one on a narrow
      // phone instead of squeezing into unreadable slivers.
      return `${deckHeading(deckStr(d, 'heading', 120))}<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px 22px">${deckColumn(deckStr(d, 'leftTitle', 60) || 'Left', deckList(d, 'leftItems', 4))}${deckColumn(deckStr(d, 'rightTitle', 60) || 'Right', deckList(d, 'rightItems', 4))}</div>`;
    case 'stat':
      return `<div style="text-align:center">${deckStr(d, 'heading', 120) ? `<div style="font-size:15px;color:${DECK_MUTED};margin-bottom:10px">${deckStr(d, 'heading', 120)}</div>` : ''}<div style="font-size:46px;font-weight:700;color:${DECK_ACCENT};line-height:1.1">${deckStr(d, 'value', 40) || '&mdash;'}</div>${deckStr(d, 'label') ? `<div style="font-size:15px;font-weight:600;color:${DECK_TEXT};margin-top:10px">${deckStr(d, 'label')}</div>` : ''}${deckStr(d, 'context') ? `<div style="font-size:13px;color:${DECK_FAINT};margin-top:8px">${deckStr(d, 'context')}</div>` : ''}</div>`;
    case 'quote':
      return `<div style="text-align:center;padding:0 6%"><div style="font-size:34px;line-height:1;color:${DECK_ACCENT};font-weight:700">&ldquo;</div><p style="margin:4px 0 0;font-size:19px;font-style:italic;line-height:1.5;color:${DECK_TEXT}">${deckStr(d, 'text', 280)}</p>${deckStr(d, 'attribution', 80) ? `<div style="margin-top:14px;font-size:13px;color:${DECK_FAINT}">&mdash; ${deckStr(d, 'attribution', 80)}</div>` : ''}</div>`;
    case 'code': {
      const codeText = deckStr(d, 'code', 900);
      if (!codeText.trim()) {
        // A model sometimes tags a non-code slide as 'code' with an empty code
        // field, which would render an empty dark box. Degrade to whatever
        // content is present (bullets, then a paragraph) instead.
        const fallbackBullets = deckList(d, 'bullets', 5);
        const body = fallbackBullets.length
          ? deckBulletRows(fallbackBullets, () => `<span style="color:${DECK_ACCENT}">&bull;</span>`)
          : (deckStr(d, 'text', 400) ? `<p style="margin:0;font-size:15px;line-height:1.6;color:${DECK_MUTED}">${deckStr(d, 'text', 400)}</p>` : '');
        return `${deckHeading(deckStr(d, 'heading', 120), 18)}${body}`;
      }
      return `${deckHeading(deckStr(d, 'heading', 120), 18)}<pre style="margin:0;background:#292524;color:${DECK_BORDER};border-radius:8px;padding:14px 16px;font-size:12.5px;line-height:1.55;overflow:auto;max-height:100%"><code>${codeText}</code></pre>`;
    }
    case 'closing': {
      const items = deckList(d, 'items', 3);
      return `<div style="text-align:center"><h2 style="margin:0;font-size:26px;font-weight:700;line-height:1.25;color:${DECK_TEXT}">${deckStr(d, 'heading', 120) || 'Thank you'}</h2>${deckStr(d, 'subheading') ? `<p style="margin:12px 0 0;font-size:15px;color:${DECK_MUTED}">${deckStr(d, 'subheading')}</p>` : ''}${items.length ? `<div style="margin-top:18px;display:inline-block;text-align:left">${deckBulletRows(items, () => `<span style="color:${DECK_ACCENT}">&bull;</span>`)}</div>` : ''}</div>`;
    }
    default:
      return deckBulletRows(deckList(d, 'bullets', 5), () => `<span style="color:${DECK_ACCENT}">&bull;</span>`);
  }
}

export function renderDeckSpecHtml(spec: DeckSpec): string {
  const total = spec.slides.length;
  const deckTitle = escapeHtml(spec.title.slice(0, 80));
  const slides = spec.slides.map((slide, i) => {
    const centered = slide.layout === 'title' || slide.layout === 'stat' || slide.layout === 'quote' || slide.layout === 'closing';
    const accentBar = centered ? '' : `<span style="position:absolute;top:0;left:7%;width:44px;height:4px;background:#f59e0b;border-radius:0 0 4px 4px"></span>`;
    // Height grows to fit content (with a min for short slides) instead of a
    // rigid 16/9 box: on a narrow phone a fixed aspect ratio is too short, so
    // centered content used to spill out of the card. The flex row stretches
    // every slide to the tallest, so they stay uniform. Bottom padding clears
    // the absolutely-positioned footer badges.
    return `<section style="position:relative;flex:0 0 100%;min-width:100%;scroll-snap-align:center;background:#fff;border:1px solid ${DECK_BORDER};border-radius:12px;box-shadow:0 1px 3px rgba(28,25,23,.06);min-height:240px;padding:30px 26px 42px;display:flex;flex-direction:column;justify-content:center;box-sizing:border-box;overflow-wrap:anywhere;word-break:break-word;${DECK_FONT};color:${DECK_TEXT}">${accentBar}${renderDeckSlideBody(slide)}${i > 0 ? `<span style="position:absolute;bottom:11px;left:16px;font-size:11px;color:${DECK_FAINT}">${deckTitle}</span>` : ''}<span style="position:absolute;bottom:11px;right:16px;font-size:11px;color:${DECK_FAINT}">${i + 1} / ${total}</span></section>`;
  }).join('');
  // Horizontal scroll-snap carousel: flip through slides one at a time
  // (swipe on touch, scroll/trackpad on desktop) — pure CSS, no JS wiring.
  return `<div class="deck-artifact" data-deck-slides="${total}" style="display:flex;gap:16px;padding:4px 4px 12px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:thin">${slides}</div>`;
}

export function renderDeckArtifact(code: string): string {
  const spec = repairDeckSpec(code);
  if (!spec) return renderError('Deck', 'Invalid presentation JSON. Expected {"title", "slides":[{"layout","data"}]}.', code);
  return renderDeckSpecHtml(spec);
}

// --- Document (report) rendering: paper-style artifact from validated
// JSON. Inline styles on the stone/amber palette; all content escaped.

const DOC_HEADING_SIZE: Record<number, number> = { 1: 21, 2: 17, 3: 15 };

function renderDocBlock(b: DocBlock): string {
  switch (b.type) {
    case 'heading': {
      const size = DOC_HEADING_SIZE[b.level] || 17;
      return `<div style="margin:22px 0 8px;font-size:${size}px;font-weight:700;line-height:1.3;color:${DECK_TEXT}">${escapeHtml(b.text)}</div>`;
    }
    case 'paragraph':
      return `<p style="margin:0 0 13px;font-size:14.5px;line-height:1.7;color:${DECK_MUTED}">${escapeHtml(b.text)}</p>`;
    case 'bullets':
      return `<ul style="margin:0 0 13px;padding-left:22px">${b.items.map(i => `<li style="margin:0 0 6px;font-size:14.5px;line-height:1.6;color:${DECK_MUTED}">${escapeHtml(i)}</li>`).join('')}</ul>`;
    case 'numbered':
      return `<ol style="margin:0 0 13px;padding-left:24px">${b.items.map(i => `<li style="margin:0 0 6px;font-size:14.5px;line-height:1.6;color:${DECK_MUTED}">${escapeHtml(i)}</li>`).join('')}</ol>`;
    case 'code':
      return `<pre style="margin:0 0 13px;background:#292524;color:#e7e5e4;border-radius:8px;padding:12px 14px;font-size:12.5px;line-height:1.55;overflow:auto"><code>${escapeHtml(b.code)}</code></pre>`;
    case 'quote':
      return `<blockquote style="margin:0 0 13px;padding:2px 0 2px 14px;border-left:3px solid ${DECK_ACCENT};font-style:italic;color:${DECK_TEXT};font-size:15px;line-height:1.6">${escapeHtml(b.text)}${b.attribution ? `<div style="margin-top:6px;font-style:normal;font-size:12px;color:${DECK_FAINT}">— ${escapeHtml(b.attribution)}</div>` : ''}</blockquote>`;
    case 'table': {
      const head = b.headers.length
        ? `<thead><tr>${b.headers.map(h => `<th style="text-align:left;padding:7px 10px;border-bottom:2px solid ${DECK_BORDER};font-size:12.5px;font-weight:700;color:${DECK_TEXT}">${escapeHtml(h)}</th>`).join('')}</tr></thead>`
        : '';
      const body = b.rows.map(r => `<tr>${r.map(c => `<td style="padding:7px 10px;border-bottom:1px solid ${DECK_BORDER};font-size:13px;color:${DECK_MUTED}">${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
      return `<div style="overflow-x:auto;margin:0 0 13px"><table style="width:100%;border-collapse:collapse">${head}<tbody>${body}</tbody></table></div>`;
    }
    default:
      return '';
  }
}

export function renderDocSpecHtml(spec: DocSpec): string {
  const blocks = spec.blocks.map(renderDocBlock).join('');
  const subtitle = spec.subtitle ? `<p style="margin:4px 0 0;font-size:15px;color:${DECK_MUTED}">${escapeHtml(spec.subtitle)}</p>` : '';
  return `<div class="document-artifact" data-doc-blocks="${spec.blocks.length}" style="max-width:760px;margin:0 auto;padding:30px 34px;background:#fff;border:1px solid ${DECK_BORDER};border-radius:12px;box-shadow:0 1px 3px rgba(28,25,23,.06);${DECK_FONT};color:${DECK_TEXT}">`
    + `<h1 style="margin:0;font-size:26px;font-weight:700;line-height:1.25;color:${DECK_TEXT}">${escapeHtml(spec.title)}</h1>${subtitle}`
    + `<hr style="border:none;border-top:1px solid ${DECK_BORDER};margin:16px 0 18px"/>${blocks}</div>`;
}

export function renderDocumentArtifact(code: string): string {
  const spec = repairDocSpec(code);
  if (!spec) return renderError('Document', 'Invalid document JSON. Expected {"title", "blocks":[{"type", …}]}.', code);
  return renderDocSpecHtml(spec);
}

export function renderMermaidArtifact(code: string): string {
  const sanitized = normalizeMermaidSource(code);
  const id = `mer-${rand()}`;
  domReady(async () => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js');
      const mm = window.mermaid || (window as any).mermaid;
      if (!mm) throw new Error('Mermaid library failed to load.');
      // Use mermaid's default HTML labels: they carry a solid background that
      // masks edge lines behind the label text. (htmlLabels:false renders bare
      // SVG <text> with no mask, so edge lines cut through labels — the
      // "crossed out" bug.) The resulting <foreignObject> output is handled by
      // sanitizeSvg's foreignObject branch, which preserves the labels.
      mm.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'base', themeVariables: { primaryColor: '#f1f5f9', primaryTextColor: '#1e293b', primaryBorderColor: '#475569', lineColor: '#475569', secondaryColor: '#f8fafc', tertiaryColor: '#f1f5f9' } });
      const renderPromise = mm.render(`${id}-s`, sanitized);
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Mermaid render timed out after 5s')), 5000));
      const { svg } = await Promise.race([renderPromise, timeoutPromise]);
      if (svg && /<svg\b/i.test(svg)) {
        el.innerHTML = sanitizeSvg(preserveScrollableDiagramSvgSize(svg));
        el.className = 'artifact-server-svg flex justify-center overflow-auto';
      } else {
        await withTimeout(renderServerSvgInto(el, 'mermaid', sanitized, 'Mermaid'), 15_000);
      }
    } catch (e: any) {
      await withTimeout(renderServerSvgInto(el, 'mermaid', sanitized, 'Mermaid'), 15_000).catch(() => {
        el.innerHTML = renderError('Mermaid', e.message || String(e), sanitized);
      });
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm"><div class="inline-block w-5 h-5 border-2 border-stone-300 border-t-amber-500 rounded-full animate-spin mb-2"></div><br/>Rendering diagram...</div>`;
}

export function renderKatexArtifact(code: string): string {
  const id = `katex-${rand()}`;
  domReady(() => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      if (window.katex) {
        window.katex.render(code, el, { throwOnError: false, displayMode: true });
      } else {
        el.innerHTML = renderError('KaTeX', 'Renderer not loaded. Please refresh.', code);
      }
    } catch (e) {
      el.innerHTML = renderError('KaTeX', String(e), code);
    }
  });
  // Timeout guard: if not rendered after 5s, show error
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el && el.textContent?.includes('Rendering math')) {
      el.innerHTML = renderError('KaTeX', 'Renderer took too long. Please refresh.', code);
    }
  }, 5_000);
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm">Rendering math...</div>`;
}

export function renderMarkmapArtifact(code: string): string {
  const id = `markmap-${rand()}`;
  domReady(() => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      const mm = (window as any).markmap;
      if (mm?.Markmap && mm?.Transformer) {
        const t = new mm.Transformer();
        const { root } = t.transform(code);
        const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgEl.setAttribute('style', 'width:100%;min-height:300px');
        el.innerHTML = '';
        el.appendChild(svgEl);
        mm.Markmap.create(svgEl, undefined, root);
      } else {
        el.innerHTML = renderError('Markmap', 'Renderer not loaded. Please refresh.', code);
      }
    } catch (e) {
      el.innerHTML = renderError('Markmap', String(e), code);
    }
  });
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el && el.textContent?.includes('Rendering mind map')) {
      el.innerHTML = renderError('Markmap', 'Renderer took too long. Please refresh.', code);
    }
  }, 8_000);
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm" style="min-height:300px"><div class="inline-block w-5 h-5 border-2 border-stone-300 border-t-pink-500 rounded-full animate-spin mb-2"></div><br/>Rendering mind map...</div>`;
}

export function renderD2Artifact(code: string): string {
  const id = `d2-${rand()}`;
  domReady(async () => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      await withTimeout(renderServerSvgInto(el, 'd2', code, 'D2'), 15_000);
    } catch (e: any) {
      el.innerHTML = renderError('D2', e.message || 'Server render timed out', code);
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm"><div class="inline-block w-5 h-5 border-2 border-stone-300 border-t-emerald-500 rounded-full animate-spin mb-2"></div><br/>Rendering D2 diagram...</div>`;
}

export function renderVegaArtifact(code: string): string {
  const id = `vega-${rand()}`;
  domReady(async () => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      // Validate JSON first before attempting render
      let spec: any;
      try { spec = JSON.parse(code); } catch { el.innerHTML = renderError('Vega', 'Invalid JSON in Vega specification.', code); return; }
      if ((window as any).vegaEmbed) {
        await withTimeout((window as any).vegaEmbed(`#${id}`, spec, { actions: true, renderer: 'svg' }), 10_000);
      } else {
        await withTimeout(renderServerSvgInto(el, 'vega', code, 'Vega'), 15_000);
      }
    } catch (e: any) {
      if (el) el.innerHTML = renderError('Vega', e.message || String(e), code);
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm" style="min-height:200px"><div class="inline-block w-5 h-5 border-2 border-stone-300 border-t-teal-500 rounded-full animate-spin mb-2"></div><br/>Rendering chart...</div>`;
}

export function renderGraphvizArtifact(code: string): string {
  const id = `gv-${rand()}`;
  domReady(async () => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      await withTimeout(renderServerSvgInto(el, 'graphviz', code, 'Graphviz'), 15_000);
    } catch (e: any) {
      el.innerHTML = renderError('Graphviz', e.message || 'Server render timed out', code);
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm"><div class="inline-block w-5 h-5 border-2 border-stone-300 border-t-purple-500 rounded-full animate-spin mb-2"></div><br/>Rendering Graphviz diagram...</div>`;
}

export function renderPlantUMLArtifact(code: string): string {
  const id = `puml-${rand()}`;
  domReady(async () => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      await withTimeout(renderServerSvgInto(el, 'plantuml', code, 'PlantUML'), 15_000);
    } catch (e: any) {
      el.innerHTML = renderError('PlantUML', e.message || 'Server render timed out', code);
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm" style="min-height:200px"><div class="inline-block w-5 h-5 border-2 border-stone-300 border-t-orange-500 rounded-full animate-spin mb-2"></div><br/>Rendering PlantUML...</div>`;
}

export function renderFlowchartArtifact(code: string): string {
  // flowchart.js syntax uses => and -> operators; Mermaid uses graph/flowchart keyword
  // If code looks like Mermaid flowchart syntax, delegate to Mermaid; otherwise use server render
  if (/^\s*(graph|flowchart)\b/im.test(code)) {
    return renderMermaidArtifact(code);
  }
  const id = `fc-${rand()}`;
  domReady(async () => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/flowchart.js@1.18.0/release/flowchart.min.js');
      const flowchart = window.flowchart || (window as any).flowchart;
      if (!flowchart?.parse) throw new Error('Flowchart renderer failed to load.');
      const hostId = `${id}-host`;
      el.innerHTML = `<div id="${hostId}" class="artifact-flowchart-host"></div>`;
      const diagram = flowchart.parse(code);
      await withTimeout(Promise.resolve(diagram.drawSVG(hostId)), 10_000);
      el.className = 'artifact-server-svg flex justify-center overflow-auto';
    } catch (e: any) {
      el.innerHTML = renderError('Flowchart', e.message || 'Flowchart render failed', code);
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm"><div class="inline-block w-5 h-5 border-2 border-stone-300 border-t-blue-500 rounded-full animate-spin mb-2"></div><br/>Rendering flowchart...</div>`;
}

export function renderReactArtifact(code: string): string {
  return `<iframe title="React artifact preview" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapeAttr(getReactHtml(code))}" class="artifact-frame artifact-frame-react"></iframe>`;
}

function getReactHtml(code: string): string {
  const safeCode = code.replace(/<\/script/gi, '<\\/script');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script><script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script><script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script><style>html,body,#root{min-height:100%;margin:0}body{font-family:system-ui,sans-serif;background:#fff;color:#1a1a1a;padding:16px;overflow:auto}*{box-sizing:border-box}img,svg,canvas,video{max-width:100%;height:auto}</style></head><body><div id="root"></div><script>window.__HOST_API=Object.freeze({dispatch:function(a,p){window.parent.postMessage({source:'artifact',action:a,payload:p},'*');},copy:function(t){window.parent.postMessage({source:'artifact',action:'copy',payload:t},'*');},error:function(e){window.parent.postMessage({source:'artifact',action:'error',payload:e},'*');}});window.addEventListener('error',function(e){window.__HOST_API.error(e.message||String(e.error||e));});</script><script type="text/babel" data-type="module">${safeCode}\nconst container=document.getElementById('root');if(typeof App!=='undefined'){try{ReactDOM.createRoot(container).render(React.createElement(App));}catch(e){window.__HOST_API.error(e.message||String(e));container.innerHTML='<pre style="color:#b91c1c;white-space:pre-wrap">'+String(e.message||e).replace(/[<>&]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]})+'</pre>';}}else{container.innerHTML='<pre style="color:#92400e;white-space:pre-wrap">React artifact must export or define an App component.</pre>';}<\/script></body></html>`;
}

function detectLanguage(code: string): string {
  if (/^\s*(import|export|const|let|var|function|class|=>|async|await)/.test(code)) return 'javascript';
  if (/def\s|class\s|print\(/.test(code)) return 'python';
  if (/<[a-z][\s\S]*>/i.test(code)) return 'markup';
  return 'plaintext';
}

async function renderServerSvgInto(el: HTMLElement, type: ArtifactType, code: string, label: string): Promise<void> {
  const normalizedCode = normalizeArtifactSource(type, code);
  try {
    const res = await fetch('/api/render-artifact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, code: normalizedCode }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.svg) {
      el.innerHTML = sanitizeSvg(preserveScrollableDiagramSvgSize(data.svg));
      el.className = 'artifact-server-svg flex justify-center overflow-auto';
      return;
    }
    el.innerHTML = renderError(label, data?.message || data?.error || `Renderer returned ${res.status}`, normalizedCode);
  } catch (e) {
    el.innerHTML = renderError(label, String(e), normalizedCode);
  }
}

function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escapeAttr(s: string): string { return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
// Decode HTML entities in an attribute value so a scheme like
// `&#106;avascript:` or `java&Tab;script:` can't hide from the URL check below.
function decodeEntitiesForUrlCheck(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&#(\d+);?/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ''; } })
    .replace(/&(?:tab|newline|lt|gt|amp|quot|apos|colon|NewLine|Tab);/gi, (m) => (/colon/i.test(m) ? ':' : ''))
    .replace(/[\s -]+/g, '');
}
const DANGEROUS_URL_RE = /^(?:javascript|vbscript|data):/i;

function stripDangerousUrlAttrs(input: string): string {
  return input.replace(
    /\s(href|src|xlink:href|xlink:src)\s*=\s*(?:(['"])([\s\S]*?)\2|([^\s>]+))/gi,
    (match, _attr, _q, quoted, bare) => {
      const raw = quoted !== undefined ? quoted : bare || '';
      const decoded = decodeEntitiesForUrlCheck(raw);
      // Allow safe data:image/* (used for embedded raster images); block the rest.
      if (DANGEROUS_URL_RE.test(decoded) && !/^data:image\//i.test(decoded)) return '';
      return match;
    },
  );
}

function sanitizeHtml(html: string): string {
  return stripDangerousUrlAttrs(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<(iframe|object|embed|form|meta|link|base)[\s\S]*?<\/\1>/gi, '')
      .replace(/<(iframe|object|embed|form|meta|link|base)\b[^>]*\/?>/gi, '')
      .replace(/\son[\w:-]+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son[\w:-]+\s*=\s*'[^']*'/gi, '')
      .replace(/\son[\w:-]+\s*=\s*[^\s>]+/gi, ''),
  );
}
function sanitizeSvg(svg: string): string {
  // Pure SVG (graphviz/d2/plantuml, user SVG artifacts, and the primary
  // mermaid path which we render with htmlLabels:false) is sanitized by
  // DOMPurify's parser — regexes cannot safely match arbitrary SVG. SVGs that
  // embed <foreignObject> XHTML (kroki's mermaid fallback still uses it) are
  // the one case DOMPurify would blank the labels of, so they fall back to the
  // hardened regex scrubber that preserves the text while stripping scripts,
  // event handlers, and encoded javascript:/data: URLs.
  if (typeof DOMPurify?.sanitize === 'function' && DOMPurify.isSupported && !/<foreignObject/i.test(svg)) {
    return DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'meta', 'link', 'base'],
    });
  }
  return sanitizeHtml(svg);
}
export function preserveScrollableDiagramSvgSize(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/i, (match, attrs: string) => {
    if (!/\swidth=(["'])100%\1/i.test(attrs)) return match;
    const maxWidth = attrs.match(/max-width\s*:\s*([\d.]+)px/i)?.[1];
    if (!maxWidth) return match;
    const width = Math.ceil(Number(maxWidth));
    if (!Number.isFinite(width) || width <= 0) return match;
    const nextAttrs = attrs
      .replace(/\swidth=(["'])100%\1/i, ` width="${width}"`)
      .replace(/\sstyle=(["'])(.*?)\1/i, (_styleAttr: string, quote: string, style: string) => {
        const cleaned = style
          .replace(/(^|;)\s*max-width\s*:\s*[\d.]+px\s*;?/i, '$1')
          .replace(/;{2,}/g, ';')
          .replace(/^\s*;\s*/, '')
          .trim();
        return cleaned ? ` style=${quote}${cleaned}${quote}` : '';
      });
    return `<svg${nextAttrs}>`;
  }).replace(/max-width\s*:\s*[\d.]+px\s*;?/gi, '');
}
function safeClassName(value: string): string { return value.replace(/[^\w-]/g, '') || 'plaintext'; }
function rand(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }
function renderError(type: string, message: string, code: string): string {
  return formatArtifactRendererError(type, message, code);
}

export function renderGenericKrokiArtifact(type: string, code: string): string {
  const id = `kroki-${rand()}`;
  domReady(async () => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      await withTimeout(renderServerSvgInto(el, type, code, type.toUpperCase()), 15_000);
    } catch (e: any) {
      el.innerHTML = renderError(type.toUpperCase(), e.message || 'Server render timed out', code);
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm"><div class="inline-block w-5 h-5 border-2 border-stone-300 border-t-indigo-500 rounded-full animate-spin mb-2"></div><br/>Rendering ${type} diagram...</div>`;
}

declare global { interface Window { Prism: any; mermaid: any; katex: any; flowchart: any; } }
