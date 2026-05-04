import { ZEN_REGISTRY, classifyQuery, getProvidersForRole, getProvider, type Provider, type ProviderRole } from './providers';

const CIRCUIT_TRANSIENT_WINDOW_MS = 120_000;
const CIRCUIT_TRANSIENT_FAILURES = 8;
const CIRCUIT_TRANSIENT_EJECT_MS = 60_000;
const CIRCUIT_TRANSIENT_PROBE_MS = 30_000;
const CIRCUIT_PERMANENT_EJECT_MS = 600_000;
const MAX_TRANSIENT_ATTEMPTS = 8;
const GLOBAL_TIMEOUT_MS = 25_000;
const HEDGE_DELAY_MS = 2500;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const PERMANENT_STATUSES = new Set([401]);

interface CircuitState {
  failures: number[];
  ejectedUntil: number;
  halfOpen: boolean;
  totalErrors: number;
  rateLimitHits: number;
  totalLatency: number;
  requestCount: number;
  permanent: boolean;
}

interface SessionState {
  lockedProviderId: string | null;
  turnCount: number;
  maxTurns: number;
  createdAt: number;
}

export interface TierConfig {
  allowedProviders: string[];
  maxTokens?: number;
}

export interface ResponseMetadata {
  provider: string | null;
  searchTier: 'none' | 'basic' | 'enhanced';
  searchRemaining: string;
  tier: string;
}

const circuits = new Map<string, CircuitState>();
const sessions = new Map<string, SessionState>();
const SESSION_TTL_MS = 30 * 60_000;

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    sessions.forEach((s, k) => { if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(k); });
    circuits.forEach((c, k) => {
      if (c.failures.length === 0 && c.ejectedUntil < now && c.requestCount === 0) circuits.delete(k);
    });
  }, 300_000);
}

function getCircuit(id: string): CircuitState {
  if (!circuits.has(id)) {
    circuits.set(id, { failures: [], ejectedUntil: 0, halfOpen: false, totalErrors: 0, rateLimitHits: 0, totalLatency: 0, requestCount: 0, permanent: false });
  }
  return circuits.get(id)!;
}

function isCircuitOpen(id: string): boolean {
  const c = getCircuit(id);
  const now = Date.now();
  const recentFailures = c.failures.filter(t => now - t < CIRCUIT_TRANSIENT_WINDOW_MS);
  c.failures = recentFailures;

  if (c.ejectedUntil > 0) {
    if (now >= c.ejectedUntil) {
      c.ejectedUntil = 0;
      c.halfOpen = true;
      c.failures = [];
      c.permanent = false;
      return false;
    }
    if (!c.permanent && now >= c.ejectedUntil - CIRCUIT_TRANSIENT_PROBE_MS) {
      c.halfOpen = true;
      return false;
    }
    return true;
  }

  if (recentFailures.length >= CIRCUIT_TRANSIENT_FAILURES) {
    c.ejectedUntil = now + CIRCUIT_TRANSIENT_EJECT_MS;
    c.halfOpen = false;
    c.permanent = false;
    return true;
  }

  return false;
}

function recordSuccess(id: string, latencyMs: number) {
  const c = getCircuit(id);
  c.failures = [];
  c.ejectedUntil = 0;
  c.halfOpen = false;
  c.permanent = false;
  c.totalLatency += latencyMs;
  c.requestCount++;
}

function recordTransientFailure(id: string, isRateLimit: boolean) {
  const c = getCircuit(id);
  const now = Date.now();
  c.failures.push(now);
  c.failures = c.failures.filter(t => now - t < CIRCUIT_TRANSIENT_WINDOW_MS);
  c.totalErrors++;
  if (isRateLimit) c.rateLimitHits++;
  if (c.halfOpen) {
    c.ejectedUntil = now + CIRCUIT_TRANSIENT_EJECT_MS;
    c.halfOpen = false;
  }
}

function recordPermanentFailure(id: string) {
  const c = getCircuit(id);
  c.totalErrors++;
  c.ejectedUntil = Date.now() + CIRCUIT_PERMANENT_EJECT_MS;
  c.halfOpen = false;
  c.permanent = true;
}

function getSession(sessionId: string, maxTurns: number = 3): SessionState {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { lockedProviderId: null, turnCount: 0, maxTurns, createdAt: Date.now() });
  }
  return sessions.get(sessionId)!;
}

export async function runHealthCheck(_env: any) {
}

function getApiKey(provider: Provider, env: any): string | undefined {
  const raw = env[`${provider.name.toUpperCase()}_API_KEY`];
  if (typeof raw === 'string') return raw.trim();
  return raw;
}

function filterByTier(providers: Provider[], tierConfig?: TierConfig): Provider[] {
  if (!tierConfig || tierConfig.allowedProviders.length === 0) return providers;
  return providers.filter(p => tierConfig.allowedProviders.includes(p.id));
}

function makeErrorResponse(message: string, status: number, retryAfter: number, metadata?: ResponseMetadata): Response {
  return new Response(JSON.stringify({
    error: status >= 500 ? 'AI_PROVIDER_FATAL_ERROR' : 'provider_unavailable',
    message,
    retryAfter,
  }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfter),
      ...(metadata ? {
        'x-search-tier': metadata.searchTier,
        'x-search-remaining': metadata.searchRemaining,
        'x-tier': metadata.tier,
      } : {}),
    },
  });
}

export async function routeChat(
  rawIntent: string,
  messages: any[],
  locals: any,
  providedEnv: any,
  sessionId: string = '',
  sources?: { title: string; url: string; provider?: string }[],
  metadata?: ResponseMetadata,
  tierConfig?: TierConfig,
) {
  const env = providedEnv || {};
  const intent = rawIntent || 'chat-fast';
  const maxTokens = tierConfig?.maxTokens || 4096;

  const role: ProviderRole = classifyQuery(messages, intent);
  let candidates = getProvidersForRole(role);

  candidates = filterByTier(candidates, tierConfig);

  if (candidates.length === 0) {
    candidates = getProvidersForRole('fallback');
    candidates = filterByTier(candidates, tierConfig);
  }

  const session = sessionId ? getSession(sessionId) : null;

  const allowedIds = tierConfig?.allowedProviders;
  const isProviderAllowed = (id: string) => !allowedIds || allowedIds.length === 0 || allowedIds.includes(id);

  const openCandidates = candidates.filter(p => !isCircuitOpen(p.id));

  if (openCandidates.length === 0) {
    return makeErrorResponse(
      'All AI providers are currently overloaded. Please wait a moment and try again.',
      503, 15, metadata,
    );
  }

  const primary = openCandidates[0];
  const hedges = openCandidates.slice(1, 3);

  async function trySingleProvider(provider: Provider): Promise<Response | null> {
    if (isCircuitOpen(provider.id)) return null;

    const apiKey = getApiKey(provider, env);
    if (!apiKey && provider.name !== 'cloudflare') {
      recordPermanentFailure(provider.id);
      return null;
    }

    const start = Date.now();
    try {
      const res = await callProvider(provider, messages, env, maxTokens);
      const latency = Date.now() - start;

      console.log(JSON.stringify({
        event: 'provider_attempt',
        provider: provider.id,
        status: res.status,
        latencyMs: latency,
        tier: metadata?.tier,
        searchTier: metadata?.searchTier,
      }));

      if (res.ok) {
        recordSuccess(provider.id, latency);

        if (session) {
          if (session.lockedProviderId === null) {
            session.lockedProviderId = provider.id;
            session.turnCount = 1;
          } else if (session.lockedProviderId === provider.id && session.turnCount < session.maxTurns) {
            session.turnCount++;
          } else if (session.lockedProviderId !== provider.id) {
            session.lockedProviderId = provider.id;
            session.turnCount = 1;
          }
        }

        const newHeaders = new Headers(res.headers);
        newHeaders.set('x-provider', provider.id);
        newHeaders.set('x-latency-ms', String(latency));
        newHeaders.set('x-role', provider.role);
        newHeaders.set('Content-Type', 'text/event-stream');

        if (sources && sources.length > 0) {
          newHeaders.set('x-sources', JSON.stringify(sources));
        }

        if (metadata) {
          newHeaders.set('x-search-tier', metadata.searchTier);
          newHeaders.set('x-search-remaining', metadata.searchRemaining);
          newHeaders.set('x-tier', metadata.tier);
        }

        return new Response(res.body, { status: res.status, headers: newHeaders });
      }

      const status = res.status;

      console.log(JSON.stringify({
        event: 'provider_failure',
        provider: provider.id,
        status,
        permanent: PERMANENT_STATUSES.has(status),
      }));

      if (PERMANENT_STATUSES.has(status)) {
        recordPermanentFailure(provider.id);
      } else if (RETRYABLE_STATUSES.has(status)) {
        recordTransientFailure(provider.id, status === 429);
      } else {
        recordTransientFailure(provider.id, false);
      }

      return null;
    } catch (e: any) {
      const isTimeout = e.name === 'TimeoutError' || e.message?.includes('timeout') || e.code === 'ETIMEDOUT';
      console.log(JSON.stringify({
        event: 'provider_exception',
        provider: provider.id,
        isTimeout,
        message: e.message?.slice(0, 200),
      }));
      recordTransientFailure(provider.id, false);

      if (isTimeout) {
        const c = circuits.get(provider.id);
        if (c && c.failures.length >= CIRCUIT_TRANSIENT_FAILURES) {
          c.ejectedUntil = Date.now() + CIRCUIT_TRANSIENT_EJECT_MS;
        }
      }

      return null;
    }
  }

  async function doChain(): Promise<Response> {
    if (session?.lockedProviderId && isProviderAllowed(session.lockedProviderId)) {
      const lockedProvider = getProvider(session.lockedProviderId);
      if (lockedProvider && !isCircuitOpen(lockedProvider.id)) {
        const lockedResult = await trySingleProvider(lockedProvider);
        if (lockedResult) return lockedResult;
      }
      session.lockedProviderId = null;
      session.turnCount = 0;
    }

    if (hedges.length === 0) {
      const result = await trySingleProvider(primary);
      if (result) return result;

      for (const p of openCandidates.slice(1)) {
        const result = await trySingleProvider(p);
        if (result) return result;
      }
    } else {
      let hedgeResolved = false;

      const primaryPromise = trySingleProvider(primary).then(result => {
        if (result && !hedgeResolved) { hedgeResolved = true; return result; }
        return null;
      });

      const hedgePromise = new Promise<Response | null>(resolve => {
        setTimeout(async () => {
          if (hedgeResolved) { resolve(null); return; }
          const results = await Promise.all(hedges.map(p => trySingleProvider(p)));
          const first = results.find(r => r !== null);
          if (first && !hedgeResolved) { hedgeResolved = true; resolve(first); } else { resolve(null); }
        }, HEDGE_DELAY_MS);
      });

      const winner = await Promise.race([primaryPromise, hedgePromise]);
      if (winner) return winner;

      for (const p of openCandidates) {
        const r = await trySingleProvider(p);
        if (r) return r;
      }
    }

    return makeErrorResponse(
      'All AI providers are currently unavailable. Please try again in a moment.',
      503, 10, metadata,
    );
  }

  return await Promise.race([
    doChain(),
    new Promise<Response>(resolve =>
      setTimeout(() => resolve(makeErrorResponse(
        "I'm taking longer than expected. Please try again in a moment.",
        503, 5, metadata,
      )), GLOBAL_TIMEOUT_MS)
    ),
  ]);
}

async function callProvider(provider: Provider, messages: any[], env: any, maxTokens: number = 4096): Promise<Response> {
  if (provider.name === 'cloudflare') {
    return await callWorkersAI(provider, messages, env, maxTokens);
  }

  const endpoint = provider.name === 'gemini'
    ? `${provider.endpoint}/openai/chat/completions`
    : `${provider.endpoint}/chat/completions`;

  const apiKey = getApiKey(provider, env);

  if (!apiKey) {
    throw new Error(`Missing API Key for ${provider.name}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);

  const payload: any = {
    model: provider.model,
    messages,
    temperature: 0.7,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };

  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function callWorkersAI(provider: Provider, messages: any[], env: any, maxTokens: number = 4096): Promise<Response> {
  const ai = env.AI;
  if (!ai) {
    throw new Error('Cloudflare AI binding not found');
  }

  let rawStream: ReadableStream;
  try {
    rawStream = await Promise.race([
      ai.run(provider.model as any, {
        messages,
        stream: true,
        max_tokens: maxTokens,
        temperature: 0.7,
      }) as Promise<ReadableStream>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), provider.timeoutMs)
      ),
    ]);
  } catch (e: any) {
    throw new Error(`Cloudflare AI invocation failed: ${e.message}`);
  }

  if (!rawStream || typeof (rawStream as any).getReader !== 'function') {
    throw new Error('Cloudflare AI did not return a readable stream');
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let chunkIdx = 0;

  (async () => {
    try {
      const reader = rawStream.getReader();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: !done });
        }

        const lines = buffer.split('\n');
        buffer = done ? '' : (lines.pop() || '');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const rawData = trimmed.slice(5).trim();

          if (rawData === '[DONE]') {
            await writer.write(encoder.encode('data: [DONE]\n\n'));
            continue;
          }

          try {
            const parsed = JSON.parse(rawData);
            if (parsed.error) {
              const errChunk = JSON.stringify({
                error: { message: String(parsed.error), type: 'workers_ai_error' }
              });
              await writer.write(encoder.encode(`data: ${errChunk}\n\n`));
              continue;
            }
            const token = parsed.response;
            if (token != null && token !== '') {
              const openAIChunk = JSON.stringify({
                id: `cf-${chunkIdx++}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: provider.model,
                choices: [{
                  index: 0,
                  delta: { content: token },
                  finish_reason: null,
                }],
              });
              await writer.write(encoder.encode(`data: ${openAIChunk}\n\n`));
            }
          } catch (e) {
          }
        }

        if (done) break;
      }

      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data:')) {
          const rawData = trimmed.slice(5).trim();
          if (rawData !== '[DONE]') {
            try {
              const parsed = JSON.parse(rawData);
              const token = parsed.response;
              if (token != null && token !== '') {
                const openAIChunk = JSON.stringify({
                  id: `cf-${chunkIdx}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: provider.model,
                  choices: [{
                    index: 0,
                    delta: { content: token },
                    finish_reason: 'stop',
                  }],
                });
                await writer.write(encoder.encode(`data: ${openAIChunk}\n\n`));
              }
            } catch (e) {}
          }
        }
        await writer.write(encoder.encode('data: [DONE]\n\n'));
      }

      reader.releaseLock();
    } catch (e: any) {
      console.log(JSON.stringify({ event: 'workers_ai_stream_error', message: e.message?.slice(0, 200) }));
    } finally {
      try { await writer.close(); } catch (e) {}
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

export function getCircuitDiagnostics() {
  return Object.fromEntries(
    [...circuits.entries()].map(([k, v]) => [k, {
      ejected: v.ejectedUntil > Date.now(),
      permanent: v.permanent,
      failures: v.failures.length,
      errors: v.totalErrors,
      rlHits: v.rateLimitHits,
      avgLatency: v.requestCount > 0 ? Math.round(v.totalLatency / v.requestCount) : 0,
      requests: v.requestCount,
    }])
  );
}