import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { routeChat, initCircuitKV, type ResponseMetadata } from '../../lib/zen-router';
import { searchRouter } from '../../lib/search';
import { buildSystemPrompt, type SearchResult, type PromptContext } from '../../lib/prompts';
import { readEnvKeys } from '../../lib/env-reader';
import { updateReputation, getDefaultState, deserializeReputation, serializeReputation, getTierProviderPool, getDailyLimits, type ReputationState } from '../../lib/reputation';
import { determineChatPath, isArtifactGenerationRequest } from '../../lib/path-router';
import { ensureGraph, queryGraph } from '../../lib/graph-query';
import { logTokenUsage, estimateTokens, isWithinBudget } from '../../lib/token-counter';
import { apiError, createRequestId } from '../../lib/api-response';
import { getRequestLimits, sanitizeChatInput } from '../../lib/request-limits';
import { kvKey } from '../../lib/kv-prefix';
import { startCleanupInterval } from '../../lib/runtime-interval';
import { checkCSRF } from '../../lib/csrf';
import { parseProviderFaultInjection } from '../../lib/provider-fault-injection';

const rateLimits = new Map<string, { count: number; reset: number }>();
const RATE_WINDOW = 60_000;
const dailyUsage = new Map<string, number>();
let dailyReset = Date.now() + 86400000;

if (typeof setInterval !== 'undefined') {
  startCleanupInterval(() => {
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

function checkRateLimit(ip: string, limit: number): boolean {
  const now = Date.now();
  const e = rateLimits.get(ip);
  if (!e || now > e.reset) { rateLimits.set(ip, { count: 1, reset: now + RATE_WINDOW }); return true; }
  if (e.count >= limit) return false;
  e.count++; return true;
}

function sanitizeInput(input: any, maxChars: number): any {
  if (typeof input === 'string') return sanitizeChatInput(input, maxChars);
  if (Array.isArray(input)) return input.map(item => sanitizeInput(item, maxChars));
  if (input && typeof input === 'object') { const s: any = {}; for (const k of ['role', 'content', 'name']) { if (input[k] != null) s[k] = sanitizeInput(input[k], maxChars); } return s; }
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

async function getReputation(kv: any, ip: string, headers: Headers, env: Record<string, unknown>): Promise<ReputationState> {
  let s = getDefaultState();
  if (kv) { try { const raw = await kv.get(kvKey(env, `reputation:${ip}`)); if (raw) s = deserializeReputation(raw); } catch {} }
  const ua = headers.get('user-agent') || '';
  if (isBotUA(ua)) s = updateReputation(s, 'bot_ua', { userAgent: ua });
  else if (headers.get('cf-bot-score') && parseFloat(headers.get('cf-bot-score')!) >= 1) s = updateReputation(s, 'bot_ua', { userAgent: ua });
  if (isDC(headers.get('cf-asn') || '')) s = updateReputation(s, 'datacenter_ip', { ip });
  return updateReputation(s, 'request');
}

export const GET: APIRoute = async () => {
  const rid = createRequestId();
  return apiError({
    requestId: rid,
    status: 405,
    code: 'METHOD_NOT_ALLOWED',
    message: 'Use POST /api/chat to submit a chat request.',
  });
};

export const POST: APIRoute = async (ctx) => {
  const { request, locals } = ctx;
  const rid = createRequestId();
  const log = (event: string, data?: any) => console.log(JSON.stringify({ rid, event, ...(data || {}) }));
  const env = loadEnv(locals);
  const limits = getRequestLimits(env);
  if (env.SESSION) initCircuitKV(env.SESSION, env);
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

  if (!checkCSRF(request)) {
    return apiError({ requestId: rid, status: 403, code: 'FORBIDDEN', message: 'Request origin is not allowed.' });
  }
  if (!checkRateLimit(ip, limits.rateLimitPerMinute)) {
    return apiError({ requestId: rid, status: 429, code: 'RATE_LIMITED', message: 'Too many requests. Please wait and try again.', retryable: true, retryAfter: 60 });
  }

  const devIPs = (env.DEV_IPS || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  const isDev = devIPs.includes(ip);

  let rep = getDefaultState();
  if (!isDev) {
    rep = await getReputation(env.SESSION, ip, request.headers, env);
    if (rep.tier === 'blocked') {
      return apiError({ requestId: rid, status: 403, code: 'ACCESS_DENIED', message: 'Access temporarily suspended.' });
    }
    const dc = (dailyUsage.get(ip) || 0) + 1; dailyUsage.set(ip, dc);
    const dailyCap = Math.min(getDailyLimits(rep.tier).chatPerDay, limits.rateLimitPerDay);
    if (dc > dailyCap) {
      return apiError({ requestId: rid, status: 429, code: 'DAILY_LIMIT', message: 'Daily request limit reached. Please try again later.' });
    }
  } else {
    const dc = (dailyUsage.get(ip) || 0) + 1; dailyUsage.set(ip, dc);
    if (dc > limits.rateLimitPerDay) {
      return apiError({ requestId: rid, status: 429, code: 'DAILY_LIMIT', message: 'Daily request limit reached. Please try again later.' });
    }
  }

  if (Number(request.headers.get('content-length') || '0') > limits.maxRequestBodyBytes) {
    return apiError({ requestId: rid, status: 413, code: 'BODY_TOO_LARGE', message: 'Request body is too large.' });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body?.messages || !Array.isArray(body.messages)) {
      return apiError({ requestId: rid, status: 400, code: 'INVALID_REQUEST', message: 'Request must include a messages array.' });
    }
    if (!validateMessages(body.messages)) {
      return apiError({ requestId: rid, status: 400, code: 'INVALID_MESSAGES', message: 'Messages must contain valid roles and string content.' });
    }

    if (env.TURNSTILE_SECRET_KEY) {
      const ok = await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET_KEY);
      if (!ok) {
        if (!isDev) rep = updateReputation(rep, 'turnstile_fail');
        return apiError({ requestId: rid, status: 403, code: 'CAPTCHA_FAILED', message: 'Verification failed. Please try again.', retryable: true });
      }
      if (!isDev) rep = updateReputation(rep, 'turnstile_pass');
    }

    const ua = request.headers.get('user-agent') || '';
    const sessionId = body.sessionId ? await bindSession(String(body.sessionId), ip, ua) : '';

    let messages = sanitizeInput(body.messages, limits.chatMaxChars);
    const liveSearch = !!body.liveSearch;
    const clientSessionId = body.sessionId || '';
    const lastMsg = [...messages].reverse().find((m: any) => m.role === 'user');
    const query = lastMsg?.content || '';
    const msgLen = query.length;

    if (!isDev) {
      rep = updateReputation(rep, 'dup_query', { message: query });
      rep = updateReputation(rep, 'natural_message', { message: query });
    }

    const pathCtx = determineChatPath(query, msgLen, body.intent || 'chat-fast', clientSessionId);
    log('path', { path: pathCtx.path, reason: pathCtx.reason });

    let searchResult: SearchResult = { contextParts: [], sources: [], searchTier: 'none', searchAttempted: false };
    let graphContextStr = '';

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

    }

    const needsArtifact = isArtifactGenerationRequest(query, messages);

    // For artifact requests: route as 'fast' for minimal latency but bump max tokens to 2048
    const effectivePath = needsArtifact ? 'fast' : pathCtx.path;

    const promptCtx: PromptContext = {
      path: effectivePath,
      graphContext: graphContextStr || undefined,
      searchResult,
      needsArtifact,
    };

    messages = [{ role: 'system', content: buildSystemPrompt(query, promptCtx) }, ...messages];

    if (!isDev && env.SESSION) {
      try { await env.SESSION.put(kvKey(env, `reputation:${ip}`), serializeReputation(rep), { expirationTtl: 7200 }); } catch {}
    }

    if (!isWithinBudget(messages, needsArtifact ? 2048 : 2048, 4096)) {
      const trimmed = messages.slice(-12);
      if (!isWithinBudget(trimmed, 2048, 4096)) {
        return apiError({ requestId: rid, status: 413, code: 'TOKEN_BUDGET_EXCEEDED', message: 'Conversation too long. Start a new chat.' });
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
    const systemPrompt = messages.find((m: any) => m.role === 'system');
    const inputTokens = estimateTokens(systemPrompt?.content || '') + messages.slice(1).reduce((s: number, m: any) => s + estimateTokens(m.content || ''), 0);
    const graphTokens = graphContextStr ? estimateTokens(graphContextStr) : 0;

    const meta: ResponseMetadata = {
      provider: null,
      searchTier: searchResult.searchTier,
      searchRemaining: searchResult.enhancedRemaining != null ? String(searchResult.enhancedRemaining) : (isDev ? 'unlimited' : '0'),
      tier: isDev ? 'dev' : tier,
      chatPath: effectivePath,
      inputTokens,
    };

    const response = await routeChat(
      effectivePath === 'fast' ? 'chat-fast' : body.intent || 'chat-fast',
      messages, locals, env, sessionId, searchResult.sources, meta, pool, effectivePath,
      forceSticky,
      needsArtifact ? 2048 : undefined,
      parseProviderFaultInjection(env, request.headers),
    );

    logTokenUsage(env.SESSION, env, meta.provider || 'unknown', inputTokens, 0).catch(() => {});

    const headers = new Headers(response.headers);
    headers.set('x-request-id', rid);
    headers.set('x-token-usage', JSON.stringify({ in: inputTokens, graph: graphTokens }));
    if (graphContextStr) headers.set('x-graph-context', JSON.stringify({ available: true, tokens: graphTokens }));

    return new Response(response.body, { status: response.status, headers });
  } catch {
    log('error');
    return apiError({ requestId: rid, status: 500, code: 'SERVER_ERROR', message: 'Unexpected error. Please try again.', retryable: true, retryAfter: 5 });
  }
};
