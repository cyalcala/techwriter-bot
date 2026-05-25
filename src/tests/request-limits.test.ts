import { describe, expect, it } from 'vitest';

describe('request limits', () => {
  it('uses safe Phase 1 defaults', async () => {
    const { getRequestLimits } = await import('../lib/request-limits');

    expect(getRequestLimits({})).toEqual({
      chatMaxChars: 4000,
      maxRequestBodyBytes: 5 * 1024 * 1024,
      rateLimitPerMinute: 30,
      rateLimitPerDay: 500,
    });
  });

  it('allows positive integer env overrides', async () => {
    const { getRequestLimits } = await import('../lib/request-limits');

    expect(getRequestLimits({
      CHAT_MAX_CHARS: '1200',
      MAX_REQUEST_BODY_BYTES: '2048',
      RATE_LIMIT_PER_MINUTE: '7',
      RATE_LIMIT_PER_DAY: '42',
    })).toEqual({
      chatMaxChars: 1200,
      maxRequestBodyBytes: 2048,
      rateLimitPerMinute: 7,
      rateLimitPerDay: 42,
    });
  });

  it('falls back when env overrides are invalid', async () => {
    const { getRequestLimits } = await import('../lib/request-limits');

    expect(getRequestLimits({
      CHAT_MAX_CHARS: '-1',
      MAX_REQUEST_BODY_BYTES: 'not-a-number',
      RATE_LIMIT_PER_MINUTE: '0',
      RATE_LIMIT_PER_DAY: '',
    })).toEqual({
      chatMaxChars: 4000,
      maxRequestBodyBytes: 5 * 1024 * 1024,
      rateLimitPerMinute: 30,
      rateLimitPerDay: 500,
    });
  });
});

describe('chat sanitization', () => {
  it('strips html tags and control characters while preserving markdown', async () => {
    const { sanitizeChatInput } = await import('../lib/request-limits');

    const result = sanitizeChatInput('**Keep** <script>alert(1)</script>\u0000 [link](https://x.test)', 4000);

    expect(result).toBe('**Keep** alert(1) [link](https://x.test)');
  });

  it('truncates chat content to the configured limit', async () => {
    const { sanitizeChatInput } = await import('../lib/request-limits');

    expect(sanitizeChatInput('abcdef', 4)).toBe('abcd');
  });
});
