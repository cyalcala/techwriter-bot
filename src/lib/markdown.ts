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

const DIAGRAM_LANGS = new Set(['mermaid', 'graphviz', 'dot', 'd2', 'plantuml', 'puml', 'flowchart', 'markmap', 'vega', 'vega-lite', 'katex', 'block', 'webcontainer']);

function wrapLines(text: string, streaming: boolean): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBuf = '';
  let codeLang = '';
  let skipBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        if (!skipBlock) {
          result.push(`<pre class="bg-[#0d1117] rounded-xl overflow-hidden my-3 group relative"><div class="flex items-center justify-between px-4 py-1.5 bg-stone-800/50 text-stone-400 text-[10px]"><span>${codeLang || 'code'}</span><button class="hover:text-white transition-colors" onclick="navigator.clipboard.writeText(this.closest('pre').querySelector('code').textContent);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)">Copy</button></div><code class="block p-4 text-[13px] leading-relaxed overflow-x-auto text-stone-100 font-mono">${escapeHtml(codeBuf.trim())}</code></pre>`);
        }
        codeBuf = '';
        codeLang = '';
        skipBlock = false;
        inCodeBlock = false;
      } else {
        if (streaming && isLast) break;
        codeLang = line.slice(3).trim().toLowerCase();
        skipBlock = DIAGRAM_LANGS.has(codeLang);
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      if (!skipBlock) {
        codeBuf += (codeBuf ? '\n' : '') + line;
      }
      if (!streaming || !isLast) continue;
      result.push(`<pre class="bg-[#0d1117] rounded-xl overflow-hidden my-3"><code class="block p-4 text-[13px] leading-relaxed overflow-x-auto text-stone-100 font-mono">${escapeHtml(codeBuf)}</code></pre>`);
      continue;
    }

    if (streaming && isLast) break;

    let processed = line;

    if (/^###\s/.test(processed)) {
      processed = `<h4 class="text-base font-semibold text-stone-800 mt-4 mb-1">${escapeHtml(processed.replace(/^###\s/, ''))}</h4>`;
    } else if (/^##\s/.test(processed)) {
      processed = `<h3 class="text-lg font-semibold text-stone-800 mt-5 mb-2">${escapeHtml(processed.replace(/^##\s/, ''))}</h3>`;
    } else if (/^#\s/.test(processed)) {
      processed = `<h2 class="text-xl font-bold text-stone-900 mt-6 mb-3">${escapeHtml(processed.replace(/^#\s/, ''))}</h2>`;
    } else if (/^>\s/.test(processed)) {
      processed = `<blockquote class="border-l-2 border-amber-400 pl-4 my-3 italic text-stone-500">${escapeHtml(processed.replace(/^>\s/, ''))}</blockquote>`;
    } else if (/^-\s/.test(processed)) {
      processed = `<li class="ml-4 list-disc text-stone-700 my-1">${escapeHtml(processed.replace(/^-\s/, ''))}</li>`;
    } else {
      processed = escapeHtml(processed);
    }

    processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-stone-900">$1</strong>');
    processed = processed.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em class="italic text-stone-500">$1</em>');
    processed = processed.replace(/`([^`\n]+?)`/g, '<code class="bg-stone-100 px-1.5 py-0.5 rounded text-sm font-mono text-stone-700">$1</code>');

    result.push(processed);
  }

  return result.join('\n');
}

export function formatMarkdown(text: string | null | undefined, sources?: { title: string; url: string }[], streaming: boolean = false): string {
  if (!text) return '';
  let formatted = String(text);

  if (sources && sources.length > 0) {
    formatted = formatted.replace(/\[(\d+)\]/g, (_, num) => {
      const idx = parseInt(num) - 1;
      if (sources[idx]) {
        return `<sup class="citation"><a href="${sources[idx].url}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(sources[idx].title)}" style="color:#2563eb;text-decoration:none;font-weight:600">[${num}]</a></sup>`;
      }
      return `<sup class="citation">[${num}]</sup>`;
    });
  } else {
    formatted = formatted.replace(/\[(\d+)\]/g, '<sup class="citation">[$1]</sup>');
  }

  return wrapLines(formatted, streaming);
}
