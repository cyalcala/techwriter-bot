const KROKI_BASE = 'https://kroki.io';
const KROKI_TIMEOUT_MS = 20_000;
const CACHE_TTL_SECONDS = 86400;

const TYPE_MAP: Record<string, string> = {
  mermaid: 'mermaid',
  graphviz: 'graphviz',
  d2: 'd2',
  plantuml: 'plantuml',
  vega: 'vega',
  flowchart: 'mermaid',
};

export const KROKI_RENDERABLE = new Set(['mermaid', 'graphviz', 'd2', 'plantuml', 'vega', 'flowchart']);
export const CLIENT_ONLY_TYPES = new Set(['code', 'html', 'svg', 'react', 'katex', 'markmap', 'webcontainer']);

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function renderViaKroki(type: string, code: string, kv: any): Promise<{ svg?: string; error?: string; cached?: boolean; status?: number }> {
  const krokiType = TYPE_MAP[type] || type;
  const hash = await sha256(krokiType + code);
  const cacheKey = `kroki:${hash.slice(0, 20)}`;

  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) return { svg: cached, cached: true };
    } catch {}
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), KROKI_TIMEOUT_MS);
    const res = await fetch(`${KROKI_BASE}/${krokiType}/svg`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: code,
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      return { error: errText.slice(0, 300), status: res.status };
    }

    const svg = sanitizeSvg(await res.text());
    if (!/<svg\b/i.test(svg)) return { error: 'Renderer did not return SVG.' };
    if (kv) {
      kv.put(cacheKey, svg, { expirationTtl: CACHE_TTL_SECONDS }).catch(() => {});
    }
    return { svg };
  } catch (e: any) {
    return { error: `Kroki unavailable: ${e.message?.slice(0, 100)}` };
  }
}

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[\w:-]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[\w:-]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[\w:-]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s(href|src|xlink:href)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '');
}
