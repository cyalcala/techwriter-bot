import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../lib/prompts';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('client brand voice prompt injection', () => {
  it('injects a markdown-friendly SYSTEM_PROMPT into every chat path', () => {
    const clientPrompt = '# Acme Docs Voice\r\n\r\n- Prefer second person.\r\n- Avoid hype.';

    for (const path of ['fast', 'balanced', 'heavy'] as const) {
      const prompt = buildSystemPrompt('write release notes', {
        path,
        needsArtifact: false,
        clientSystemPrompt: clientPrompt,
      });

      expect(prompt).toContain('CLIENT SYSTEM PROMPT');
      expect(prompt).toContain('# Acme Docs Voice\n\n- Prefer second person.\n- Avoid hype.');
    }
  });

  it('wires SYSTEM_PROMPT from environment into the chat prompt context', () => {
    const chat = source('src/pages/api/chat.ts');
    const envReader = source('src/lib/env-reader.ts');

    expect(chat).toContain('clientSystemPrompt');
    expect(chat).toContain('env.SYSTEM_PROMPT');
    expect(envReader).toContain("set('SYSTEM_PROMPT'");
  });
});
