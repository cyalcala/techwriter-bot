import { describe, expect, it } from 'vitest';

const groqProvider = {
  id: 'groq-fast',
  name: 'groq',
  endpoint: 'https://api.groq.com/openai/v1',
  model: 'llama-test',
  timeoutMs: 1000,
};

describe('provider health checks', () => {
  it('reports unconfigured providers without calling fetch', async () => {
    const { pingProvider } = await import('../lib/provider-health');
    let fetchCalled = false;

    const result = await pingProvider(groqProvider, {}, {
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response('{}');
      },
    });

    expect(fetchCalled).toBe(false);
    expect(result).toMatchObject({
      id: 'groq-fast',
      configured: false,
      ok: false,
      status: null,
      error: 'missing_api_key',
    });
  });

  it('pings configured OpenAI-compatible providers', async () => {
    const { pingProvider } = await import('../lib/provider-health');

    const result = await pingProvider(groqProvider, { GROQ_API_KEY: 'gsk_test' }, {
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe('https://api.groq.com/openai/v1/chat/completions');
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test');
        expect(JSON.parse(String(init?.body)).max_tokens).toBe(1);
        return new Response('{}', { status: 200 });
      },
    });

    expect(result.configured).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it('marks non-ok provider responses as unhealthy and retryable', async () => {
    const { pingProvider } = await import('../lib/provider-health');

    const result = await pingProvider(groqProvider, { GROQ_API_KEY: 'gsk_test' }, {
      fetchImpl: async () => new Response('nope', { status: 503 }),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.retryable).toBe(true);
  });

  it('publishes coarse failure codes without configuration or raw error details', async () => {
    const { toPublicProviderHealth } = await import('../lib/provider-health');

    const publicStatus = toPublicProviderHealth({
      id: 'groq-fast',
      name: 'groq',
      configured: true,
      ok: false,
      status: 503,
      latencyMs: 8,
      retryable: true,
      error: 'provider message containing internal context',
    });

    expect(publicStatus).toEqual({
      id: 'groq-fast',
      name: 'groq',
      ok: false,
      status: 503,
      latencyMs: 8,
      retryable: true,
      error: 'provider_error',
    });
    expect(JSON.stringify(publicStatus)).not.toContain('configured');
    expect(JSON.stringify(publicStatus)).not.toContain('internal context');
  });

  it('never exposes configuration state in public health output', async () => {
    const { toPublicProviderHealth } = await import('../lib/provider-health');

    const unconfigured = toPublicProviderHealth({
      id: 'groq-fast',
      name: 'groq',
      configured: false,
      ok: false,
      status: null,
      latencyMs: 0,
      retryable: false,
      error: 'missing_api_key',
    });

    expect(unconfigured.error).toBeUndefined();
    expect(JSON.stringify(unconfigured)).not.toContain('missing_api_key');

    const missingBinding = toPublicProviderHealth({
      id: 'cloudflare-llama',
      name: 'cloudflare',
      configured: false,
      ok: false,
      status: null,
      latencyMs: 0,
      retryable: false,
      error: 'missing_ai_binding',
    });

    expect(missingBinding.error).toBeUndefined();
  });

  it('passes through timeout and http status codes as public error codes', async () => {
    const { toPublicProviderHealth } = await import('../lib/provider-health');

    const timedOut = toPublicProviderHealth({
      id: 'cloudflare-llama',
      name: 'cloudflare',
      configured: true,
      ok: false,
      status: null,
      latencyMs: 5000,
      retryable: true,
      error: 'timeout',
    });
    expect(timedOut.error).toBe('timeout');

    const httpError = toPublicProviderHealth({
      id: 'groq-fast',
      name: 'groq',
      configured: true,
      ok: false,
      status: 403,
      latencyMs: 10,
      retryable: false,
      error: 'http_403',
    });
    expect(httpError.error).toBe('http_403');

    const healthy = toPublicProviderHealth({
      id: 'nvidia-fast',
      name: 'nvidia',
      configured: true,
      ok: true,
      status: 200,
      latencyMs: 240,
      retryable: false,
    });
    expect(healthy.error).toBeUndefined();
  });
});
