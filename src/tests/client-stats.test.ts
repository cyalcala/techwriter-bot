import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function createKV(seed: Record<string, unknown>) {
  const data = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    async get(key: string) {
      const value = data.get(key);
      return value ? JSON.parse(value) : null;
    },
    async list({ prefix }: { prefix: string }) {
      return {
        keys: [...data.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
      };
    },
  };
}

describe('client operational stats', () => {
  it('aggregates the last 24 hours from content-free provider telemetry', async () => {
    const { collectOperationalStats } = await import('../lib/stats');
    const now = new Date('2026-06-02T10:30:00.000Z');
    const kv = createKV({
      'acme-docs:telemetry:provider:2026-06-02T10:groq-fast:fast': {
        requests: 2,
        successes: 2,
        failures: 0,
        totalLatencyMs: 200,
        inputTokens: 20,
        requestedOutputTokens: 100,
        prompt: 'private prompt should not leak',
      },
      'acme-docs:telemetry:provider:2026-06-02T09:gemini-flash:balanced': {
        requests: 1,
        successes: 0,
        failures: 1,
        totalLatencyMs: 400,
        inputTokens: 10,
        requestedOutputTokens: 50,
        response: 'private response should not leak',
      },
      'acme-docs:telemetry:provider:2026-06-01T09:old-provider:fast': {
        requests: 99,
        successes: 99,
        failures: 0,
        totalLatencyMs: 99,
        inputTokens: 99,
        requestedOutputTokens: 99,
      },
    });

    const stats = await collectOperationalStats(kv, { PROJECT_NAME: 'Acme Docs' }, { now, hours: 24 });

    expect(stats).toMatchObject({
      windowHours: 24,
      requestsLast24h: 3,
      successes: 2,
      failures: 1,
      averageLatencyMs: 200,
      tokensUsed: 180,
      topProvider: 'groq-fast',
    });
    expect(stats.providers.map((provider) => provider.provider)).toEqual(['groq-fast', 'gemini-flash']);
    expect(stats.providers[0]).toMatchObject({
      provider: 'groq-fast',
      requests: 2,
      averageLatencyMs: 100,
      tokensUsed: 120,
    });
    expect(JSON.stringify(stats)).not.toContain('private prompt');
    expect(JSON.stringify(stats)).not.toContain('private response');
    expect(JSON.stringify(stats)).not.toContain('old-provider');
  });

  it('returns a content-free operator notice when telemetry KV listing is unavailable', async () => {
    const { collectOperationalStats } = await import('../lib/stats');
    const now = new Date('2026-06-03T10:30:00.000Z');
    const kv = {
      async list() {
        throw new Error('KV quota exceeded after private prompt text');
      },
      async get() {
        throw new Error('private response text should not be queried');
      },
    };

    const stats = await collectOperationalStats(kv, { PROJECT_NAME: 'Acme Docs' }, { now, hours: 24 });

    expect(stats).toMatchObject({
      windowHours: 24,
      requestsLast24h: 0,
      successes: 0,
      failures: 0,
      averageLatencyMs: 0,
      tokensUsed: 0,
      topProvider: null,
      providers: [],
      telemetryAvailable: false,
      operatorNotice: {
        code: 'TELEMETRY_SHED',
        severity: 'warning',
      },
    });
    expect(stats.operatorNotice?.message).toContain('telemetry');
    expect(JSON.stringify(stats)).not.toContain('private prompt');
    expect(JSON.stringify(stats)).not.toContain('private response');
  });

  it('authorizes stats with an env password from bearer or explicit header only', async () => {
    const { isStatsAuthorized } = await import('../lib/stats');
    const env = { STATS_PASSWORD: 'correct horse battery staple' };

    expect(isStatsAuthorized(new Headers({ Authorization: 'Bearer correct horse battery staple' }), env)).toBe(true);
    expect(isStatsAuthorized(new Headers({ 'x-stats-password': 'correct horse battery staple' }), env)).toBe(true);
    expect(isStatsAuthorized(new Headers({ Authorization: 'Bearer wrong' }), env)).toBe(false);
    expect(isStatsAuthorized(new Headers(), env)).toBe(false);
    expect(isStatsAuthorized(new Headers({ Authorization: 'Bearer anything' }), {})).toBe(false);
  });

  it('exposes a protected no-store stats API without durable writes or content fields', () => {
    const route = source('src/pages/api/stats.ts');

    expect(route).toContain("const RESPONSE_HEADERS = { 'Cache-Control': 'no-store, private' }");
    expect(route).toContain('STATS_PASSWORD');
    expect(route).toContain('STATS_AUTH_REQUIRED');
    expect(route).toContain('collectOperationalStats');
    expect(route).toContain('apiError');
    expect(route).toContain('jsonResponse');
    expect(route).not.toContain('.put(');
    expect(route).not.toContain('console.');
    expect(route).not.toContain('prompt');
    expect(route).not.toContain('responseText');
    expect(route).not.toContain('generatedAnswer');
  });
});
