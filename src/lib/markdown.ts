import { marked } from 'marked';
import DOMPurify from 'dompurify';

const DIAGRAM_LANGS = new Set([
  'html',
  'htm',
  'svg',
  'mermaid',
  'mmd',
  'graphviz',
  'dot',
  'd2',
  'plantuml',
  'puml',
  'flowchart',
  'markmap',
  'markdown',
  'md',
  'vega',
  'vega-lite',
  'vegalite',
  'katex',
  'latex',
  'tex',
]);

const renderer = new marked.Renderer();
const origCode = renderer.code.bind(renderer);
renderer.code = function(token: { text: string; lang?: string; escaped?: boolean }) {
  const lang = (token.lang || '').toLowerCase();
  if (DIAGRAM_LANGS.has(lang)) return '';
  return origCode({ text: token.text, lang: token.lang, escaped: token.escaped } as any);
};

marked.setOptions({ renderer, breaks: true, gfm: true });

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function stripDisclaimers(text: string): string {
  return text
    .replace(/\b(my|our) (training data|knowledge) (only goes|ended|cutoff).*?(20\d{2}|20\d{2}\.)/gi, '')
    .replace(/\bPlease note that (my|our) (knowledge|training|information).*?\.\s*/gi, '')
    .replace(/\[Pre-2023 knowledge\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function formatMarkdown(text: string | null | undefined, sources?: { title: string; url: string }[]): string {
  if (!text) return '';

  let formatted = String(text);

  if (sources && sources.length > 0) {
    formatted = formatted.replace(/\[(\d+)\]/g, (_, num) => {
      const idx = parseInt(num) - 1;
      if (sources[idx]) {
        return `<sup class="citation"><a href="${escapeHtml(sources[idx].url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(sources[idx].title)}" style="color:#2563eb;text-decoration:none;font-weight:600">[${num}]</a></sup>`;
      }
      return `<sup class="citation">[${num}]</sup>`;
    });
  } else {
    formatted = formatted.replace(/\[(\d+)\]/g, '<sup class="citation">[$1]</sup>');
  }

  const html = marked.parse(formatted) as string;
  if (typeof DOMPurify?.sanitize === 'function') {
    return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','strong','em','code','pre','a','ul','ol','li','blockquote','table','thead','tbody','tr','th','td','hr','sup','sub','img','span','div','del','input'], ALLOWED_ATTR: ['href','target','rel','title','class','style','src','alt','width','height','checked','type','id'] });
  }
  return html;
}
