const KROKI_BASE = 'https://kroki.io';
const KROKI_TIMEOUT_MS = 10_000;
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

  const tryOnce = async (): Promise<{ svg?: string; error?: string; cached?: boolean; status?: number; retryable?: boolean }> => {
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
        const isPermanent = res.status >= 400 && res.status < 500;
        return { error: errText.slice(0, 300), status: res.status, retryable: !isPermanent };
      }

      const svg = sanitizeSvg(await res.text());
      if (!/<svg\b/i.test(svg)) return { error: 'Renderer did not return SVG.', retryable: false };
      if (kv) {
        kv.put(cacheKey, svg, { expirationTtl: CACHE_TTL_SECONDS }).catch(() => {});
      }
      return { svg };
    } catch (e: any) {
      const isTimeout = e.name === 'AbortError';
      return { error: `Kroki ${isTimeout ? 'timeout' : 'unavailable'}: ${e.message?.slice(0, 100)}`, retryable: true };
    }
  };

  const first = await tryOnce();
  if (first.svg || !first.retryable) return first;

  // Single retry for transient (5xx/network) errors only, after 2s
  await new Promise(r => setTimeout(r, 2000));
  const second = await tryOnce();
  return { svg: second.svg, error: second.error, status: second.status, cached: second.cached };
}

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[\w:-]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[\w:-]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[\w:-]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s(href|src|xlink:href)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '');
}
