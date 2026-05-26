import { describe, expect, it } from 'vitest';

function createKV() {
  const data = new Map<string, string>();
  return {
    data,
    async get(key: string) {
      const value = data.get(key);
      return value ? JSON.parse(value) : null;
    },
    async put(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe('provider telemetry', () => {
  it('stores only aggregate provider/path reliability and usage dimensions', async () => {
    const { recordProviderTelemetry } = await import('../lib/provider-telemetry');
    const kv = createKV();
    const now = new Date('2026-05-25T12:34:00.000Z');

    await recordProviderTelemetry(kv, { PROJECT_NAME: 'Acme Docs' }, {
      provider: 'groq-fast',
      chatPath: 'fast',
      outcome: 'success',
      latencyMs: 120,
      status: 200,
      inputTokens: 21,
      requestedOutputTokens: 256,
      freeTier: true,
    }, now);
    await recordProviderTelemetry(kv, { PROJECT_NAME: 'Acme Docs' }, {
      provider: 'groq-fast',
      chatPath: 'fast',
      outcome: 'http_error',
      latencyMs: 80,
      status: 503,
      inputTokens: 21,
      requestedOutputTokens: 256,
      freeTier: true,
    }, now);

    const key = 'acme-docs:telemetry:provider:2026-05-25T12:groq-fast:fast';
    const stored = JSON.parse(kv.data.get(key) || '{}');

    expect(stored).toMatchObject({
      requests: 2,
      successes: 1,
      failures: 1,
      totalLatencyMs: 200,
      maxLatencyMs: 120,
      inputTokens: 42,
      requestedOutputTokens: 512,
      freeTierRequests: 2,
      statuses: { '200': 1, '503': 1 },
      outcomes: { success: 1, http_error: 1 },
    });
    expect(JSON.stringify(stored)).not.toContain('prompt');
    expect(JSON.stringify(stored)).not.toContain('response');
  });
});
