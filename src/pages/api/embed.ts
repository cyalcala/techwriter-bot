import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';

const MAX_TEXTS_PER_REQUEST = 10;
const MAX_TEXT_LENGTH = 2000;
const RATE_LIMIT_WINDOW = 60_000;
const MAX_REQUESTS_PER_WINDOW = 100;
const EMBED_TIMEOUT_MS = 15_000;

const ALLOWED_ORIGINS = [
  'https://tw-bot.pages.dev',
  'https://techwriter-bot.pages.dev',
  'http://localhost:4321',
  'http://localhost:3000',
];

function checkCSRF(request: Request): boolean {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!origin && !referer) return true;
  const checkUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      const hostPart = `${parsed.protocol}//${parsed.host}`;
      return ALLOWED_ORIGINS.some(allowed => hostPart.startsWith(allowed) || allowed.startsWith(hostPart));
    } catch { return false; }
  };
  if (origin && !checkUrl(origin)) return false;
  if (referer && !checkUrl(referer)) return false;
  return true;
}

interface RateLimitEntry { count: number; reset: number; }
const rateLimits = new Map<string, RateLimitEntry>();

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    rateLimits.forEach((v, k) => { if (now > v.reset) rateLimits.delete(k); });
  }, 60_000);
}

export const POST: APIRoute = async ({ request, locals }) => {
  let env: any = {};
  try { if (cfGlobalEnv) env = { ...(cfGlobalEnv as any) }; } catch (e) {}
  try { const rEnv = (locals as any)?.runtime?.env; if (rEnv) for (const [k, v] of Object.entries(rEnv)) { if (v != null && !env[k]) env[k] = v; } } catch (e) {}
  if (typeof process !== 'undefined' && process.env) { for (const [k, v] of Object.entries(process.env)) { if (v && !env[k]) env[k] = v; } }

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

  if (!checkCSRF(request)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  const now = Date.now();
  const rl = rateLimits.get(ip);
  if (rl && now < rl.reset) {
    if (rl.count >= MAX_REQUESTS_PER_WINDOW) {
      return new Response(JSON.stringify({ error: 'rate_limit', message: 'Too many embed requests. Wait a minute.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }
    rl.count++;
  } else {
    rateLimits.set(ip, { count: 1, reset: now + RATE_LIMIT_WINDOW });
  }

  if (!env.AI) {
    return new Response(JSON.stringify({ error: 'service_unavailable', message: 'Embedding service not available.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body?.texts || !Array.isArray(body.texts)) {
      return new Response(JSON.stringify({ error: 'invalid_request', message: 'Expected { texts: string[] }' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const texts: string[] = body.texts.slice(0, MAX_TEXTS_PER_REQUEST).map((t: any) => String(t).slice(0, MAX_TEXT_LENGTH));
    const validTexts = texts.filter(t => t.trim().length > 0);

    if (validTexts.length === 0) {
      return new Response(JSON.stringify({ vectors: [], errors: ['No valid texts provided'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const aiResponse = await Promise.race([
      env.AI.run('@cf/baai/bge-small-en-v1.5', { text: validTexts }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), EMBED_TIMEOUT_MS)),
    ]) as any;

    if (!aiResponse?.data || !Array.isArray(aiResponse.data)) {
      return new Response(JSON.stringify({ error: 'embedding_failed', message: 'Could not generate embeddings.' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const vectors: number[][] = [];
    const errors: (string | null)[] = [];

    for (let i = 0; i < validTexts.length; i++) {
      if (aiResponse.data[i] && Array.isArray(aiResponse.data[i]) && aiResponse.data[i].length > 0) {
        vectors.push(aiResponse.data[i]);
        errors.push(null);
      } else {
        vectors.push([]);
        errors.push('Embedding returned empty for this chunk');
      }
    }

    return new Response(JSON.stringify({ vectors, errors }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.log(JSON.stringify({ event: 'embed_failure', message: error.message?.slice(0, 200) }));
    return new Response(JSON.stringify({ error: 'embedding_failed', message: error.message || 'Embedding failed.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};