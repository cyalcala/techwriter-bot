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
});
