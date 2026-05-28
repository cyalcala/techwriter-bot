import { describe, expect, it } from 'vitest';

describe('API response helpers', () => {
  it('creates a standardized error response with request id header', async () => {
    const { apiError } = await import('../lib/api-response');

    const res = apiError({
      requestId: 'req_test',
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests.',
      retryable: true,
      retryAfter: 30,
    });

    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-request-id')).toBe('req_test');
    expect(res.headers.get('retry-after')).toBe('30');
    await expect(res.json()).resolves.toEqual({
      error: 'Too many requests.',
      code: 'RATE_LIMITED',
      retryable: true,
    });
  });

  it('adds request id headers to successful JSON responses', async () => {
    const { jsonResponse } = await import('../lib/api-response');

    const res = jsonResponse({ status: 'ok' }, { requestId: 'req_ok' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-request-id')).toBe('req_ok');
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('keeps existing headers while adding request id', async () => {
    const { withRequestId } = await import('../lib/api-response');

    const headers = withRequestId({ 'x-provider': 'groq-fast' }, 'req_existing');

    expect(headers.get('x-provider')).toBe('groq-fast');
    expect(headers.get('x-request-id')).toBe('req_existing');
  });
});
