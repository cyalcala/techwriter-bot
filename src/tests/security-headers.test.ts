import { describe, expect, it } from 'vitest';

describe('security headers', () => {
  it('applies CSP and baseline browser hardening headers', async () => {
    const { applySecurityHeaders } = await import('../lib/security-headers');
    const response = new Response('ok');

    const hardened = applySecurityHeaders(response);

    expect(hardened.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(hardened.headers.get('content-security-policy')).toContain('frame-src');
    expect(hardened.headers.get('content-security-policy')).toContain('https://fonts.googleapis.com');
    expect(hardened.headers.get('content-security-policy')).toContain('https://fonts.gstatic.com');
    expect(hardened.headers.get('x-content-type-options')).toBe('nosniff');
    expect(hardened.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(hardened.headers.get('permissions-policy')).toContain('geolocation=()');
    expect(hardened.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(hardened.headers.get('cross-origin-embedder-policy')).toBe('credentialless');
  });

  it('preserves existing response headers', async () => {
    const { applySecurityHeaders } = await import('../lib/security-headers');
    const response = new Response('ok', { headers: { 'x-request-id': 'req_existing' } });

    const hardened = applySecurityHeaders(response);

    expect(hardened.headers.get('x-request-id')).toBe('req_existing');
  });
});
