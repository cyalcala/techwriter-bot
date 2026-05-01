import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { routeChat, getCircuitDiagnostics, runHealthCheck } from '../../lib/zen-router';

interface RateLimitEntry { count: number; resetTime: number; }
const rateLimits = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;
const MAX_BODY_SIZE = 64 * 1024;

let healthCheckDone = false;

const dailyUsage = new Map<string, number>();
const DAILY_CAP = 500;
let dailyReset = Date.now() + 86400000;

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    rateLimits.forEach((v, k) => { if (now > v.resetTime) rateLimits.delete(k); });
    if (now > dailyReset) { dailyUsage.clear(); dailyReset = now + 86400000; }
  }, 60_000);
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetTime) { rateLimits.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW }); return true; }
  if (entry.count >= MAX_REQUESTS_PER_WINDOW) return false;
  entry.count++; return true;
}

function sanitizeInput(input: any): any {
  if (typeof input === 'string') return input.slice(0, 8000).replace(/[\x00-\x1F\x7F]/g, '');
  if (Array.isArray(input)) return input.map(sanitizeInput);
  if (input && typeof input === 'object') {
    const sanitized: any = {};
    for (const key of ['role', 'content', 'name']) { if (input[key] != null) sanitized[key] = sanitizeInput(input[key]); }
    return sanitized;
  }
  return input;
}

const GREETING_PATTERNS = /^(hi|hello|hey|yo|sup|howdy|heya|hola|good\s?(morning|afternoon|evening|night)|what'?s\s?up|how('s| is) it going|how are (you|u)|what is (up|good)|greetings|hai|helo|helo there|hi there|hello there|hey there|okay|ok|nice|wassup|wsup|nm|nmu|not much)\b/i;
const SELF_REF_PATTERNS = /^(who are (you|u)|what are (you|u)|your name|what('?s| is) your name|tell me about yourself|introduce yourself|what do you do|what can you do)\b/i;

function shouldSearch(query: string): boolean {
  if (!query || query.length < 2) return false;
  const trimmed = query.trim();
  if (trimmed.length <= 2) return false;
  if (GREETING_PATTERNS.test(trimmed)) return false;
  if (SELF_REF_PATTERNS.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount <= 1 && trimmed.length <= 10) return false;
  return true;
}

async function retrieveRagContext(env: any, sessionId: string, query: string): Promise<string | null> {
  if (!env.AI || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const embResult = await env.AI.run('@cf/baai/bge-small-en-v1.5', { text: [query] });
    const embedding = embResult?.data?.[0];
    if (!embedding) {
      console.log(JSON.stringify({ event: 'rag_no_embedding', sessionId }));
      return null;
    }
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase.rpc('match_notes', {
      query_embedding: embedding, match_threshold: 0.4, match_count: 3, p_session_id: sessionId,
    });
    if (error) {
      console.log(JSON.stringify({ event: 'rag_rpc_error', message: error.message?.slice(0, 200), sessionId }));
      return null;
    }
    if (!data?.length) return null;
    return data.map((r: any, i: number) => `[Doc Chunk ${i + 1}] ${r.content}`).join('\n\n');
  } catch (e: any) {
    console.log(JSON.stringify({ event: 'rag_failure', message: e.message?.slice(0, 200), sessionId }));
    return null;
  }
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
  } catch (e: any) {
    console.log(JSON.stringify({ event: 'turnstile_verify_error', message: e.message?.slice(0, 200) }));
    return false;
  }
}

const searchCache = new Map<string, { result: string; ts: number }>();
const SEARCH_CACHE_MS = 300_000;
const SEARCH_TIMEOUT_MS = 1500;

function searchCacheKey(query: string): string {
  return query.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 80);
}

async function searchWeb(query: string): Promise<string | null> {
  if (!shouldSearch(query)) return null;

  const key = searchCacheKey(query);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_MS) return cached.result;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);

    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      console.log(JSON.stringify({ event: 'search_failed', status: res.status, query: query.slice(0, 80) }));
      return null;
    }

    const data = await res.json() as any;
    const parts: string[] = [];

    if (data.Answer) parts.push(`Direct answer: ${data.Answer}`);
    if (data.AbstractText) parts.push(data.AbstractText);
    if (data.Definition) parts.push(`Definition: ${data.Definition}`);
    if (data.Heading) parts.push(`Topic: ${data.Heading}`);

    const topics = data.RelatedTopics?.slice(0, 5)?.filter((t: any) => t.Text)?.map((t: any) => `- ${t.Text}`) || [];
    if (topics.length) parts.push(`Related:\n${topics.join('\n')}`);

    const results = data.Results?.slice(0, 3)?.filter((r: any) => r.Text)?.map((r: any) => `- ${r.FirstURL}: ${r.Text}`) || [];
    if (results.length) parts.push(`Web results:\n${results.join('\n')}`);

    if (parts.length === 0) {
      const q = query.toLowerCase();
      const altQuery = q.includes('time') ? `${query.replace(/today|now|current/gi, '')} philippines time zone` : `${query} facts`;
      const res2 = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(altQuery)}&format=json&no_html=1`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res2.ok) {
        const d2 = await res2.json() as any;
        if (d2.AbstractText) parts.push(d2.AbstractText);
        if (d2.Answer) parts.push(`Answer: ${d2.Answer}`);
      }
    }

    if (parts.length === 0) return null;

    const result = parts.join('\n\n');
    searchCache.set(key, { result, ts: Date.now() });
    return result;
  } catch (e: any) {
    console.log(JSON.stringify({ event: 'search_error', message: e.message?.slice(0, 200), query: query.slice(0, 80) }));
    return null;
  }
}

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({
    status: 'ok',
    circuits: getCircuitDiagnostics(),
    dailyRequests: [...dailyUsage.entries()].reduce((a, [, c]) => a + c, 0),
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async (context) => {
  const { request, locals } = context;

  let env: any = {};
  try { if (cfGlobalEnv) env = { ...(cfGlobalEnv as any) }; } catch (e) {}
  try { const rEnv = (locals as any)?.runtime?.env; if (rEnv) for (const [k, v] of Object.entries(rEnv)) { if (v != null && !env[k]) env[k] = v; } } catch (e) {}
  if (typeof process !== 'undefined' && process.env) { for (const [k, v] of Object.entries(process.env)) { if (v && !env[k]) env[k] = v; } }

  if (!healthCheckDone && env) {
    healthCheckDone = true;
    try { runHealthCheck(env); } catch (e) {}
  }

  const clientIP = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

  if (!checkRateLimit(clientIP)) {
    return new Response(JSON.stringify({ error: 'rate_limit' }), { status: 429 });
  }

  const dailyCount = (dailyUsage.get(clientIP) || 0) + 1;
  dailyUsage.set(clientIP, dailyCount);
  if (dailyCount > DAILY_CAP) {
    return new Response(JSON.stringify({ error: 'daily_limit' }), { status: 429 });
  }

  if (Number(request.headers.get('content-length') || '0') > MAX_BODY_SIZE) {
    return new Response(JSON.stringify({ error: 'request_too_large' }), { status: 413 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body?.messages || !Array.isArray(body.messages)) {
      return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 });
    }

    if (env.TURNSTILE_SECRET_KEY) {
      await verifyTurnstileToken(body.turnstileToken, env.TURNSTILE_SECRET_KEY);
    }

    let messages = sanitizeInput(body.messages);
    const sessionId = String(body.sessionId || '');
    const hasRag = body.hasRag === true && sessionId;

    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
    const userQuery = lastUserMsg?.content || '';

    const [ragContext, webContext] = await Promise.all([
      hasRag ? retrieveRagContext(env, sessionId, userQuery) : null,
      userQuery ? searchWeb(userQuery) : null,
    ]);

    const contextParts: string[] = [];
    if (webContext) contextParts.push(`[Web search results for reference — use only if relevant to the query]\n${webContext}`);
    if (ragContext) contextParts.push(`[Document excerpts]\n${ragContext}`);

    if (contextParts.length > 0) {
      messages = [
        { role: 'system', content: `You are a helpful technical writing assistant. You may reference the context below if it helps answer the user's query. If the context is irrelevant or the user is just greeting you, ignore it and respond naturally. Do not fabricate or force connections to the context.\n\n${contextParts.join('\n\n')}` },
        ...messages,
      ];
    }

    return await routeChat(body.intent || 'chat-fast', messages, locals, env, sessionId);
  } catch (error: any) {
    console.log(JSON.stringify({ event: 'processing_error', message: error.message?.slice(0, 200) }));
    return new Response(JSON.stringify({
      error: 'processing_error',
      message: 'An unexpected error occurred. Please try again.',
      retryAfter: 5,
    }), { status: 500, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' } });
  }
};