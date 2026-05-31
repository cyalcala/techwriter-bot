import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, deriveSuggestedPrompts } from '../lib/prompts';

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

  it('derives three safe empty-chat suggestions from SYSTEM_PROMPT content', () => {
    const apiVoice = deriveSuggestedPrompts('Confidential Acme voice. Prioritize API reference docs and endpoint examples.');
    const onboardingVoice = deriveSuggestedPrompts('Confidential Acme voice. Prioritize onboarding guides and quickstarts.');

    expect(apiVoice).toHaveLength(3);
    expect(onboardingVoice).toHaveLength(3);
    expect(apiVoice).not.toEqual(onboardingVoice);
    expect(apiVoice.join('\n')).toMatch(/API|endpoint|reference/i);
    expect(onboardingVoice.join('\n')).toMatch(/quickstart|onboarding|setup/i);
    expect(apiVoice.join('\n')).not.toContain('Confidential Acme voice');
    expect(onboardingVoice.join('\n')).not.toContain('Confidential Acme voice');
  });

  it('wires PERSONA_NAME and derived suggestions into the empty chat UI', () => {
    const index = source('src/pages/index.astro');
    const island = source('src/components/ChatIsland.svelte');
    const envReader = source('src/lib/env-reader.ts');
    const template = source('.env.template');

    expect(index).toContain('PERSONA_NAME');
    expect(index).toContain('deriveSuggestedPrompts');
    expect(index).toContain('personaName={personaName}');
    expect(index).toContain('suggestedPrompts={suggestedPrompts}');

    expect(island).toContain('personaName?: string');
    expect(island).toContain('suggestedPrompts?: string[]');
    expect(island).toContain('{visiblePersonaName}');
    expect(island).toContain('showSuggestedPrompts');
    expect(island).toContain('sendSuggestedPrompt');

    expect(envReader).toContain("set('PERSONA_NAME'");
    expect(template).toContain('PERSONA_NAME=');
  });

  it('keeps brand voice runtime-configurable in Cloudflare Pages deploys', () => {
    const index = source('src/pages/index.astro');
    const workflow = source('.github/workflows/deploy.yml');

    expect(index).toContain("import { env as cfGlobalEnv } from 'cloudflare:workers'");
    expect(index).toContain('runtimeEnv.SYSTEM_PROMPT');
    expect(index).toContain('runtimeEnv.PERSONA_NAME');
    expect(index).not.toContain('Astro.locals.runtime.env');
    expect(index).not.toContain('runtime?.env');

    expect(workflow).toContain('SYSTEM_PROMPT: process.env.SYSTEM_PROMPT');
    expect(workflow).toContain('PERSONA_NAME: process.env.PERSONA_NAME');
    expect(workflow).toContain('SYSTEM_PROMPT: ${{ secrets.SYSTEM_PROMPT }}');
    expect(workflow).toContain('PERSONA_NAME: ${{ vars.PERSONA_NAME || secrets.PERSONA_NAME }}');
  });
});
