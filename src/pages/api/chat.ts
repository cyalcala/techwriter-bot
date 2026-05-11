import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { routeChat, getCircuitDiagnostics, initCircuitKV, type ResponseMetadata } from '../../lib/zen-router';
import { searchRouter } from '../../lib/search';
import { buildSystemPrompt, type SearchResult, type PromptContext } from '../../lib/prompts';
import { readEnvKeys, checkEnvKeys } from '../../lib/env-reader';
import { updateReputation, getDefaultState, deserializeReputation, serializeReputation, getTierProviderPool, getDailyLimits, type ReputationState } from '../../lib/reputation';
import { determineChatPath, isArtifactGenerationRequest } from '../../lib/path-router';
import { ensureGraph, queryGraph, getGraphStats } from '../../lib/graph-query';
import { logTokenUsage, estimateTokens, isWithinBudget, getTokenStats } from '../../lib/token-counter';
import { checkCache } from '../../lib/query-cache';

const rateLimits = new Map<string, { count: number; reset: number }>();
const RATE_WINDOW = 60_000;
const MAX_RATE = 20;
const MAX_BODY = 64 * 1024;
const dailyUsage = new Map<string, number>();
let dailyReset = Date.now() + 86400000;

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateLimits) { if (now > v.reset) rateLimits.delete(k); }
    if (now > dailyReset) { dailyUsage.clear(); dailyReset = now + 86400000; }
  }, 60_000);
}

async function bindSession(sid: string, ip: string, ua: string): Promise<string> {
  const data = `${sid}|${ip}|${ua.slice(0, 100)}`;
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return `s_${hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

function validateMessages(msgs: any[]): boolean {
  if (!Array.isArray(msgs)) return false;
  for (const m of msgs) {
    if (!m || typeof m !== 'object') return false;
    if (!['user', 'assistant', 'system'].includes(m.role)) return false;
    if (typeof m.content !== 'string') return false;
  }
  return true;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const e = rateLimits.get(ip);
  if (!e || now > e.reset) { rateLimits.set(ip, { count: 1, reset: now + RATE_WINDOW }); return true; }
  if (e.count >= MAX_RATE) return false;
  e.count++; return true;
}

const ALLOWED_ORIGINS = ['https://tw-bot.pages.dev', 'https://techwriter-bot.pages.dev', 'http://localhost:4321', 'http://localhost:3000'];

function checkCSRF(req: Request): boolean {
  const origin = req.headers.get('origin'); const referer = req.headers.get('referer');
  if (!origin && !referer) return true;
  const ok = (url: string) => { try { const p = new URL(url); return ALLOWED_ORIGINS.some(a => `${p.protocol}//${p.host}`.startsWith(a) || a.startsWith(`${p.protocol}//${p.host}`)); } catch { return false; } };
  if (origin && !ok(origin)) return false;
  if (referer && !ok(referer)) return false;
  return true;
}

function sanitizeInput(input: any): any {
  if (typeof input === 'string') return input.slice(0, 8000).replace(/[\x00-\x1F\x7F]/g, '');
  if (Array.isArray(input)) return input.map(sanitizeInput);
  if (input && typeof input === 'object') { const s: any = {}; for (const k of ['role', 'content', 'name']) { if (input[k] != null) s[k] = sanitizeInput(input[k]); } return s; }
  return input;
}

async function verifyTurnstile(token: string, secret: string): Promise<boolean> {
  if (!token || !secret) return true;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new FormData(), signal: ctrl.signal });
    clearTimeout(t);
    r.body?.cancel();
    const d = await r.json() as any;
    return !!d.success;
  } catch { return true; }
}

function isBotUA(ua: string): boolean {
  const bots = ['curl', 'wget', 'python', 'go-http', 'bot', 'scrape', 'crawler', 'spider', 'headless', 'axios', 'node-fetch', 'libwww'];
  return !ua || bots.some(p => ua.toLowerCase().includes(p)) || ua.length < 10;
}

const DC_ASNS = new Set(['14061', '24940', '16276', '51167', '200130', '202448', '13213', '60068', '20473', '202015', '201206', '197133']);
function isDC(asn: string): boolean { return !!asn && DC_ASNS.has(asn.replace(/[^0-9]/g, '')); }

function loadEnv(locals: any): any {
  const env: any = {};
  try { if (cfGlobalEnv) Object.assign(env, cfGlobalEnv); } catch {}
  try { const r = (locals as any)?.runtime?.env; if (r) for (const [k, v] of Object.entries(r)) { if (v != null && !env[k]) env[k] = v; } } catch {}
  readEnvKeys(env);
  return env;
}

async function getReputation(kv: any, ip: string, headers: Headers): Promise<ReputationState> {
  let s = getDefaultState();
  if (kv) { try { const raw = await kv.get(`reputation:${ip}`); if (raw) s = deserializeReputation(raw); } catch {} }
  const ua = headers.get('user-agent') || '';
  if (isBotUA(ua)) s = updateReputation(s, 'bot_ua', { userAgent: ua });
  else if (headers.get('cf-bot-score') && parseFloat(headers.get('cf-bot-score')!) >= 1) s = updateReputation(s, 'bot_ua', { userAgent: ua });
  if (isDC(headers.get('cf-asn') || '')) s = updateReputation(s, 'datacenter_ip', { ip });
  return updateReputation(s, 'request');
}

async function searchRagKV(kv: any, sessionId: string, query: string): Promise<string> {
  if (!kv) return '';
  try {
    const raw = await kv.get(`rag:${sessionId}`);
    if (!raw) return '';
    const vectors: { text: string; vector: number[]; timestamp: number }[] = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!vectors?.length) return '';

    const qTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (qTerms.length === 0) {
      const parts = vectors.slice(0, 3).map((v, i) => `[Doc ${i + 1}] ${v.text.slice(0, 400)}`);
      return `DOCUMENT CONTEXT (recent excerpts):\n${parts.join('\n\n')}`;
    }

    const scored = vectors.map((v, i) => {
      const lower = v.text.toLowerCase();
      let score = 0;
      for (const term of qTerms) {
        let idx = 0;
        while ((idx = lower.indexOf(term, idx)) !== -1) { score++; idx += term.length; }
      }
      return { text: v.text, score, idx: i };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter(v => v.score > 0).slice(0, 3);

    if (top.length === 0) {
      const parts = vectors.slice(0, 3).map((v, i) => `[Doc ${i + 1}] ${v.text.slice(0, 300)}`);
      return `DOCUMENT CONTEXT (keyword match weak — showing recent excerpts):\n${parts.join('\n\n')}`;
    }

    const extractKeyPoints = (text: string, max: number = 300): string => {
      const sentences = text.split(/[.!?]\s+/);
      let result = '';
      for (const s of sentences) {
        if (s.length < 10) continue;
        if (result.length + s.length > max) break;
        result += (result ? '. ' : '') + s;
      }
      return result || text.slice(0, max);
    };

    return `DOCUMENT CONTEXT:\n${top.map((c, i) => `[Point ${i + 1}] (match: ${c.score}) ${extractKeyPoints(c.text)}`).join('\n')}`;
  } catch {
    return '';
  }
}

export const GET: APIRoute = async ({ request, locals }) => {
  const env = loadEnv(locals);
  const graphStats = getGraphStats();
  const tokenStats = await getTokenStats(env.SESSION);
  return new Response(JSON.stringify({
    status: 'ok', circuits: getCircuitDiagnostics(),
    dailyRequests: [...dailyUsage.entries()].reduce((a, [, c]) => a + c, 0),
    keys: checkEnvKeys(env),
    clientIP: request.headers.get('cf-connecting-ip') || 'unknown',
    graph: graphStats || { available: false },
    tokenUsage: tokenStats,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async (ctx) => {
  const { request, locals } = ctx;
  const rid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const log = (event: string, data?: any) => console.log(JSON.stringify({ rid, event, ...(data || {}) }));
  const env = loadEnv(locals);
  if (env.SESSION) initCircuitKV(env.SESSION);
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

  if (!checkCSRF(request)) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  if (!checkRateLimit(ip)) return new Response(JSON.stringify({ error: 'rate_limit' }), { status: 429 });

  const devIPs = (env.DEV_IPS || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  const isDev = devIPs.includes(ip);

  let rep = getDefaultState();
  if (!isDev) {
    rep = await getReputation(env.SESSION, ip, request.headers);
    if (rep.tier === 'blocked') return new Response(JSON.stringify({ error: 'access_denied', message: 'Access temporarily suspended.' }), { status: 403 });
    const dc = (dailyUsage.get(ip) || 0) + 1; dailyUsage.set(ip, dc);
    if (dc > getDailyLimits(rep.tier).chatPerDay) return new Response(JSON.stringify({ error: 'daily_limit' }), { status: 429 });
  } else {
    const dc = (dailyUsage.get(ip) || 0) + 1; dailyUsage.set(ip, dc);
    if (dc > 500) return new Response(JSON.stringify({ error: 'daily_limit' }), { status: 429 });
  }

  if (Number(request.headers.get('content-length') || '0') > MAX_BODY) return new Response(JSON.stringify({ error: 'too_large' }), { status: 413 });

  try {
    const body = await request.json().catch(() => null);
    if (!body?.messages || !Array.isArray(body.messages)) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 });
    if (!validateMessages(body.messages)) return new Response(JSON.stringify({ error: 'invalid_messages' }), { status: 400 });

    if (env.TURNSTILE_SECRET_KEY) {
      const ok = await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET_KEY);
      if (!ok) { if (!isDev) rep = updateReputation(rep, 'turnstile_fail'); return new Response(JSON.stringify({ error: 'captcha_failed' }), { status: 403 }); }
      if (!isDev) rep = updateReputation(rep, 'turnstile_pass');
    }

    const ua = request.headers.get('user-agent') || '';
    const sessionId = body.sessionId ? await bindSession(String(body.sessionId), ip, ua) : '';

    let messages = sanitizeInput(body.messages);
    const liveSearch = !!body.liveSearch;
    const hasDocument = !!body.hasDocument;
    const clientSessionId = body.sessionId || '';
    const lastMsg = [...messages].reverse().find((m: any) => m.role === 'user');
    const query = lastMsg?.content || '';
    const msgLen = query.length;

    const idempotencyKey = body.idempotencyKey || '';
    if (idempotencyKey && env.SESSION) {
      const existing = await env.SESSION.get(`idem:${idempotencyKey}`);
      if (existing) {
        const cached = JSON.parse(existing);
        return new Response(cached.body || '{}', { status: cached.status || 200, headers: new Headers(cached.headers || {}) });
      }
    }

    const cacheResult = await checkCache(env.SESSION, query);
    if (cacheResult.hit && cacheResult.response) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: cacheResult.response.text } }],
        provider: cacheResult.response.provider,
        searchTier: cacheResult.response.searchTier,
        path: cacheResult.response.path,
        cached: true,
      }), { headers: { 'Content-Type': 'text/event-stream', 'x-provider': cacheResult.response.provider, 'x-search-tier': cacheResult.response.searchTier, 'x-chat-path': cacheResult.response.path, 'x-cached': 'true' } });
    }

    if (!isDev) {
      rep = updateReputation(rep, 'dup_query', { message: query });
      rep = updateReputation(rep, 'natural_message', { message: query });
    }

    const pathCtx = determineChatPath(query, msgLen, body.intent || 'chat-fast', clientSessionId);
    log('path', { path: pathCtx.path, reason: pathCtx.reason });

    let searchResult: SearchResult = { contextParts: [], sources: [], searchTier: 'none', searchAttempted: false };
    let graphContextStr = '';
    let documentContextStr = '';

    if (pathCtx.path !== 'fast') {
      if (!pathCtx.skipSearch) {
        searchResult = await searchRouter(query, liveSearch, env, ip, rep);
      }

      if (pathCtx.includeGraph) {
        const graphAvail = await ensureGraph(env.SESSION);
        if (graphAvail.available) {
          const gctx = queryGraph(query);
          if (gctx.available) graphContextStr = gctx.context;
        }
      }

      if (hasDocument) {
        documentContextStr = await searchRagKV(env.SESSION, `rag:${clientSessionId}`, query);
        if (!documentContextStr) {
          documentContextStr = 'NOTE: User has uploaded a document, but its embeddings are unavailable. Ask them to re-upload if document context is needed.';
        }
      }
    }

    const needsArtifact = isArtifactGenerationRequest(query, messages);

    // For artifact requests: route as 'fast' for minimal latency but bump max tokens to 2048
    const effectivePath = needsArtifact ? 'fast' : pathCtx.path;

    const promptCtx: PromptContext = {
      path: effectivePath,
      graphContext: graphContextStr || undefined,
      documentContext: documentContextStr || undefined,
      searchResult,
      needsArtifact,
    };

    messages = [{ role: 'system', content: buildSystemPrompt(query, promptCtx) }, ...messages];

    if (!isDev && env.SESSION) {
      try { await env.SESSION.put(`reputation:${ip}`, serializeReputation(rep), { expirationTtl: 7200 }); } catch {}
    }

    if (!isWithinBudget(messages, needsArtifact ? 2048 : 2048, 4096)) {
      const trimmed = messages.slice(-12);
      if (!isWithinBudget(trimmed, 2048, 4096)) {
        return new Response(JSON.stringify({ error: 'token_budget_exceeded', message: 'Conversation too long. Start a new chat.' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
      }
      messages = messages.slice(0, 1).concat(trimmed);
    }

    const tier = isDev ? 'premium' : rep.tier;
    let pool = isDev
      ? (effectivePath === 'fast' ? ['groq-fast'] : ['groq-fast', 'gemini-flash'])
      : getTierProviderPool(tier).pool;

    if (needsArtifact) {
      // Keep session affinity for artifacts — lock to the session provider, don't cycle
      pool = isDev ? ['groq-fast'] : getTierProviderPool(tier).pool;
    } else if (effectivePath === 'fast') {
      pool = ['groq-fast', 'cerebras-llama', 'gemini-flash', 'cloudflare-llama'];
    }

    const forceSticky = needsArtifact;

    const meta: ResponseMetadata = {
      provider: null,
      searchTier: searchResult.searchTier,
      searchRemaining: searchResult.enhancedRemaining != null ? String(searchResult.enhancedRemaining) : (isDev ? 'unlimited' : '0'),
      tier: isDev ? 'dev' : tier,
      chatPath: effectivePath,
    };

    const response = await routeChat(
      effectivePath === 'fast' ? 'chat-fast' : body.intent || 'chat-fast',
      messages, locals, env, sessionId, searchResult.sources, meta, pool, effectivePath,
      forceSticky,
      needsArtifact ? 2048 : undefined,
    );

    const systemPrompt = messages.find((m: any) => m.role === 'system');
    const inputTokens = estimateTokens(systemPrompt?.content || '') + messages.slice(1).reduce((s: number, m: any) => s + estimateTokens(m.content || ''), 0);
    const graphTokens = graphContextStr ? estimateTokens(graphContextStr) : 0;
    logTokenUsage(env.SESSION, clientSessionId, meta.provider || 'unknown', inputTokens, 0).catch(() => {});

    if (env.SESSION) {
      if (idempotencyKey) {
        env.SESSION.put(`idem:${idempotencyKey}`, JSON.stringify({ status: 200, headers: { 'x-provider': meta.provider, 'x-search-tier': searchResult.searchTier, 'x-chat-path': pathCtx.path, 'Content-Type': 'text/event-stream' } }), { expirationTtl: 300 }).catch(() => {});
      }
    }

    const headers = new Headers(response.headers);
    headers.set('x-token-usage', JSON.stringify({ in: inputTokens, graph: graphTokens }));
    if (graphContextStr) headers.set('x-graph-context', JSON.stringify({ available: true, tokens: graphTokens }));

    return new Response(response.body, { status: response.status, headers });
  } catch (e: any) {
    log('error', { message: e.message?.slice(0, 200) });
    return new Response(JSON.stringify({ error: 'server_error', message: 'Unexpected error. Please try again.', retryAfter: 5 }), { status: 500, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' } });
  }
};
