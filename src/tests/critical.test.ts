import { describe, it, expect } from 'vitest';

describe('Security checks', () => {
  it('CSRF rejects invalid origin', async () => {
    const { checkCSRF } = await import('../lib/csrf');
    const req = new Request('https://evil.com', { headers: { origin: 'https://evil.com' } });
    expect(checkCSRF(req)).toBe(false);
  });

  it('CSRF rejects origins that merely prefix-match a trusted origin', async () => {
    const { checkCSRF } = await import('../lib/csrf');
    const req = new Request('http://localhost:43210/test', {
      headers: { origin: 'http://localhost:43210' }
    });
    expect(checkCSRF(req)).toBe(false);
  });

  it('CSRF allows known origin', async () => {
    const { checkCSRF } = await import('../lib/csrf');
    const req = new Request('https://tw-bot.pages.dev/test', {
      headers: { origin: 'https://tw-bot.pages.dev' }
    });
    expect(checkCSRF(req)).toBe(true);
  });

  it('CSRF allows localhost', async () => {
    const { checkCSRF } = await import('../lib/csrf');
    const req = new Request('http://localhost:4321/test', {
      headers: { origin: 'http://localhost:4321' }
    });
    expect(checkCSRF(req)).toBe(true);
  });

  it('CSRF allows local loopback preview origin', async () => {
    const { checkCSRF } = await import('../lib/csrf');
    const req = new Request('http://127.0.0.1:4321/test', {
      headers: { origin: 'http://127.0.0.1:4321' }
    });
    expect(checkCSRF(req)).toBe(true);
  });

  it('CSRF allows no origin (API tools)', async () => {
    const { checkCSRF } = await import('../lib/csrf');
    const req = new Request('https://tw-bot.pages.dev/api/chat');
    expect(checkCSRF(req)).toBe(true);
  });
});

describe('Rate limiter', () => {
  it('allows requests under limit', async () => {
    const { createRateLimiter } = await import('../lib/rate-limiter');
    const rl = createRateLimiter(5);
    for (let i = 0; i < 5; i++) {
      expect(rl.check('127.0.0.1')).toBe(true);
    }
  });

  it('blocks requests over limit', async () => {
    const { createRateLimiter } = await import('../lib/rate-limiter');
    const rl = createRateLimiter(3);
    rl.check('1.2.3.4'); rl.check('1.2.3.4'); rl.check('1.2.3.4');
    expect(rl.check('1.2.3.4')).toBe(false);
  });

  it('tracks different IPs separately', async () => {
    const { createRateLimiter } = await import('../lib/rate-limiter');
    const rl = createRateLimiter(2);
    rl.check('ip-a'); rl.check('ip-a');
    expect(rl.check('ip-b')).toBe(true);
    expect(rl.check('ip-a')).toBe(false);
  });
});

describe('Reputation round-trip', () => {
  it('serialize then deserialize preserves state', async () => {
    const { getDefaultState, serializeReputation, deserializeReputation, updateReputation } = await import('../lib/reputation');
    let state = getDefaultState();
    state = updateReputation(state, 'request');
    state = updateReputation(state, 'turnstile_pass');
    state = updateReputation(state, 'bot_ua');
    state = updateReputation(state, 'dup_query', { message: 'my sensitive prompt' });

    const serialized = serializeReputation(state);
    const restored = deserializeReputation(serialized);

    expect(serialized).not.toContain('my sensitive prompt');
    expect(restored.score).toBe(state.score);
    expect(restored.tier).toBe(state.tier);
    expect(restored.turnstilePassed).toBe(true);
  });

  it('default state has valid tier', async () => {
    const { getDefaultState } = await import('../lib/reputation');
    const state = getDefaultState();
    expect(['premium', 'standard', 'curious', 'throttled', 'restricted']).toContain(state.tier);
    expect(state.score).toBeGreaterThanOrEqual(0);
    expect(state.score).toBeLessThanOrEqual(30);
  });
});

describe('Env reader', () => {
  it('checkEnvKeys returns record of booleans', async () => {
    const { checkEnvKeys } = await import('../lib/env-reader');
    const env: Record<string, any> = { GROQ_API_KEY: 'gsk_test', CEREBRAS_API_KEY: '' };
    const keys = checkEnvKeys(env);
    expect(keys.GROQ_API_KEY).toBe(true);
    expect(keys.CEREBRAS_API_KEY).toBe(false);
  });
});

describe('Turnstile', () => {
  it('returns true when no token provided', async () => {
    const { verifyTurnstile } = await import('../lib/turnstile');
    const result = await verifyTurnstile('', 'secret');
    expect(result).toBe(true);
  });

  it('returns true when no secret provided', async () => {
    const { verifyTurnstile } = await import('../lib/turnstile');
    const result = await verifyTurnstile('token', '');
    expect(result).toBe(true);
  });
});
