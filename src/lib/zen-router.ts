import { ZEN_REGISTRY, classifyQuery, getProvidersForRole, getProvider, type Provider, type ProviderRole } from './providers';

const CIRCUIT_TRANSIENT_WINDOW_MS = 120_000;
const CIRCUIT_TRANSIENT_FAILURES = 6;
const CIRCUIT_TRANSIENT_EJECT_MS = 90_000;
const CIRCUIT_TRANSIENT_PROBE_MS = 45_000;
const CIRCUIT_PERMANENT_EJECT_MS = 600_000;
const MAX_TRANSIENT_ATTEMPTS = 6;
const GLOBAL_TIMEOUT_MS = 20_000;

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

function getSession(sessionId: string, maxTurns: number = 2): SessionState {
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

  async function doChain(): Promise<Response> {
    if (session?.lockedProviderId) {
      const lockedProvider = getProvider(session.lockedProviderId);
      if (lockedProvider && !isCircuitOpen(lockedProvider.id) && isProviderAllowed(lockedProvider.id)) {
        const priority = [lockedProvider, ...candidates.filter(p => p.id !== lockedProvider.id)];
        return await attemptFallback(priority, messages, env, intent, session, sources, metadata, maxTokens);
      }
      session.lockedProviderId = null;
      session.turnCount = 0;
    }
    return await attemptFallback(candidates, messages, env, intent, session, sources, metadata, maxTokens);
  }

  return await Promise.race([
    doChain(),
    new Promise<Response>(resolve =>
      setTimeout(() => resolve(new Response(JSON.stringify({
        message: "I'm taking longer than expected. Please try again in a moment.",
        retryAfter: 5,
      }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '5',
          ...(metadata ? {
            'x-search-tier': metadata.searchTier,
            'x-search-remaining': metadata.searchRemaining,
            'x-tier': metadata.tier,
          } : {}),
        },
      })), GLOBAL_TIMEOUT_MS)
    ),
  ]);
}

async function attemptFallback(
  providers: Provider[],
  messages: any[],
  env: any,
  intent: string,
  session: SessionState | null,
  sources?: { title: string; url: string; provider?: string }[],
  metadata?: ResponseMetadata,
  maxTokens: number = 4096,
): Promise<Response> {
  let transientAttempts = 0;
  let permanentSkips = 0;

  for (const provider of providers) {
    if (transientAttempts >= MAX_TRANSIENT_ATTEMPTS) break;

    if (isCircuitOpen(provider.id)) continue;

    const apiKey = getApiKey(provider, env);
    if (!apiKey && provider.name !== 'cloudflare') {
      recordPermanentFailure(provider.id);
      permanentSkips++;
      continue;
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
        permanentSkips++;
        continue;
      }

      if (RETRYABLE_STATUSES.has(status)) {
        const isRateLimit = status === 429;
        recordTransientFailure(provider.id, isRateLimit);
        transientAttempts++;
        continue;
      }

      recordTransientFailure(provider.id, false);
      transientAttempts++;

    } catch (e: any) {
      const isTimeout = e.name === 'TimeoutError' || e.message?.includes('timeout') || e.code === 'ETIMEDOUT';
      console.log(JSON.stringify({
        event: 'provider_exception',
        provider: provider.id,
        isTimeout,
        message: e.message?.slice(0, 200),
      }));
      recordTransientFailure(provider.id, false);
      transientAttempts++;

      if (isTimeout) {
        const c = circuits.get(provider.id);
        if (c && c.failures.length >= CIRCUIT_TRANSIENT_FAILURES) {
          c.ejectedUntil = Date.now() + CIRCUIT_TRANSIENT_EJECT_MS;
        }
      }
    }
  }

  console.log(JSON.stringify({
    event: 'provider_exhaustion',
    transientAttempts,
    permanentSkips,
    circuitStates: Object.fromEntries(
      [...circuits.entries()].map(([k, v]) => [k, {
        ejected: v.ejectedUntil > Date.now(),
        permanent: v.permanent,
      }])
    ),
  }));

  return new Response(JSON.stringify({
    error: 'AI_PROVIDER_FATAL_ERROR',
    message: 'All capable providers are currently unavailable. Please try again in a moment.',
    retryAfter: 15,
  }), {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': '15',
      ...(metadata ? {
        'x-search-tier': metadata.searchTier,
        'x-search-remaining': metadata.searchRemaining,
        'x-tier': metadata.tier,
      } : {}),
    },
  });
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