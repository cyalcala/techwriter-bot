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
});
