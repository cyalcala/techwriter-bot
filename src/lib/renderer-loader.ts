import type { ArtifactType } from './stream-parser';

const loadedScripts = new Set<string>();
const loadedStyles = new Set<string>();

function loadScript(src: string): Promise<void> {
  if (loadedScripts.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => { loadedScripts.add(src); resolve(); };
    script.onerror = () => { loadedScripts.delete(src); reject(new Error(`Failed to load ${src}`)); };
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

export function preloadPopular(): void {
  Promise.all([
    loadScript('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js'),
    loadStyle('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css'),
    loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js'),
    loadStyle('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css'),
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/@terrastruct/d2-js@0.6.3/dist/d2-js.umd.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/@hpcc-js/wasm@2.15.3/dist/graphviz.umd.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/vega@5.25.0/build/vega.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/vega-lite@5.16.3/build/vega-lite.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/vega-embed@6.24.0/build/vega-embed.min.js'),
    loadScript('https://cdn.jsdelivr.net/npm/markmap-autoloader@0.17.0/dist/index.js'),
    loadScript('https://cdn.jsdelivr.net/npm/flowchart.js@1.18.0/release/flowchart.min.js'),
  ]).catch(() => {});
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
      await loadScript('https://cdn.jsdelivr.net/npm/markmap-autoloader@0.17.0/dist/index.js');
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
    case 'webcontainer':
      await loadScript('https://cdn.jsdelivr.net/npm/@webcontainer/api@1.3.0-internal.8/dist/webcontainer.api.min.js');
      return;
  }
}

function domReady(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function renderSafely<T>(
  fn: () => T,
  fallbackCode: string,
  errorPrefix: string,
): T | string {
  try {
    return fn();
  } catch (e) {
    return `<div class="text-red-500 text-xs p-3 bg-red-50 rounded-lg border border-red-200"><strong>${errorPrefix}:</strong><br/><code class="text-[11px] whitespace-pre-wrap break-all">${escapeHtml(String(e))}</code><pre class="mt-2 p-2 bg-gray-100 rounded text-[11px] overflow-x-auto whitespace-pre-wrap hidden">${escapeHtml(fallbackCode)}</pre></div>`;
  }
}

export function renderCodeArtifact(code: string, language?: string): string {
  const lang = language || detectLanguage(code);
  if (window.Prism) {
    const highlighted = window.Prism.highlight(code, window.Prism.languages[lang] || window.Prism.languages.plaintext, lang);
    return `<pre class="language-${lang}" style="margin:0;font-size:13px;line-height:1.5"><code class="language-${lang}">${highlighted}</code></pre>`;
  }
  return `<pre style="margin:0;background:#1e1e1e;color:#d4d4d4;padding:16px;overflow-x:auto;font-size:13px;line-height:1.5"><code>${escapeHtml(code)}</code></pre>`;
}

export function renderHtmlArtifact(code: string): string { return sanitizeHtml(code); }
export function renderSvgArtifact(code: string): string { return code; }

export function renderMermaidArtifact(code: string): string {
  const sanitized = sanitizeMermaid(code);
  const id = `mer-${rand()}`;
  domReady(async () => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      const mm = window.mermaid || (window as any).mermaid;
      if (!mm) {
        el.innerHTML = renderError('Mermaid', 'Renderer not loaded. Try refreshing.', code);
        return;
      }
      await mm.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'default' });
      const { svg } = await mm.render(`${id}-s`, sanitized);
      el.innerHTML = svg;
    } catch (e) {
      el.innerHTML = renderError('Mermaid', String(e), code);
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm">Rendering diagram...</div>`;
}

export function renderKatexArtifact(code: string): string {
  const id = `katex-${rand()}`;
  domReady(() => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      if (window.katex) window.katex.render(code, el, { throwOnError: false, displayMode: true });
    } catch (e) {
      el.innerHTML = renderError('KaTeX', String(e), code);
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm">Rendering math...</div>`;
}

export function renderMarkmapArtifact(code: string): string {
  const id = `markmap-${rand()}`;
  domReady(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const mm = (window as any).markmap;
    if (mm?.Markmap) {
      const t = new mm.Transformer();
      const { root } = t.transform(code);
      const svgEl = document.createElement('div');
      el.innerHTML = '';
      el.appendChild(svgEl);
      mm.Markmap.create(svgEl, undefined, root);
    } else {
      el.innerHTML = `<div class="text-xs text-[#8c8576]">Mind map renderer not loaded.</div>`;
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm" style="min-height:300px">Rendering mind map...</div>`;
}

export function renderD2Artifact(code: string): string {
  const id = `d2-${rand()}`;
  domReady(async () => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      if ((window as any).d2) {
        const result = await (window as any).d2.compile(code, { layout: 'dagre' });
        el.innerHTML = result.svg || '';
        el.className = 'flex justify-center overflow-x-auto';
      }
    } catch (e) {
      el.innerHTML = renderError('D2', String(e), code);
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm">Rendering D2 diagram...</div>`;
}

export function renderVegaArtifact(code: string): string {
  const id = `vega-${rand()}`;
  domReady(async () => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      if ((window as any).vegaEmbed) {
        await (window as any).vegaEmbed(`#${id}`, JSON.parse(code), { actions: true });
      }
    } catch (e) {
      if (el) el.innerHTML = renderError('Vega', String(e), code);
    }
  });
  return `<div id="${id}" class="p-4" style="min-height:200px"></div>`;
}

export function renderGraphvizArtifact(code: string): string {
  const id = `gv-${rand()}`;
  domReady(async () => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      const gv = (window as any).graphviz;
      if (gv) el.innerHTML = await gv.layout(code, 'svg', 'dot');
    } catch (e) {
      if (el) el.innerHTML = renderError('Graphviz', String(e), code);
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm" style="min-height:200px">Rendering Graphviz...</div>`;
}

export function renderPlantUMLArtifact(code: string): string {
  const encoded = encodePlantUML(code);
  const id = `puml-${rand()}`;
  return `<div class="flex justify-center p-2" id="${id}"><img src="https://www.plantuml.com/plantuml/svg/~1${encoded}" alt="PlantUML diagram" style="max-width:100%;min-height:100px" onerror="this.style.display='none';document.getElementById('${id}-fallback').style.display='block';" onload="this.style.opacity='1';" /><div id="${id}-fallback" style="display:none;padding:12px;text-align:center"><div class="text-xs text-stone-500 mb-2">PlantUML render failed</div><pre class="text-[11px] text-stone-700 bg-stone-100 p-3 rounded-lg overflow-x-auto text-left max-h-[300px] overflow-y-auto">${escapeHtml(code)}</pre><button class="mt-2 text-[10px] px-3 py-1 bg-stone-200 hover:bg-stone-300 rounded-md transition-all" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('pre').textContent)">Copy Code</button></div></div>`;
}

function encodePlantUML(code: string): string {
  return btoa(code).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function renderFlowchartArtifact(code: string): string {
  const id = `fc-${rand()}`;
  domReady(() => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      if ((window as any).flowchart) {
        const diagram = (window as any).flowchart.parse(code);
        el.innerHTML = '';
        diagram.drawSVG(id);
      }
    } catch (e) {
      if (el) el.innerHTML = renderError('Flowchart', String(e), code);
    }
  });
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm">Rendering flowchart...</div>`;
}

export function renderReactArtifact(code: string): string {
  return `<iframe sandbox="allow-scripts" srcdoc="${getReactHtml(encodeURIComponent(code))}" style="width:100%;min-height:300px;border:1px solid #e5e1d8;border-radius:12px;overflow:hidden"></iframe>`;
}

export function renderWebContainerArtifact(code: string): string {
  const id = `wc-${rand()}`;
  try {
    const parsed = JSON.parse(code);
    if (!parsed.files) throw new Error('Missing files object');
    loadWebContainer(id, parsed);
  } catch (e) {
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = renderError('WebContainer', String(e), code);
    }, 50);
  }
  return `<div id="${id}" class="p-4 text-center text-[#8c8576] text-sm" style="min-height:400px">Booting development environment (~30s)...</div>`;
}

async function loadWebContainer(id: string, project: { files: Record<string, { contents?: string } | string>; title?: string }) {
  try {
    const { WebContainer } = (window as any).webcontainer || {};
    if (!WebContainer) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<pre class="text-red-500 text-xs p-4">WebContainer not loaded. Refresh and try again.</pre>';
      return;
    }
    const instance = await WebContainer.boot();
    const files: Record<string, { file: { contents: string } }> = {};
    for (const [path, content] of Object.entries(project.files)) {
      const text = typeof content === 'string' ? content : (content.contents || '');
      files[path] = { file: { contents: text } };
    }
    await instance.mount(files);

    const install = await instance.spawn('npm', ['install']);
    await install.exit;

    const dev = await instance.spawn('npx', ['vite', '--port', '5173', '--host', '0.0.0.0']);
    instance.on('server-ready', (_port: number, url: string) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<iframe src="${url}" style="width:100%;min-height:500px;border:none;border-radius:8px"></iframe>`;
    });

    dev.output.pipeTo(new WritableStream({
      write(data) { console.log('[WebContainer]', data); }
    }));
  } catch (e) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = renderError('WebContainer', String(e), '');
  }
}

function getReactHtml(encoded: string): string {
  const d = decodeURIComponent(encoded);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script><script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script><script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script><style>body{font-family:system-ui,sans-serif;margin:16px;background:#fff;color:#1a1a1a}</style></head><body><div id="root"></div><script>window.__HOST_API=Object.freeze({dispatch:function(a,p){window.parent.postMessage({source:'artifact',action:a,payload:p},'*');},copy:function(t){window.parent.postMessage({source:'artifact',action:'copy',payload:t},'*');},error:function(e){window.parent.postMessage({source:'artifact',action:'error',payload:e},'*');}});</script><script type="text/babel" data-type="module">${d}\nconst container=document.getElementById('root');if(typeof App!=='undefined'){try{ReactDOM.createRoot(container).render(React.createElement(App));}catch(e){window.__HOST_API.error(e.message||String(e));}}<\/script></body></html>`;
}

function sanitizeMermaid(code: string): string {
  return code
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p>/gi, '')
    .replace(/<\/?b>/gi, '')
    .replace(/<\/?i>/gi, '')
    .replace(/<\/?strong>/gi, '')
    .replace(/<\/?em>/gi, '')
    .replace(/<span[^>]*>/gi, '')
    .replace(/<\/span>/gi, '')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/->>/g, '-->')
    .replace(/-\|>/g, '-->')
    .replace(/(\w+)\|(\w+)/g, '$1/$2')
    .replace(/\|>/g, '/>')
    .replace(/\[([^\]]*)\|([^\]]*)\]/g, '[$1/$2]');
}

function detectLanguage(code: string): string {
  if (/^\s*(import|export|const|let|var|function|class|=>|async|await)/.test(code)) return 'javascript';
  if (/def\s|class\s|print\(/.test(code)) return 'python';
  if (/<[a-z][\s\S]*>/i.test(code)) return 'markup';
  return 'plaintext';
}

function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function sanitizeHtml(html: string): string { return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/on\w+\s*=\s*"[^"]*"/gi, '').replace(/on\w+\s*=\s*'[^']*'/gi, ''); }
function rand(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }
function renderError(type: string, message: string, code: string): string {
  return `<div class="text-red-500 text-xs p-3 bg-red-50 rounded-lg border border-red-200"><strong>${type} error:</strong><br/><code class="text-[11px] whitespace-pre-wrap break-all">${escapeHtml(message)}</code><button class="mt-2 px-2 py-1 text-[10px] bg-red-100 hover:bg-red-200 rounded border border-red-300" onclick="this.nextElementSibling.classList.toggle('hidden')">Show raw</button><pre class="hidden mt-2 p-2 bg-gray-100 rounded text-[11px] overflow-x-auto whitespace-pre-wrap">${escapeHtml(code)}</pre></div>`;
}

declare global { interface Window { Prism: any; mermaid: any; katex: any; flowchart: any; webcontainer: any; } }
