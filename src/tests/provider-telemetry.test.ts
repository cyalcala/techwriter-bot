import { describe, expect, it, vi } from 'vitest';

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

  it('sheds provider telemetry write failures with a content-free operator notice', async () => {
    const { recordProviderTelemetry } = await import('../lib/provider-telemetry');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = new Date('2026-06-03T10:00:00.000Z');
    const writeAttempts: string[] = [];
    const kv = {
      async get() { return null; },
      async put(key: string, value: string) {
        writeAttempts.push(`${key}:${value}`);
        throw new Error('KV quota exceeded while handling private prompt text');
      },
    };

    try {
      const result = await recordProviderTelemetry(kv, { PROJECT_NAME: 'Acme Docs' }, {
        provider: 'groq-fast',
        chatPath: 'fast',
        outcome: 'provider_error',
        latencyMs: 250,
        status: 503,
        inputTokens: 42,
        requestedOutputTokens: 256,
      }, now);

      expect(result).toMatchObject({
        recorded: false,
        shed: true,
        operatorNotice: {
          code: 'TELEMETRY_SHED',
          severity: 'warning',
        },
      });
      expect(result.operatorNotice?.message).toContain('telemetry');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('TELEMETRY_SHED'));
      expect(writeAttempts).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain('private prompt');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private prompt');
    } finally {
      warn.mockRestore();
    }
  });
});
