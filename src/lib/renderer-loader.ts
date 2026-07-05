import type { ArtifactType } from './stream-parser';
import { formatArtifactRendererError } from './artifact-error-boundary';
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
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(iframe|object|embed|form|meta|link|base)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(iframe|object|embed|form|meta|link|base)\b[^>]*\/?>/gi, '')
    .replace(/\son[\w:-]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[\w:-]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[\w:-]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s(href|src|xlink:href)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '');
}
function sanitizeSvg(svg: string): string {
  return sanitizeHtml(svg)
    .replace(/\s(href|src|xlink:href)\s*=\s*(['"])\s*data:text\/html[\s\S]*?\2/gi, '');
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
