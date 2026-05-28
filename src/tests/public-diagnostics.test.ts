import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('public operational endpoints', () => {
  it('keeps health output free of secret configuration inventories', () => {
    const health = source('src/pages/api/health.ts');

    expect(health).toContain('toPublicProviderHealth');
    expect(health).not.toContain('checkEnvKeys');
    expect(health).not.toContain('keys:');
    expect(health).not.toContain('configuredProviders');
    expect(health).not.toContain('String(error.message)');
    expect(health).toContain("message: 'Health check failed.'");
  });

  it('does not expose chat route diagnostics through GET', () => {
    const chat = source('src/pages/api/chat.ts');
    const getHandler = chat.slice(chat.indexOf('export const GET'), chat.indexOf('export const POST'));
    const island = source('src/components/ChatIsland.svelte');

    expect(getHandler).toContain('METHOD_NOT_ALLOWED');
    expect(getHandler).not.toContain('getCircuitDiagnostics');
    expect(getHandler).not.toContain('checkEnvKeys');
    expect(getHandler).not.toContain('clientIP');
    expect(getHandler).not.toContain('tokenUsage');
    expect(island).not.toContain('checkKeys');
    expect(island).not.toContain('Keys missing');
  });

  it('disables legacy public debugging endpoints', () => {
    for (const path of ['src/pages/api/debug.ts', 'src/pages/api/debug-ai.ts']) {
      const route = source(path);

      expect(route).toContain('DIAGNOSTICS_DISABLED');
      expect(route).not.toContain('checkEnvKeys');
      expect(route).not.toContain('Object.keys(env)');
      expect(route).not.toContain('pingProvider');
    }
  });

  it('does not return or log raw upstream failure text from interactive routes', () => {
    const embed = source('src/pages/api/embed.ts');
    const summarize = source('src/pages/api/summarize.ts');
    const chat = source('src/pages/api/chat.ts');
    const renderArtifact = source('src/pages/api/render-artifact.ts');
    const zenRouter = source('src/lib/zen-router.ts');

    expect(embed).toContain("message: 'Embedding failed.'");
    expect(embed).not.toContain('error.message');
    expect(summarize).toContain("message: 'Summarization failed.'");
    expect(summarize).not.toContain('e.message');
    expect(chat).not.toMatch(/log\('error',\s*\{\s*message:/);
    expect(renderArtifact).toContain("message: 'Artifact render failed.'");
    expect(renderArtifact).not.toContain('e.message');
    expect(zenRouter).not.toContain('String(p.error)');
    expect(zenRouter).not.toContain('error: e.message');
    expect(zenRouter).not.toContain('lastError');
    expect(zenRouter).not.toContain('e.message || e.name');

    for (const path of [
      'src/pages/api/search-credits.ts',
      'src/lib/search.ts',
      'src/lib/search-enhanced.ts',
      'src/lib/search-reddit.ts',
    ]) {
      expect(source(path)).not.toMatch(/message:\s*e\.message/);
    }
  });
});
