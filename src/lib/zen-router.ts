import { ZEN_REGISTRY, classifyQuery, getProvidersForRole, type Provider, type ProviderRole } from './providers';

const FAIL_WINDOW_MS = 60_000;
const FAIL_THRESHOLD = 3;
const EJECT_MS = 30_000;
const PERMANENT_EJECT_MS = 600_000;

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const PERMANENT = new Set([401]);

interface CircuitState {
  failures: number[];
  ejectedUntil: number;
  permanent: boolean;
  totalErrors: number;
  requests: number;
  lastStatus: number;
  lastError: string;
}

interface SessionState {
  lockedProviderId: string | null;
  turnCount: number;
  createdAt: number;
}

export interface ResponseMetadata {
  provider: string | null;
  searchTier: 'none' | 'basic' | 'enhanced';
  searchRemaining: string;
  tier: string;
  chatPath?: 'fast' | 'balanced' | 'heavy';
}

const circuits = new Map<string, CircuitState>();
const sessions = new Map<string, SessionState>();
const SESSION_TTL = 30 * 60_000;

const PATH_TIMEOUTS: Record<string, number> = {
  fast: 15_000,
  balanced: 25_000,
  heavy: 35_000,
};

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [k, s] of sessions) { if (now - s.createdAt > SESSION_TTL) sessions.delete(k); }
    for (const [k, c] of circuits) { if (c.failures.length === 0 && c.ejectedUntil < now && c.requests === 0) circuits.delete(k); }
  }, 300_000);
}

function getCircuit(id: string): CircuitState {
  if (!circuits.has(id)) {
    circuits.set(id, { failures: [], ejectedUntil: 0, permanent: false, totalErrors: 0, requests: 0, lastStatus: 0, lastError: '' });
  }
  return circuits.get(id)!;
}

let circuitKV: any = null;
export function initCircuitKV(kv: any) { circuitKV = kv; }

async function persistCircuit(id: string) {
  if (!circuitKV) return;
  try {
    const c = circuits.get(id);
    if (c) await circuitKV.put(`circuit:${id}`, JSON.stringify(c), { expirationTtl: 3600 });
  } catch {}
}

function isCircuitOpen(id: string): boolean {
  const c = getCircuit(id);
  const now = Date.now();
  c.failures = c.failures.filter(t => now - t < FAIL_WINDOW_MS);
  if (c.ejectedUntil > now) return true;
  if (c.failures.length >= FAIL_THRESHOLD) { c.ejectedUntil = now + EJECT_MS; return true; }
  return false;
}

function recordFail(id: string, status: number, err?: string) {
  const c = getCircuit(id);
  c.totalErrors++;
  c.lastStatus = status;
  if (err) c.lastError = err.slice(0, 120);
  if (PERMANENT.has(status)) { c.ejectedUntil = Date.now() + PERMANENT_EJECT_MS; c.permanent = true; persistCircuit(id); return; }
  c.failures.push(Date.now());
  persistCircuit(id);
}

function recordSuccess(id: string) {
  const c = getCircuit(id);
  c.failures = [];
  c.ejectedUntil = 0;
  c.permanent = false;
  c.requests++;
  persistCircuit(id);
}

function getApiKey(provider: Provider, env: any): string | undefined {
  const raw = env[`${provider.name.toUpperCase()}_API_KEY`];
  return typeof raw === 'string' ? raw.trim() : undefined;
}

async function callProvider(provider: Provider, messages: any[], env: any, maxTokens: number, maxTimeout?: number): Promise<Response> {
  const effectiveTimeout = maxTimeout && maxTimeout < provider.timeoutMs ? maxTimeout : provider.timeoutMs;
  if (provider.name === 'cloudflare') {
    const ai = env.AI;
    if (!ai) throw new Error('AI binding not found');
    const raw = await Promise.race([
      ai.run(provider.model as any, { messages, stream: true, max_tokens: maxTokens, temperature: 0.7 }),
      new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), effectiveTimeout)),
    ]) as ReadableStream;
    return convertWorkersAIStream(raw, provider, maxTokens);
  }

  const endpoint = provider.name === 'gemini'
    ? `${provider.endpoint}/openai/chat/completions`
    : `${provider.endpoint}/chat/completions`;

  const apiKey = getApiKey(provider, env);
  if (!apiKey) throw new Error(`Missing API key for ${provider.name}`);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), effectiveTimeout);
  try {
    const body: any = { model: provider.model, messages, temperature: 0.7, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true } };
    if (provider.name === 'gemini') body.tools = [{ googleSearch: {} }];
    return await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally { clearTimeout(t); }
}

function convertWorkersAIStream(raw: ReadableStream, provider: Provider, maxTokens: number): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let idx = 0;

  (async () => {
    try {
      const reader = raw.getReader();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (value) buf += dec.decode(value, { stream: !done });
        const lines = buf.split('\n');
        buf = done ? '' : (lines.pop() || '');
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith('data:')) continue;
          const d = s.slice(5).trim();
          if (d === '[DONE]') { await writer.write(enc.encode('data: [DONE]\n\n')); continue; }
          try {
            const p = JSON.parse(d);
            if (p.error) { await writer.write(enc.encode(`data: ${JSON.stringify({ error: { message: String(p.error), type: 'workers_ai_error' } })}\n\n`)); continue; }
            if (p.response) {
              await writer.write(enc.encode(`data: ${JSON.stringify({ id: `cf-${idx++}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: provider.model, choices: [{ index: 0, delta: { content: p.response }, finish_reason: null }] })}\n\n`));
            }
          } catch {}
        }
        if (done) break;
      }
      if (buf.trim().startsWith('data:')) {
        const d = buf.trim().slice(5).trim();
        if (d !== '[DONE]') {
          try { const p = JSON.parse(d); if (p.response) await writer.write(enc.encode(`data: ${JSON.stringify({ id: `cf-${idx}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: provider.model, choices: [{ index: 0, delta: { content: p.response }, finish_reason: 'stop' }] })}\n\n`)); } catch {}
        }
        await writer.write(enc.encode('data: [DONE]\n\n'));
      }
      reader.releaseLock();
    } catch (e: any) { console.log(JSON.stringify({ event: 'workers_ai_stream_error', message: e.message?.slice(0, 200) })); }
    finally { try { await writer.close(); } catch {} }
  })();
  return new Response(readable, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function makeHeaders(provider: Provider, latency: number, sources?: any[], metadata?: ResponseMetadata): Headers {
  const h = new Headers();
  h.set('x-provider', provider.id);
  h.set('x-latency-ms', String(latency));
  h.set('Content-Type', 'text/event-stream');
  if (sources?.length) h.set('x-sources', JSON.stringify(sources));
  if (metadata) { h.set('x-search-tier', metadata.searchTier); h.set('x-search-remaining', metadata.searchRemaining); h.set('x-tier', metadata.tier); if (metadata.chatPath) h.set('x-chat-path', metadata.chatPath); }
  return h;
}

export async function routeChat(
  intent: string, messages: any[], _locals: any, env: any,
  sessionId: string = '',
  sources?: { title: string; url: string; provider?: string }[],
  metadata?: ResponseMetadata,
  allowedProviders?: string[],
  chatPath: 'fast' | 'balanced' | 'heavy' = 'balanced',
  forceSticky: boolean = false,
  maxTokensOverride?: number,
) {
  const role: ProviderRole = classifyQuery(messages, intent);
  let candidates = getProvidersForRole(role);
  if (allowedProviders?.length) candidates = candidates.filter(p => allowedProviders.includes(p.id));
  if (candidates.length === 0) candidates = getProvidersForRole('fallback').filter(p => !allowedProviders?.length || allowedProviders.includes(p.id));

  const session = sessionId ? (sessions.get(sessionId) || sessions.set(sessionId, { lockedProviderId: null, turnCount: 0, createdAt: Date.now() }).get(sessionId)!) : null;

  const unlimitedProviders = new Set(['gemini-flash', 'nvidia-fast', 'cloudflare-llama']);

  const getMaxTokens = (provider: Provider): number => {
    if (maxTokensOverride) return maxTokensOverride;
    if (chatPath === 'fast') return 1024;
    if (unlimitedProviders.has(provider.id)) return 4096;
    return 2048;
  };

  const ordered: Provider[] = [];
  const added = new Set<string>();

  if (session?.lockedProviderId) {
    const lp = candidates.find(p => p.id === session.lockedProviderId);
    if (lp) { ordered.push(lp); added.add(lp.id); }
  }

  for (const p of candidates) { if (!added.has(p.id)) { ordered.push(p); added.add(p.id); } }

  const attempt = async (): Promise<Response> => {
    // When forceSticky is true (artifact requests), lock to session provider and NEVER switch
    if (forceSticky && session?.lockedProviderId) {
      const locked = ordered.find(p => p.id === session!.lockedProviderId);
      if (!locked) {
        const fallback = ordered[0];
        if (fallback) return trySingleProvider(fallback);
        return new Response(JSON.stringify({ error: 'all_providers_exhausted', message: 'No provider available.', retryAfter: 5 }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' } });
      }
      // Bypass circuit for forceSticky — session-locked provider always gets a chance
      return trySingleProvider(locked, true);
    }

    for (const provider of ordered) {
      const isSessionLocked = forceSticky && session?.lockedProviderId === provider.id;
      if (!isSessionLocked && provider.id !== ordered[0]?.id && isCircuitOpen(provider.id)) continue;

      const result = await trySingleProvider(provider, isSessionLocked);
      if (result) return result;
    }

    return new Response(JSON.stringify({ error: 'all_providers_exhausted', message: 'All AI providers are currently unavailable. Please try again in a moment.', retryAfter: 10, debug: { tried: ordered.map(p => p.id), circuits: [...circuits.entries()].map(([k,v]) => ({id:k, failures:v.failures.length, ejected:v.ejectedUntil > Date.now()})) } }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '10' },
    });
  };

  async function trySingleProvider(provider: Provider, skipCircuit: boolean = false): Promise<Response | null> {
    if (!skipCircuit && isCircuitOpen(provider.id)) return null;

    const apiKey = getApiKey(provider, env);
    if (!apiKey && provider.name !== 'cloudflare') { recordFail(provider.id, 401, 'no key'); return null; }

    const start = Date.now();
    try {
      const maxTimeout = chatPath === 'fast' ? 15_000 : undefined;
      const res = await callProvider(provider, messages, env, getMaxTokens(provider), maxTimeout);
      const latency = Date.now() - start;

      if (res.ok) {
        recordSuccess(provider.id);
        if (session) { session.lockedProviderId = provider.id; session.turnCount = (session.turnCount || 0) + 1; }
        if (metadata) metadata.provider = provider.id;
        return new Response(res.body, { status: res.status, headers: makeHeaders(provider, latency, sources, metadata) });
      }

      recordFail(provider.id, res.status);
      console.log(JSON.stringify({ event: 'provider_fail', provider: provider.id, status: res.status, latency }));
    } catch (e: any) {
      recordFail(provider.id, 0, e.message || e.name);
      console.log(JSON.stringify({ event: 'provider_err', provider: provider.id, error: e.message?.slice(0, 100) }));
    }
    return null;
  }

  const globalTimeout = PATH_TIMEOUTS[chatPath] || 25_000;
  const retryDelays = chatPath === 'fast' ? [] : [2000, 5000, 10000];

  const attemptWithRetry = async (): Promise<Response> => {
    const start = Date.now();
    let lastResult: Response | null = null;

    for (let round = 0; round <= retryDelays.length; round++) {
      if (Date.now() - start > globalTimeout - 3000) break;

      const result = await attempt();
      if (result.status !== 503) return result;

      lastResult = result;

      if (round < retryDelays.length) {
        await new Promise(r => setTimeout(r, retryDelays[round]));
      }
    }

    return lastResult || attempt();
  };

  return Promise.race([attemptWithRetry(), new Promise<Response>(r => setTimeout(() => r(new Response(JSON.stringify({ message: 'Request timed out. Please try again.', retryAfter: 5 }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' } })), globalTimeout))]);
}

export function getCircuitDiagnostics() {
  return Object.fromEntries([...circuits.entries()].map(([k, v]) => [k, {
    ejected: v.ejectedUntil > Date.now(), permanent: v.permanent, failures: v.failures.length,
    errors: v.totalErrors, requests: v.requests, lastStatus: v.lastStatus, lastError: v.lastError,
  }]));
}
