import { describe, expect, it } from 'vitest';

describe('app version checks', () => {
  it('reports ok when KV and configured APP_VERSION match', async () => {
    const { checkAppVersion } = await import('../lib/app-version');
    const kv = { get: async () => '1.2.3' };

    await expect(checkAppVersion(kv, { APP_VERSION: '1.2.3', PROJECT_NAME: 'Acme' })).resolves.toMatchObject({
      available: true,
      expected: '1.2.3',
      stored: '1.2.3',
      mismatch: false,
    });
  });

  it('reports privacy-safe cleanup guidance when KV version is different', async () => {
    const { checkAppVersion } = await import('../lib/app-version');
    const kv = { get: async (key: string) => key === 'acme:app:version' ? '1.0.0' : null };

    const result = await checkAppVersion(kv, { APP_VERSION: '2.0.0', PROJECT_NAME: 'Acme' });

    expect(result).toMatchObject({
      available: true,
      expected: '2.0.0',
      stored: '1.0.0',
      mismatch: true,
    });
    const steps = result.recovery?.steps.join(' ') || '';
    expect(steps).toContain('remove legacy content');
    expect(steps).toContain('non-content operational');
    expect(steps).not.toContain('session/RAG data');
    expect(steps).not.toContain('import');
  });

  it('degrades cleanly without a KV binding', async () => {
    const { checkAppVersion } = await import('../lib/app-version');

    await expect(checkAppVersion(null, { APP_VERSION: '1.2.3' })).resolves.toMatchObject({
      available: false,
      expected: '1.2.3',
      stored: null,
      mismatch: false,
    });
  });

  it('does not disclose KV failure details in public version status', async () => {
    const { checkAppVersion } = await import('../lib/app-version');
    const kv = { get: async () => { throw new Error('backend credential detail'); } };

    const result = await checkAppVersion(kv, { APP_VERSION: '1.2.3', PROJECT_NAME: 'Acme' });

    expect(result.error).toBe('version_check_failed');
    expect(JSON.stringify(result)).not.toContain('credential detail');
  });
});
