import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { apiError, createRequestId, jsonResponse } from '../../lib/api-response';
import { checkCSRF } from '../../lib/csrf';
import { readEnvKeys } from '../../lib/env-reader';
import { startCleanupInterval } from '../../lib/runtime-interval';

const MAX_TEXTS_PER_REQUEST = 10;
const MAX_TEXT_LENGTH = 2000;
const RATE_LIMIT_WINDOW = 60_000;
// A max-size document (~500 chunks) embeds in ~50 batched requests; the
// window cap must clear that plus follow-up query embeds in one minute.
const MAX_REQUESTS_PER_WINDOW = 120;
const MAX_DAILY_EMBED = 800;
const EMBED_TIMEOUT_MS = 12_000;
const MAX_BODY = 10 * 1024;

const dailyEmbedCounts = new Map<string, number>();
let dailyEmbedReset = Date.now() + 86400000;

if (typeof setInterval !== 'undefined') {
  startCleanupInterval(() => {
    const now = Date.now();
    if (now > dailyEmbedReset) { dailyEmbedCounts.clear(); dailyEmbedReset = now + 86400000; }
  }, 300_000);
}

async function verifyTurnstileToken(token: string, secret: string): Promise<boolean> {
  if (!token || !secret) return true;
  try {
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const data = await res.json() as any;
    return !!data.success;
  } catch { return false; }
}

interface RateLimitEntry { count: number; reset: number; }
const rateLimits = new Map<string, RateLimitEntry>();

if (typeof setInterval !== 'undefined') {
  startCleanupInterval(() => {
    const now = Date.now();
    rateLimits.forEach((v, k) => { if (now > v.reset) rateLimits.delete(k); });
  }, 60_000);
}

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = createRequestId();
  let env: any = {};
  try { if (cfGlobalEnv) env = { ...(cfGlobalEnv as any) }; } catch (e) {}
  try { const rEnv = (locals as any)?.runtime?.env; if (rEnv) for (const [k, v] of Object.entries(rEnv)) { if (v != null && !env[k]) env[k] = v; } } catch (e) {}
  readEnvKeys(env);

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

  if (!checkCSRF(request)) {
    return apiError({ requestId, status: 403, code: 'FORBIDDEN', message: 'Request origin is not allowed.' });
  }

  const dailyCount = (dailyEmbedCounts.get(ip) || 0) + 1;
  dailyEmbedCounts.set(ip, dailyCount);
  if (dailyCount > MAX_DAILY_EMBED) {
    return apiError({ requestId, status: 429, code: 'DAILY_EMBED_LIMIT', message: 'Daily embedding limit reached. Please try again later.' });
  }

  const devIPs = (env.DEV_IPS || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  const isDev = devIPs.includes(ip);
  if (!isDev && env.TURNSTILE_SECRET_KEY) {
    try {
      const body = await request.clone().json().catch(() => null);
      if (body?.turnstileToken) {
        const ok = await verifyTurnstileToken(body.turnstileToken, env.TURNSTILE_SECRET_KEY);
        if (!ok) {
          return apiError({ requestId, status: 403, code: 'CAPTCHA_FAILED', message: 'Verification failed. Please try again.', retryable: true });
        }
      }
    } catch {}
  }

  const now = Date.now();
  const rl = rateLimits.get(ip);
  if (rl && now < rl.reset) {
    if (rl.count >= MAX_REQUESTS_PER_WINDOW) {
      return apiError({ requestId, status: 429, code: 'RATE_LIMITED', message: 'Too many embed requests. Wait a minute.', retryable: true, retryAfter: 60 });
    }
    rl.count++;
  } else {
    rateLimits.set(ip, { count: 1, reset: now + RATE_LIMIT_WINDOW });
  }

  if (!env.AI) {
    return apiError({ requestId, status: 503, code: 'EMBEDDING_UNAVAILABLE', message: 'Embedding service not available.', retryable: true, retryAfter: 5 });
  }

  try {
    if (Number(request.headers.get('content-length') || '0') > MAX_BODY) {
      return apiError({ requestId, status: 413, code: 'BODY_TOO_LARGE', message: 'Request body is too large.' });
    }
    const body = await request.json().catch(() => null);
    if (!body?.texts || !Array.isArray(body.texts)) {
      return apiError({ requestId, status: 400, code: 'INVALID_REQUEST', message: 'Expected { texts: string[] }.' });
    }

    const texts: string[] = body.texts.slice(0, MAX_TEXTS_PER_REQUEST).map((t: any) => String(t).slice(0, MAX_TEXT_LENGTH));
    const validTexts = texts.filter(t => t.trim().length > 0);

    if (validTexts.length === 0) {
      return jsonResponse({ vectors: [], errors: ['No valid texts provided'] }, { requestId });
    }

    const aiResponse = await Promise.race([
      env.AI.run('@cf/baai/bge-small-en-v1.5', { text: validTexts }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), EMBED_TIMEOUT_MS)),
    ]) as any;

    if (!aiResponse?.data || !Array.isArray(aiResponse.data)) {
      return apiError({ requestId, status: 502, code: 'EMBEDDING_FAILED', message: 'Could not generate embeddings.', retryable: true, retryAfter: 5 });
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

    return jsonResponse({ vectors, errors }, { requestId });
  } catch {
    console.log(JSON.stringify({ event: 'embed_failure' }));
    return apiError({
      requestId,
      status: 500,
      code: 'EMBEDDING_FAILED',
      message: 'Embedding failed.',
      retryable: true,
      retryAfter: 5,
    });
  }
};
