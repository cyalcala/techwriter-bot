import type { ArtifactType } from './stream-parser';

const loadedScripts = new Set<string>();
const loadedStyles = new Set<string>();

function loadScript(src: string): Promise<void> {
  if (loadedScripts.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => { loadedScripts.add(src); resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function loadStyle(href: string): Promise<void> {
  if (loadedStyles.has(href)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => { loadedStyles.add(href); resolve(); };
    link.onerror = reject;
    document.head.appendChild(link);
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
      await loadScript('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js');
      return;
    case 'katex':
      await Promise.all([
        loadStyle('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css'),
        loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js'),
      ]);
      return;
    case 'markmap':
      await Promise.all([
        loadScript('https://cdn.jsdelivr.net/npm/markmap-autoloader@0.17.0/dist/index.js'),
      ]);
      return;
    case 'd2':
      await loadScript('https://cdn.jsdelivr.net/npm/@terrastruct/d2-js@0.6.3/dist/d2-js.umd.min.js');
      return;
    case 'vega':
      await Promise.all([
        loadScript('https://cdn.jsdelivr.net/npm/vega@5.25.0/build/vega.min.js'),
        loadScript('https://cdn.jsdelivr.net/npm/vega-lite@5.16.3/build/vega-lite.min.js'),
        loadScript('https://cdn.jsdelivr.net/npm/vega-embed@6.24.0/build/vega-embed.min.js'),
      ]);
      return;
    case 'graphviz':
      await loadScript('https://cdn.jsdelivr.net/npm/@hpcc-js/wasm@2.15.3/dist/graphviz.umd.min.js');
      return;
    case 'plantuml':
      return;
    case 'flowchart':
      await loadScript('https://cdn.jsdelivr.net/npm/flowchart.js@1.18.0/release/flowchart.min.js');
      return;
    case 'svg':
    case 'html':
    case 'react':
      return;
  }
}

export function renderCodeArtifact(code: string, language?: string): string {
  const lang = language || detectLanguage(code);
  const escaped = escapeHtml(code);
  if (window.Prism) {
    const highlighted = window.Prism.highlight(code, window.Prism.languages[lang] || window.Prism.languages.plaintext, lang);
    return `<pre class="language-${lang}" style="margin:0;font-size:13px;line-height:1.5"><code class="language-${lang}">${highlighted}</code></pre>`;
  }
  return `<pre style="margin:0;background:#1e1e1e;color:#d4d4d4;padding:16px;overflow-x:auto;font-size:13px;line-height:1.5"><code>${escaped}</code></pre>`;
}

export function renderHtmlArtifact(code: string): string {
  return sanitizeHtml(code);
}

export function renderSvgArtifact(code: string): string {
  return code;
}

export function renderMermaidArtifact(code: string): string {
  const sanitized = sanitizeMermaid(code);
  const id = `mer-${rand()}`;
  setTimeout(async () => {
    try {
      const el = document.getElementById(id);
      if (el && window.mermaid) {
        window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
        const { svg } = await window.mermaid.render(`${id}-s`, sanitized);
        el.innerHTML = svg;
      }
    } catch (e) {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = `<div class="text-red-500 text-xs p-3 bg-red-50 rounded-lg border border-red-200">
          <strong>Mermaid error:</strong><br/>
          <code class="text-[11px] whitespace-pre-wrap break-all">${escapeHtml(String(e))}</code>
          <button class="mt-2 px-2 py-1 text-[10px] bg-red-100 hover:bg-red-200 rounded border border-red-300" onclick="this.nextElementSibling.classList.toggle('hidden')">Show raw</button>
          <pre class="hidden mt-2 p-2 bg-gray-100 rounded text-[11px] overflow-x-auto whitespace-pre-wrap">${escapeHtml(code)}</pre>
        </div>`;
      }
    }
  }, 100);
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm">Rendering diagram...</div>`;
}

export function renderKatexArtifact(code: string): string {
  const id = `katex-${rand()}`;
  setTimeout(() => {
    try {
      const el = document.getElementById(id);
      if (el && window.katex) {
        window.katex.render(code, el, { throwOnError: false, displayMode: true });
      }
    } catch (e) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<pre class="text-red-500 text-xs">${escapeHtml(String(e))}</pre>`;
    }
  }, 50);
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm">Rendering math...</div>`;
}

export function renderMarkmapArtifact(code: string): string {
  const id = `markmap-${rand()}`;
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) {
      const { Markmap } = (window as any).markmap || {};
      if (Markmap) {
        const { Transformer } = (window as any).markmap;
        const transformer = new Transformer();
        const { root } = transformer.transform(code);
        const svgEl = document.createElement('div');
        el.innerHTML = '';
        el.appendChild(svgEl);
        Markmap.create(svgEl, undefined, root);
      } else {
        el.innerHTML = `<div class="text-xs text-[#8c8576]">Mind map renderer not loaded. Refresh to retry.</div>`;
      }
    }
  }, 200);
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm" style="min-height:300px">Rendering mind map...</div>`;
}

export function renderD2Artifact(code: string): string {
  const id = `d2-${rand()}`;
  setTimeout(async () => {
    try {
      const el = document.getElementById(id);
      if (el && (window as any).d2) {
        const d2 = (window as any).d2;
        const result = await d2.compile(code, { layout: 'dagre' });
        if (result.svg) {
          el.innerHTML = result.svg;
          el.className = 'flex justify-center overflow-x-auto';
        } else {
          el.innerHTML = `<pre class="text-red-500 text-xs">D2 compile error: no output</pre>`;
        }
      }
    } catch (e) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<pre class="text-red-500 text-xs">${escapeHtml(String(e))}</pre>`;
    }
  }, 100);
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm">Rendering D2 diagram...</div>`;
}

export function renderVegaArtifact(code: string): string {
  const id = `vega-${rand()}`;
  setTimeout(async () => {
    try {
      const el = document.getElementById(id);
      if (el && (window as any).vegaEmbed) {
        const spec = JSON.parse(code);
        await (window as any).vegaEmbed(`#${id}`, spec, { actions: true });
      }
    } catch (e) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<pre class="text-red-500 text-xs">${escapeHtml(String(e))}</pre>`;
    }
  }, 100);
  return `<div id="${id}" class="p-4" style="min-height:200px"></div>`;
}

export function renderGraphvizArtifact(code: string): string {
  const id = `gv-${rand()}`;
  setTimeout(async () => {
    try {
      const el = document.getElementById(id);
      const gv = (window as any).graphviz;
      if (el && gv) {
        const svg = await gv.layout(code, 'svg', 'dot');
        el.innerHTML = svg;
      }
    } catch (e) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<pre class="text-red-500 text-xs">${escapeHtml(String(e))}</pre>`;
    }
  }, 100);
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm" style="min-height:200px">Rendering Graphviz...</div>`;
}

export function renderPlantUMLArtifact(code: string): string {
  const encoded = btoa(code);
  return `<div class="flex justify-center p-2"><img src="https://www.plantuml.com/plantuml/svg/${encoded}" alt="PlantUML diagram" style="max-width:100%" onerror="this.parentElement.innerHTML='<pre class=\\'text-red-500 text-xs p-2\\'>PlantUML render error. Check syntax.</pre>'" /></div>`;
}

export function renderFlowchartArtifact(code: string): string {
  const id = `fc-${rand()}`;
  setTimeout(() => {
    try {
      const el = document.getElementById(id);
      if (el && (window as any).flowchart) {
        const diagram = (window as any).flowchart.parse(code);
        el.innerHTML = '';
        diagram.drawSVG(id);
      }
    } catch (e) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<pre class="text-red-500 text-xs">${escapeHtml(String(e))}</pre>`;
    }
  }, 100);
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm">Rendering flowchart...</div>`;
}

export function renderReactArtifact(code: string): string {
  return `<iframe sandbox="allow-scripts" srcdoc="${getReactHtml(encodeURIComponent(code))}" style="width:100%;min-height:300px;border:1px solid #e5e1d8;border-radius:12px;overflow:hidden"></iframe>`;
}

function getReactHtml(encoded: string): string {
  const d = decodeURIComponent(encoded);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script><script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script><script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script><style>body{font-family:system-ui,sans-serif;margin:16px;background:#fff;color:#1a1a1a}</style></head><body><div id="root"></div><script type="text/babel" data-type="module">${d}\nconst container=document.getElementById('root');if(typeof App!=='undefined'){ReactDOM.createRoot(container).render(React.createElement(App));}<\/script></body></html>`;
}

function sanitizeMermaid(code: string): string {
  return code.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?p>/gi, '').replace(/<\/?b>/gi, '').replace(/<\/?i>/gi, '').replace(/<\/?strong>/gi, '').replace(/<\/?em>/gi, '').replace(/<span[^>]*>/gi, '').replace(/<\/span>/gi, '').replace(/<div[^>]*>/gi, '').replace(/<\/div>/gi, '\n').replace(/&nbsp;/gi, ' ');
}

function detectLanguage(code: string): string {
  if (/^\s*(import|export|const|let|var|function|class|=>|async|await)/.test(code)) return 'javascript';
  if (/def\s|class\s|print\(/.test(code)) return 'python';
  if (/<[a-z][\s\S]*>/i.test(code)) return 'markup';
  return 'plaintext';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/on\w+\s*=\s*"[^"]*"/gi, '').replace(/on\w+\s*=\s*'[^']*'/gi, '');
}

function rand(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

declare global {
  interface Window {
    Prism: any;
    mermaid: any;
    katex: any;
    flowchart: any;
  }
}
