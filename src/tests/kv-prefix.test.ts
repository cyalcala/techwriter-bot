import { describe, expect, it } from 'vitest';

describe('KV key prefixing', () => {
  it('prefixes keys with a normalized project name', async () => {
    const { kvKey } = await import('../lib/kv-prefix');

    expect(kvKey({ PROJECT_NAME: 'Acme Docs AI' }, 'reputation:1.2.3.4')).toBe('acme-docs-ai:reputation:1.2.3.4');
  });

  it('falls back to the bare key when project name is missing', async () => {
    const { kvKey } = await import('../lib/kv-prefix');

    expect(kvKey({}, 'qcache:abc')).toBe('qcache:abc');
  });

  it('does not double-prefix keys', async () => {
    const { kvKey } = await import('../lib/kv-prefix');

    expect(kvKey({ PROJECT_NAME: 'Acme' }, 'acme:circuit:groq')).toBe('acme:circuit:groq');
  });
});
