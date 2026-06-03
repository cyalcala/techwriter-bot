import { describe, expect, it, vi } from 'vitest';

describe('token usage key isolation', () => {
  it('prefixes aggregate token counters with the project name', async () => {
    const { logTokenUsage } = await import('../lib/token-counter');
    let storedKey = '';
    const kv = {
      async get() { return null; },
      async put(key: string) { storedKey = key; },
    };

    await logTokenUsage(kv, { PROJECT_NAME: 'Acme Docs' }, 'groq-fast', 20, 0);

    expect(storedKey).toMatch(/^acme-docs:tk:\d{4}-\d{2}-\d{2}:\d{2}$/);
  });

  it('sheds aggregate token counter write failures with a content-free operator notice', async () => {
    const { logTokenUsage } = await import('../lib/token-counter');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = {
      async get() { return null; },
      async put() {
        throw new Error('KV quota exceeded while handling private prompt text');
      },
    };

    try {
      const result = await logTokenUsage(kv, { PROJECT_NAME: 'Acme Docs' }, 'groq-fast', 20, 5);

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
      expect(JSON.stringify(result)).not.toContain('private prompt');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private prompt');
    } finally {
      warn.mockRestore();
    }
  });
});
