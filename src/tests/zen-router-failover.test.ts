import { afterEach, describe, expect, it, vi } from 'vitest';

describe('zen router failover metadata', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records provider failover events and returns them on successful fallback responses', async () => {
    const { routeChat } = await import('../lib/zen-router');
    const calls: string[] = [];

    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('api.groq.com')) {
        return new Response('unavailable', { status: 503 });
      }
      return new Response('data: {"choices":[{"delta":{"content":"fallback ok"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const metadata = {
      provider: null,
      searchTier: 'none' as const,
      searchRemaining: 'unlimited',
      tier: 'dev',
      chatPath: 'fast' as const,
    };

    const response = await routeChat(
      'chat-fast',
      [{ role: 'user', content: 'hello' }],
      {},
      { GROQ_API_KEY: 'gsk_test', GEMINI_API_KEY: 'gemini_test' },
      'session-zen-failover',
      [],
      metadata,
      ['groq-fast', 'gemini-flash'],
      'fast',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-provider')).toBe('gemini-flash');
    expect(calls.some(url => url.includes('api.groq.com'))).toBe(true);
    expect(calls.some(url => url.includes('generativelanguage.googleapis.com'))).toBe(true);

    const header = response.headers.get('x-failover-events');
    expect(header).toBeTruthy();
    expect(JSON.parse(header || '[]')[0]).toMatchObject({
      provider: 'groq-fast',
      reason: 'provider_http_503',
      status: 503,
      chatPath: 'fast',
    });
  });

  it('returns a standardized retryable envelope when every provider is unavailable', async () => {
    const { routeChat } = await import('../lib/zen-router');

    vi.stubGlobal('fetch', async () => new Response('unavailable', { status: 503 }));

    const response = await routeChat(
      'chat-fast',
      [{ role: 'user', content: 'hello' }],
      {},
      { GROQ_API_KEY: 'gsk_test' },
      'session-zen-all-down',
      [],
      undefined,
      ['groq-fast'],
      'fast',
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'All AI providers are currently unavailable. Please try again in a moment.',
      code: 'AI_PROVIDERS_UNAVAILABLE',
      retryable: true,
    });
  });
});
