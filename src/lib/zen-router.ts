import { ZEN_REGISTRY, classifyQuery, getProvidersForRole, getProvider, type Provider, type ProviderRole } from './providers';

const CIRCUIT_TRANSIENT_WINDOW_MS = 60_000;
const CIRCUIT_TRANSIENT_FAILURES = 4;
const CIRCUIT_TRANSIENT_EJECT_MS = 90_000;
const CIRCUIT_TRANSIENT_PROBE_MS = 45_000;
const CIRCUIT_PERMANENT_EJECT_MS = 600_000;
const MAX_TRANSIENT_ATTEMPTS = 6;
const GLOBAL_TIMEOUT_MS = 15_000;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const PERMANENT_STATUSES = new Set([400, 401, 402, 403, 404]);

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

const circuits = new Map<string, CircuitState>();
const sessions = new Map<string, SessionState>();
const SESSION_TTL_MS = 30 * 60_000;

let providerHealth: Map<string, boolean> | null = null;

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

export async function runHealthCheck(env: any) {
  providerHealth = new Map();
  const probeMsg = [{ role: 'user', content: 'Hello, please respond with a brief greeting.' }];
  for (const provider of ZEN_REGISTRY) {
    if (provider.name === 'openrouter' && provider.freeTier === false) continue;
    const apiKey = getApiKey(provider, env);
    if (!apiKey && provider.name !== 'cloudflare') {
      providerHealth.set(provider.id, false);
      continue;
    }
    try {
      const res = await callProvider(provider, probeMsg, env);
      const ok = res.ok;
      if (!ok) {
        const status = res.status;
        if (PERMANENT_STATUSES.has(status)) {
          providerHealth.set(provider.id, false);
          recordPermanentFailure(provider.id);
        } else if (RETRYABLE_STATUSES.has(status)) {
          providerHealth.set(provider.id, true);
        } else {
          providerHealth.set(provider.id, false);
        }
      } else {
        providerHealth.set(provider.id, true);
      }
      if (!res.body?.locked) {
        try { await res.body?.cancel(); } catch (e) {}
      }
    } catch (e) {
      providerHealth.set(provider.id, false);
    }
  }
}

function isProviderKnownBad(id: string): boolean {
  if (providerHealth?.has(id) && providerHealth.get(id) === false) {
    const c = circuits.get(id);
    if (c?.permanent) return true;
  }
  return false;
}

function getApiKey(provider: Provider, env: any): string | undefined {
  const raw = env[`${provider.name.toUpperCase()}_API_KEY`];
  if (typeof raw === 'string') return raw.trim();
  return raw;
}

export async function routeChat(rawIntent: string, messages: any[], locals: any, providedEnv: any, sessionId: string = '') {
  const env = providedEnv || {};
  const intent = rawIntent || 'chat-fast';

  const role: ProviderRole = classifyQuery(messages, intent);
  let candidates = getProvidersForRole(role);

  if (providerHealth) {
    candidates.sort((a, b) => {
      const aGood = isProviderKnownBad(a.id) ? 1 : 0;
      const bGood = isProviderKnownBad(b.id) ? 1 : 0;
      return aGood - bGood;
    });
  }

  const session = sessionId ? getSession(sessionId) : null;

  async function doChain(): Promise<Response> {
    if (session?.lockedProviderId) {
      const lockedProvider = getProvider(session.lockedProviderId);
      if (lockedProvider && !isCircuitOpen(lockedProvider.id) && !isProviderKnownBad(lockedProvider.id)) {
        const priority = [lockedProvider, ...candidates.filter(p => p.id !== lockedProvider.id)];
        return await attemptFallback(priority, messages, env, intent, session);
      }
      session.lockedProviderId = null;
      session.turnCount = 0;
    }
    return await attemptFallback(candidates, messages, env, intent, session);
  }

  return await Promise.race([
    doChain(),
    new Promise<Response>(resolve =>
      setTimeout(() => resolve(new Response(JSON.stringify({
        message: "I'm taking longer than expected. Please try again in a moment.",
        retryAfter: 5,
      }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' } })), GLOBAL_TIMEOUT_MS)
    ),
  ]);
}

async function attemptFallback(
  providers: Provider[],
  messages: any[],
  env: any,
  intent: string,
  session: SessionState | null,
): Promise<Response> {
  const errors: string[] = [];
  let transientAttempts = 0;
  let permanentSkips = 0;

  for (const provider of providers) {
    if (transientAttempts >= MAX_TRANSIENT_ATTEMPTS) break;

    if (isCircuitOpen(provider.id)) {
      continue;
    }

    if (isProviderKnownBad(provider.id)) {
      permanentSkips++;
      continue;
    }

    const apiKey = getApiKey(provider, env);
    if (!apiKey && provider.name !== 'cloudflare') {
      recordPermanentFailure(provider.id);
      permanentSkips++;
      continue;
    }

    const start = Date.now();
    try {
      const res = await callProvider(provider, messages, env);
      const latency = Date.now() - start;

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
        return new Response(res.body, { status: res.status, headers: newHeaders });
      }

      const status = res.status;

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
  }), { status: 500, headers: { 'Content-Type': 'application/json', 'Retry-After': '15' } });
}

async function callProvider(provider: Provider, messages: any[], env: any): Promise<Response> {
  if (provider.name === 'cloudflare') {
    return await callWorkersAI(provider, messages, env);
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
    max_tokens: 4096,
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

async function callWorkersAI(provider: Provider, messages: any[], env: any): Promise<Response> {
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
        max_tokens: 4096,
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
            // skip malformed JSON lines silently
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