import type { ArtifactType } from './stream-parser';

export interface RendererResult {
  html: string;
  css?: string;
}

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

export async function loadRenderer(type: ArtifactType): Promise<{ css?: string; js?: string }> {
  switch (type) {
    case 'code':
      await Promise.all([
        loadStyle('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css'),
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js'),
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js'),
      ]);
      return {};

    case 'mermaid':
      await loadScript('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js');
      return {};

    case 'svg':
      return {};

    case 'html':
    case 'react':
      return {};

    default:
      return {};
  }
}

export function renderCodeArtifact(code: string, language?: string): string {
  const lang = language || detectLanguage(code);
  if (window.Prism) {
    const highlighted = window.Prism.highlight(code, window.Prism.languages[lang] || window.Prism.languages.plaintext, lang);
    return `<pre class="language-${lang}" style="margin:0;border-radius:12px;font-size:13px;line-height:1.5"><code class="language-${lang}">${highlighted}</code></pre>`;
  }
  return `<pre style="margin:0;background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:12px;overflow-x:auto;font-size:13px;line-height:1.5"><code>${escapeHtml(code)}</code></pre>`;
}

export function renderHtmlArtifact(code: string): string {
  return sanitizeHtml(code);
}

export function renderSvgArtifact(code: string): string {
  return code;
}

export function renderMermaidArtifact(code: string): string {
  const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  setTimeout(async () => {
    try {
      const el = document.getElementById(id);
      if (el && window.mermaid) {
        const { svg } = await window.mermaid.render(`${id}-svg`, code);
        el.innerHTML = svg;
      }
    } catch (e) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<pre class="text-red-500">Mermaid render error: ${escapeHtml(String(e))}</pre>`;
    }
  }, 100);
  return `<div id="${id}" class="mermaid-placeholder p-4 text-center text-[#8c8576]">Rendering diagram...</div>`;
}

export function renderReactArtifact(code: string): string {
  const encoded = encodeURIComponent(code);
  const sandboxAttrs = 'allow-scripts';
  return `<iframe sandbox="${sandboxAttrs}" srcdoc="${getReactSandboxHtml(encoded)}" style="width:100%;min-height:300px;border:1px solid #e5e1d8;border-radius:12px;overflow:hidden"></iframe>`;
}

function getReactSandboxHtml(encodedCode: string): string {
  const decoded = decodeURIComponent(encodedCode);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
  <style>body{font-family:system-ui,sans-serif;margin:16px;background:#fff;color:#1a1a1a}</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-type="module">
${decoded}
    const container = document.getElementById('root');
    if (typeof App !== 'undefined') {
      ReactDOM.createRoot(container).render(React.createElement(App));
    }
  <\/script>
</body>
</html>`;
}

function detectLanguage(code: string): string {
  if (/^\s*(import|export|const|let|var|function|class|=>|async|await)/.test(code)) return 'javascript';
  if (/^\s*from\s+|import\s/.test(code) && /def\s|class\s|print\(/.test(code)) return 'python';
  if (/<[a-z][\s\S]*>/i.test(code)) return 'markup';
  return 'plaintext';
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/on\w+\s*=\s*'[^']*'/gi, '');
}

declare global {
  interface Window {
    Prism: any;
    mermaid: any;
  }
}