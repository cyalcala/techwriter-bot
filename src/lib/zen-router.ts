import { ZEN_REGISTRY, classifyQuery, getProvidersForRole, getProvider, type Provider, type ProviderRole } from './providers';

const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
const CIRCUIT_BREAKER_FAILURES = 3;
const CIRCUIT_BREAKER_EJECT_MS = 120_000;
const CIRCUIT_BREAKER_PROBE_MS = 60_000;
const MAX_ATTEMPTS = 3;
const USER_FACING_TIMEOUT_MS = 15_000;

interface CircuitState {
  failures: number[];
  ejectedUntil: number;
  halfOpen: boolean;
  totalErrors: number;
  rateLimitHits: number;
  totalLatency: number;
  requestCount: number;
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
    circuits.set(id, { failures: [], ejectedUntil: 0, halfOpen: false, totalErrors: 0, rateLimitHits: 0, totalLatency: 0, requestCount: 0 });
  }
  return circuits.get(id)!;
}

function isCircuitOpen(id: string): boolean {
  const c = getCircuit(id);
  const now = Date.now();
  const recentFailures = c.failures.filter(t => now - t < CIRCUIT_BREAKER_WINDOW_MS);
  c.failures = recentFailures;

  if (c.ejectedUntil > 0) {
    if (now >= c.ejectedUntil) {
      c.ejectedUntil = 0;
      c.halfOpen = true;
      c.failures = [];
      return false;
    }
    if (now >= c.ejectedUntil - CIRCUIT_BREAKER_PROBE_MS) {
      c.halfOpen = true;
      return false;
    }
    return true;
  }

  if (recentFailures.length >= CIRCUIT_BREAKER_FAILURES) {
    c.ejectedUntil = now + CIRCUIT_BREAKER_EJECT_MS;
    c.halfOpen = false;
    return true;
  }

  return false;
}

function recordSuccess(id: string, latencyMs: number) {
  const c = getCircuit(id);
  c.failures = [];
  c.ejectedUntil = 0;
  c.halfOpen = false;
  c.totalLatency += latencyMs;
  c.requestCount++;
}

function recordFailure(id: string, isRateLimit: boolean) {
  const c = getCircuit(id);
  const now = Date.now();
  c.failures.push(now);
  c.failures = c.failures.filter(t => now - t < CIRCUIT_BREAKER_WINDOW_MS);
  c.totalErrors++;
  if (isRateLimit) c.rateLimitHits++;
  if (c.halfOpen) {
    c.ejectedUntil = now + CIRCUIT_BREAKER_EJECT_MS;
    c.halfOpen = false;
  }
}

function getSession(sessionId: string, maxTurns: number = 3): SessionState {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { lockedProviderId: null, turnCount: 0, maxTurns, createdAt: Date.now() });
  }
  return sessions.get(sessionId)!;
}

export async function routeChat(rawIntent: string, messages: any[], locals: any, providedEnv: any, sessionId: string = '') {
  const env = providedEnv || {};
  const intent = rawIntent || 'chat-fast';

  const role: ProviderRole = classifyQuery(messages, intent);
  const candidates = getProvidersForRole(role);
  const session = sessionId ? getSession(sessionId) : null;

  if (session?.lockedProviderId) {
    const lockedProvider = getProvider(session.lockedProviderId);
    if (lockedProvider && !isCircuitOpen(lockedProvider.id)) {
      const priority = [lockedProvider, ...candidates.filter(p => p.id !== lockedProvider.id)];
      return await attemptFallback(priority, messages, env, locals, intent, session);
    }
    session.lockedProviderId = null;
    session.turnCount = 0;
  }

  return await attemptFallback(candidates, messages, env, locals, intent, session);
}

async function attemptFallback(
  providers: Provider[],
  messages: any[],
  env: any,
  locals: any,
  intent: string,
  session: SessionState | null,
): Promise<Response> {
  const errors: string[] = [];
  let attempts = 0;

  for (const provider of providers) {
    if (attempts >= MAX_ATTEMPTS) break;

    if (isCircuitOpen(provider.id)) {
      errors.push(`${provider.id}: circuit-open`);
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
      const errorText = await res.text().catch(() => 'unknown');
      const isRateLimit = status === 429;
      recordFailure(provider.id, isRateLimit);
      errors.push(`${provider.id}: ${status} - ${errorText.slice(0, 80)}`);
      attempts++;

    } catch (e: any) {
      const latency = Date.now() - start;
      recordFailure(provider.id, false);
      errors.push(`${provider.id}: ${e.message?.slice(0, 80)}`);
      attempts++;
    }
  }

  if (errors.length > 0) {
    return new Response(JSON.stringify({
      error: 'AI_PROVIDER_FATAL_ERROR',
      details: 'All capable providers are unavailable.',
      errors,
      diagnostics: {
        envKeys: Object.keys(env).filter(k => env[k]),
        attempts,
        role: providers[0]?.role,
        circuitStates: Object.fromEntries(
          [...circuits.entries()].map(([k, v]) => [k, {
            ejected: v.ejectedUntil > Date.now(),
            failures: v.failures.length,
            errors: v.totalErrors,
            rlHits: v.rateLimitHits,
          }])
        ),
      },
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    error: 'ALL_PROVIDERS_DOWN',
    details: 'High demand. Please try again in 30 seconds.',
  }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } });
}

async function callProvider(provider: Provider, messages: any[], env: any): Promise<Response> {
  if (provider.name === 'cloudflare') {
    return await callWorkersAI(provider, messages, env);
  }

  const endpoint = provider.name === 'gemini'
    ? `${provider.endpoint}/openai/chat/completions`
    : `${provider.endpoint}/chat/completions`;

  const apiKey = typeof env[`${provider.name.toUpperCase()}_API_KEY`] === 'string'
    ? env[`${provider.name.toUpperCase()}_API_KEY`].trim()
    : env[`${provider.name.toUpperCase()}_API_KEY`];

  if (!apiKey) {
    throw new Error(`Missing API Key for ${provider.name}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), provider.timeoutMs);

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

  const stream = await ai.run(provider.model as any, {
    messages,
    stream: true,
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

export function getCircuitDiagnostics() {
  return Object.fromEntries(
    [...circuits.entries()].map(([k, v]) => [k, {
      ejected: v.ejectedUntil > Date.now(),
      failures: v.failures.length,
      errors: v.totalErrors,
      rlHits: v.rateLimitHits,
      avgLatency: v.requestCount > 0 ? Math.round(v.totalLatency / v.requestCount) : 0,
      requests: v.requestCount,
    }])
  );
}