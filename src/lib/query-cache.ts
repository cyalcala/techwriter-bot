const CACHE_TTL = 900;
const NORMALIZE_RE = /[^\w\s]/g;

function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(NORMALIZE_RE, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function sha256(text: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function cacheKey(hash: string): string {
  return `qcache:${hash.slice(0, 16)}`;
}

export interface CachedResponse {
  text: string;
  provider: string;
  searchTier: string;
  path: string;
  cached: boolean;
  ts: number;
}

export async function checkCache(kv: any, query: string): Promise<{ hit: boolean; response?: CachedResponse }> {
  if (!kv) return { hit: false };
  try {
    const hash = await sha256(normalizeQuery(query));
    const key = cacheKey(hash);
    const raw = await kv.get(key, 'json').catch(() => null);
    if (raw && Date.now() - raw.ts < CACHE_TTL * 1000) {
      return { hit: true, response: { ...raw, cached: true } };
    }
  } catch {}
  return { hit: false };
}

export async function writeCache(
  kv: any,
  query: string,
  text: string,
  provider: string,
  searchTier: string,
  path: string,
): Promise<void> {
  if (!kv) return;
  try {
    const hash = await sha256(normalizeQuery(query));
    const key = cacheKey(hash);
    const value: CachedResponse = { text, provider, searchTier, path, cached: false, ts: Date.now() };
    await kv.put(key, JSON.stringify(value), { expirationTtl: CACHE_TTL });
  } catch {}
}
