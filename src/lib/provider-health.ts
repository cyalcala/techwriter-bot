export interface HealthProvider {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
}

export interface ProviderHealth {
  id: string;
  name: string;
  configured: boolean;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  retryable: boolean;
  error?: string;
}

export interface PublicProviderHealth {
  id: string;
  name: string;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  retryable: boolean;
}

export interface ProviderHealthOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function getApiKey(provider: HealthProvider, env: Record<string, unknown>): string | undefined {
  const raw = env[`${provider.name.toUpperCase()}_API_KEY`];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function providerEndpoint(provider: HealthProvider): string {
  if (provider.name === 'gemini') return `${provider.endpoint}/openai/chat/completions`;
  return `${provider.endpoint}/chat/completions`;
}

export async function pingProvider(
  provider: HealthProvider,
  env: Record<string, unknown>,
  options: ProviderHealthOptions = {},
): Promise<ProviderHealth> {
  const start = Date.now();

  if (provider.name === 'cloudflare') {
    const ai = env.AI as { run?: (model: string, input: unknown) => Promise<unknown> } | undefined;
    if (!ai?.run) {
      return { id: provider.id, name: provider.name, configured: false, ok: false, status: null, latencyMs: 0, retryable: false, error: 'missing_ai_binding' };
    }

    try {
      await Promise.race([
        ai.run(provider.model, { messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, temperature: 0 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), options.timeoutMs ?? provider.timeoutMs)),
      ]);
      return { id: provider.id, name: provider.name, configured: true, ok: true, status: 200, latencyMs: Date.now() - start, retryable: false };
    } catch (error: any) {
      return { id: provider.id, name: provider.name, configured: true, ok: false, status: null, latencyMs: Date.now() - start, retryable: true, error: String(error?.message || error).slice(0, 120) };
    }
  }

  const apiKey = getApiKey(provider, env);
  if (!apiKey) {
    return { id: provider.id, name: provider.name, configured: false, ok: false, status: null, latencyMs: 0, retryable: false, error: 'missing_api_key' };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), options.timeoutMs ?? provider.timeoutMs);

  try {
    const response = await fetchImpl(providerEndpoint(provider), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0,
        max_tokens: 1,
        stream: false,
      }),
      signal: ctrl.signal,
    });

    return {
      id: provider.id,
      name: provider.name,
      configured: true,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - start,
      retryable: !response.ok && RETRYABLE_STATUSES.has(response.status),
      error: response.ok ? undefined : `http_${response.status}`,
    };
  } catch (error: any) {
    return {
      id: provider.id,
      name: provider.name,
      configured: true,
      ok: false,
      status: null,
      latencyMs: Date.now() - start,
      retryable: true,
      error: String(error?.message || error).slice(0, 120),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkProvidersHealth(
  providers: HealthProvider[],
  env: Record<string, unknown>,
  options: ProviderHealthOptions = {},
): Promise<ProviderHealth[]> {
  return Promise.all(providers.map(provider => pingProvider(provider, env, options)));
}

export function toPublicProviderHealth(provider: ProviderHealth): PublicProviderHealth {
  return {
    id: provider.id,
    name: provider.name,
    ok: provider.ok,
    status: provider.status,
    latencyMs: provider.latencyMs,
    retryable: provider.retryable,
  };
}
