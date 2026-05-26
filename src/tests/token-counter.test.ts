import { describe, expect, it } from 'vitest';

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
});
