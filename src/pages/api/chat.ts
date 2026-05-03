import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { routeChat, getCircuitDiagnostics, type TierConfig, type ResponseMetadata } from '../../lib/zen-router';
import { searchReddit, type SearchSource } from '../../lib/search-reddit';
import { searchTavily, searchExa, checkEnhancedBudget, incrementEnhancedBudget, getEnhancedCredits, useEnhancedCredit } from '../../lib/search-enhanced';
import { updateReputation, getDefaultState, deserializeReputation, serializeReputation, getTierProviderPool, getDailyLimits, type ReputationState } from '../../lib/reputation';
import { classifyQuery, filterRelevantResults, formatConversationalResponse } from '../../lib/relevance';

interface RateLimitEntry { count: number; resetTime: number; }
const rateLimits = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;
const MAX_BODY_SIZE = 64 * 1024;

interface SearchResult {
  contextParts: string[];
  sources: { title: string; url: string; provider?: string }[];
  searchTier: 'none' | 'basic' | 'enhanced';
  enhancedRemaining?: number;
}

const dailyUsage = new Map<string, number>();
let lastDailyReset = Date.now() + 86400000;

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    rateLimits.forEach((v, k) => { if (now > v.resetTime) rateLimits.delete(k); });
    if (now > lastDailyReset) { dailyUsage.clear(); lastDailyReset = now + 86400000; }
    searchCache.forEach((v, k) => { if (now - v.ts > 900_000) searchCache.delete(k); });
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

function isBotUserAgent(ua: string): boolean {
  if (!ua) return true;
  const lower = ua.toLowerCase();
  const botPatterns = ['curl', 'wget', 'python', 'go-http', 'bot', 'scrape', 'crawler', 'spider', 'headless', 'axios', 'node-fetch', 'libwww'];
  return botPatterns.some(p => lower.includes(p)) || lower.length < 10;
}

const DATA_CENTER_ASNS = new Set([
  '14061', '24940', '16276', '51167', '200130', '202448',
  '13213', '60068', '20473', '202015', '201206', '197133',
]);

function isDatacenterASN(asn: string): boolean {
  if (!asn) return false;
  return DATA_CENTER_ASNS.has(asn.replace(/[^0-9]/g, ''));
}

const searchCache = new Map<string, { result: string; ts: number }>();
const SEARCH_CACHE_MS = 900_000;
const DDG_TIMEOUT_MS = 4000;
const WIKI_TIMEOUT_MS = 5000;

function searchCacheKey(query: string): string {
  return query.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 80);
}

async function searchDuckDuckGo(query: string): Promise<SearchSource | null> {
  const key = searchCacheKey(query);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_MS) {
    return { title: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, content: cached.result, provider: 'ddg' };
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DDG_TIMEOUT_MS);
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;

    const data = await res.json() as any;
    const parts: string[] = [];
    if (data.Answer) parts.push(data.Answer);
    if (data.AbstractText) parts.push(data.AbstractText);
    if (data.Definition) parts.push(data.Definition);
    if (data.Heading) parts.push(`Topic: ${data.Heading}`);
    const topics = data.RelatedTopics?.slice(0, 5)?.filter((t: any) => t.Text)?.map((t: any) => `- ${t.Text}`) || [];
    if (topics.length) parts.push(topics.join('\n'));
    const results = data.Results?.slice(0, 3)?.filter((r: any) => r.Text)?.map((r: any) => `${r.FirstURL}: ${r.Text}`) || [];
    if (results.length) parts.push(results.join('\n'));

    if (parts.length === 0) return null;

    const content = parts.join('\n\n');
    const firstResultUrl = (data.Results?.[0] as any)?.FirstURL || data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    searchCache.set(key, { result: content, ts: Date.now() });
    return { title: 'DuckDuckGo', url: firstResultUrl, content, provider: 'ddg' };
  } catch (e: any) {
    console.log(JSON.stringify({ event: 'ddg_error', message: e.message?.slice(0, 200), query: query.slice(0, 80) }));
    return null;
  }
}

async function searchWikipedia(query: string): Promise<SearchSource | null> {
  try {
    const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, format: 'json', srlimit: '3' });
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(WIKI_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const results = data?.query?.search;
    if (!results?.length) return null;

    const pages = results.slice(0, 2);
    const parts: string[] = [];
    let firstUrl = '';
    for (const page of pages) {
      const snippet = (page.snippet || '').replace(/<[^>]+>/g, '');
      const url = `https://en.wikipedia.org/wiki/${encodeURIComponent((page.title || '').replace(/ /g, '_'))}`;
      if (!firstUrl) firstUrl = url;
      parts.push(`${page.title}: ${snippet}`);
    }
    return { title: `Wikipedia: ${query.slice(0, 50)}`, url: firstUrl, content: parts.join('\n\n'), provider: 'wikipedia' };
  } catch (e: any) {
    console.log(JSON.stringify({ event: 'wiki_error', message: e.message?.slice(0, 200), query: query.slice(0, 80) }));
    return null;
  }
}

async function searchRouter(
  query: string,
  liveSearch: boolean,
  env: any,
  clientIP: string,
  repState: ReputationState,
): Promise<SearchResult> {
  const contextParts: string[] = [];
  const sources: { title: string; url: string; provider?: string }[] = [];
  let sourceIdx = 0;
  let searchTier: 'none' | 'basic' | 'enhanced' = 'none';
  let enhancedRemaining: number | undefined;

  const classified = classifyQuery(query);
  if (classified === 'greeting' || classified === 'conversational') {
    return { contextParts, sources, searchTier: 'none' };
  }

  let enhancedResults: (SearchSource | null)[] = [];
  let basicFetchPromise: Promise<(SearchSource | null)[]> | null = null;

  if (liveSearch) {
    const devIPs = (env.DEV_IPS || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    const isDev = devIPs.includes(clientIP);

    const tier = repState.tier;
    const limits = getDailyLimits(tier);

    if (isDev || limits.enhancedPerDay > 0) {
      if (!isDev) {
        const creds = await getEnhancedCredits(env.SESSION, clientIP);
        if (creds.remaining <= 0) {
          console.log(JSON.stringify({ event: 'enhanced_exhausted', ip: clientIP.slice(0, 8) }));
        } else {
          const monthKey = new Date().toISOString().slice(0, 7);
          const tavilyBudget = await checkEnhancedBudget(env.SESSION, 'tavily', monthKey);
          const exaBudget = await checkEnhancedBudget(env.SESSION, 'exa', monthKey);

          if (tavilyBudget && exaBudget) {
            const tavilyKey = env.TAVILY_API_KEY || '';
            const exaKey = env.EXA_API_KEY || '';

            if (tavilyKey || exaKey) {
              await useEnhancedCredit(env.SESSION, clientIP);
              searchTier = 'enhanced';

              enhancedResults = await Promise.all([
                tavilyKey ? searchTavily(query, tavilyKey) : null,
                exaKey ? searchExa(query, exaKey) : null,
              ]);

              if (tavilyKey) await incrementEnhancedBudget(env.SESSION, 'tavily', monthKey);
              if (exaKey) await incrementEnhancedBudget(env.SESSION, 'exa', monthKey);

              const refreshedCreds = await getEnhancedCredits(env.SESSION, clientIP);
              enhancedRemaining = refreshedCreds.remaining;
            }
          } else {
            console.log(JSON.stringify({ event: 'budget_exhausted', monthKey }));
          }
        }
      } else {
        searchTier = 'enhanced';
        enhancedRemaining = -1;
        enhancedResults = await Promise.all([
          env.TAVILY_API_KEY ? searchTavily(query, env.TAVILY_API_KEY || '') : null,
          env.EXA_API_KEY ? searchExa(query, env.EXA_API_KEY || '') : null,
        ]);
      }
    }

    basicFetchPromise = Promise.all([
      searchDuckDuckGo(query),
      searchWikipedia(query),
      searchReddit(query),
    ]);
  } else {
    basicFetchPromise = Promise.all([
      searchDuckDuckGo(query),
      searchWikipedia(query),
      searchReddit(query),
    ]);
  }

  const basicResults = await basicFetchPromise;

  const allResults: SearchSource[] = [];
  const seenUrls = new Set<string>();

  const addResults = (results: (SearchSource | null)[]) => {
    for (const r of results) {
      if (!r || seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      allResults.push(r);
    }
  };

  addResults(enhancedResults);
  addResults(basicResults);

  const relevant = searchTier === 'enhanced'
    ? allResults
    : filterRelevantResults(allResults, query, 0.3);

  for (const r of relevant) {
    sourceIdx++;
    const providerLabel = r.provider ? `[${sourceIdx}: ${r.provider.toUpperCase()}]` : `[${sourceIdx}]`;
    contextParts.push(`${providerLabel}\n${r.content}`);
    sources.push({ title: r.title, url: r.url, provider: r.provider });
  }

  if (searchTier === 'enhanced' && contextParts.length === 0) {
    searchTier = 'basic';
    sourceIdx = 0;
    contextParts.length = 0;
    sources.length = 0;
    seenUrls.clear();

    for (const r of basicResults) {
      if (!r || seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      sourceIdx++;
      const providerLabel = r.provider ? `[${sourceIdx}: ${r.provider.toUpperCase()}]` : `[${sourceIdx}]`;
      contextParts.push(`${providerLabel}\n${r.content}`);
      sources.push({ title: r.title, url: r.url, provider: r.provider });
    }
  }

  return { contextParts, sources, searchTier, enhancedRemaining };
}

function buildSystemPrompt(
  query: string,
  searchResult: SearchResult,
): string {
  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const year = now.getFullYear();

  const dateLayer = `Today is ${dayName}, ${dateStr}. Current year is ${year}. Your training data ended in 2023. You are NOT current unless the search sources below provide up-to-date information.`;

  const classification = classifyQuery(query);
  const conversationalBlock = formatConversationalResponse(classification);

  const artifactLayer = `When generating code blocks, HTML, SVG, Mermaid diagrams, or React components, wrap them in <artifact type="code|html|svg|mermaid|react" placement="inline" title="Descriptive Name">...</artifact> tags. Use type="code" with language attribute for code blocks.`;

  if (searchResult.searchTier === 'none') {
    if (conversationalBlock) {
      return `${dateLayer}\n\n${conversationalBlock}\n\n${artifactLayer}`;
    }
    return `${dateLayer}\n\nYou are a helpful technical writing assistant. Be conversational when appropriate. If the user's query is ambiguous, you may offer to help with writing, coding, or research.\n\n${artifactLayer}`;
  }

  const isEnhanced = searchResult.searchTier === 'enhanced';

  let searchLayer: string;
  if (isEnhanced) {
    searchLayer = `ENHANCED LIVE SEARCH (DDG + Wikipedia + Reddit + Tavily + Exa):\n${searchResult.contextParts.join('\n\n')}\n\nBase your ENTIRE response on these results, which are comprehensive and current. EVERY factual claim MUST cite sources using [1]-[${searchResult.sources.length}] format. Do NOT use your training data unless ALL sources are silent on the topic.`;
  } else {
    searchLayer = `BASIC LIVE SEARCH (DDG + Wikipedia + Reddit):\n${searchResult.contextParts.join('\n\n')}\n\nBase your answer on these sources. Cite sources using [1]-[${searchResult.sources.length}] format. If sources don't fully answer the question, you may supplement with pre-2023 knowledge but you MUST label pre-2023 knowledge explicitly as "[Pre-2023 knowledge]".`;
  }

  return `${dateLayer}\n\n${searchLayer}\n\n${artifactLayer}`;
}

async function getOrCreateReputation(
  kv: any,
  clientIP: string,
  requestHeaders: Headers,
): Promise<ReputationState> {
  let state = getDefaultState();

  if (kv) {
    try {
      const raw = await kv.get(`reputation:${clientIP}`);
      if (raw) state = deserializeReputation(raw);
    } catch {}
  }

  const ua = requestHeaders.get('user-agent') || '';
  const cfBotScore = requestHeaders.get('cf-bot-score');
  const cfASN = requestHeaders.get('cf-asn') || '';

  if (isBotUserAgent(ua)) {
    state = updateReputation(state, 'bot_ua', { userAgent: ua });
  } else if (cfBotScore && parseFloat(cfBotScore) >= 1) {
    state = updateReputation(state, 'bot_ua', { userAgent: ua });
  }

  if (isDatacenterASN(cfASN)) {
    state = updateReputation(state, 'datacenter_ip', { asn: cfASN, ip: clientIP });
  }

  state = updateReputation(state, 'request');

  return state;
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

  const clientIP = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

  if (!checkCSRF(request)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  if (!checkRateLimit(clientIP)) {
    return new Response(JSON.stringify({ error: 'rate_limit' }), { status: 429 });
  }

  const devIPs = (env.DEV_IPS || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  const isDev = devIPs.includes(clientIP);

  let repState = getDefaultState();
  if (!isDev) {
    repState = await getOrCreateReputation(env.SESSION, clientIP, request.headers);

    const tier = repState.tier;
    const limits = getDailyLimits(tier);

    const dailyCount = (dailyUsage.get(clientIP) || 0) + 1;
    dailyUsage.set(clientIP, dailyCount);
    if (dailyCount > limits.chatPerDay) {
      return new Response(JSON.stringify({ error: 'daily_limit' }), { status: 429 });
    }
  } else {
    const dailyCount = (dailyUsage.get(clientIP) || 0) + 1;
    dailyUsage.set(clientIP, dailyCount);
    if (dailyCount > 500) {
      return new Response(JSON.stringify({ error: 'daily_limit' }), { status: 429 });
    }
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
      const turnstileOk = await verifyTurnstileToken(body.turnstileToken, env.TURNSTILE_SECRET_KEY);
      if (!turnstileOk) {
        if (!isDev) repState = updateReputation(repState, 'turnstile_fail');
        return new Response(JSON.stringify({ error: 'captcha_failed', message: 'Turnstile verification failed.' }), { status: 403 });
      }
      if (!isDev) repState = updateReputation(repState, 'turnstile_pass');
    }

    let messages = sanitizeInput(body.messages);
    const sessionId = String(body.sessionId || '');
    const liveSearch = !!body.liveSearch;

    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
    const userQuery = lastUserMsg?.content || '';

    if (!isDev) {
      repState = updateReputation(repState, 'dup_query', { message: userQuery });
      repState = updateReputation(repState, 'natural_message', { message: userQuery });
    }

    const searchResult = liveSearch
      ? await searchRouter(userQuery, true, env, clientIP, repState)
      : await searchRouter(userQuery, false, env, clientIP, repState);

    const sources = searchResult.sources || [];

    const systemContent = buildSystemPrompt(userQuery, searchResult);
    messages = [{ role: 'system', content: systemContent }, ...messages];

    if (!isDev) {
      try {
        if (env.SESSION) {
          const serialized = serializeReputation(repState);
          await env.SESSION.put(`reputation:${clientIP}`, serialized, { expirationTtl: 2 * 3600 });
        }
      } catch (e: any) {
        console.log(JSON.stringify({ event: 'rep_save_error', message: e.message?.slice(0, 100) }));
      }
    }

    const tier = isDev ? 'premium' : repState.tier;
    const tierPool = isDev ? { allowedProviders: ['groq-fast', 'gemini-flash'], maxTokens: 4096 } : { allowedProviders: getTierProviderPool(tier).pool, maxTokens: getTierProviderPool(tier).maxTokens || 4096 };

    const searchRemaining = searchResult.enhancedRemaining != null
      ? String(searchResult.enhancedRemaining)
      : (isDev ? 'unlimited' : '0');

    const metadata: ResponseMetadata = {
      provider: null,
      searchTier: searchResult.searchTier,
      searchRemaining,
      tier: isDev ? 'dev' : tier,
    };

    return await routeChat(
      body.intent || 'chat-fast',
      messages,
      locals,
      env,
      sessionId,
      sources,
      metadata,
      tierPool,
    );
  } catch (error: any) {
    console.log(JSON.stringify({ event: 'processing_error', message: error.message?.slice(0, 200) }));
    return new Response(JSON.stringify({
      error: 'processing_error',
      message: 'An unexpected error occurred. Please try again.',
      retryAfter: 5,
    }), { status: 500, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' } });
  }
};