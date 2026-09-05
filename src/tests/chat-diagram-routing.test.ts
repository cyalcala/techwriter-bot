import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('chat API diagram routing', () => {
  it('derives the visual plan before context retrieval', () => {
    const chat = source('src/pages/api/chat.ts');
    const planIndex = chat.indexOf('const diagramPlan = inferDiagramPlan(query, messages);');
    const searchIndex = chat.indexOf('searchResult = await searchRouter(');

    expect(planIndex).toBeGreaterThanOrEqual(0);
    expect(searchIndex).toBeGreaterThan(planIndex);
  });

  it('keeps automatic visuals additive to the selected research path', () => {
    const chat = source('src/pages/api/chat.ts');

    expect(chat).toContain("const needsVisualExplanation = !needsArtifact && diagramPlan.mode === 'automatic';");
    expect(chat).toContain("const effectivePath = needsArtifact ? 'fast' : pathCtx.path;");
    expect(chat).toContain('needsVisualExplanation,');
    expect(chat).toContain('diagramPlan: diagramPlan.mode !== \'none\' ? diagramPlan : undefined,');
    expect(chat).toContain("if (effectivePath !== 'fast') {");
    expect(chat).not.toContain("if (pathCtx.path !== 'fast') {");
  });

  it('gives prose-plus-diagram responses enough output budget without changing explicit artifact budgets', () => {
    const chat = source('src/pages/api/chat.ts');
    const outputBudget = chat.slice(chat.indexOf('needsArtifact\n        ? ((needsDeck || needsDoc) ? 4096 : 2048)'));

    expect(outputBudget).toContain('needsVisualExplanation');
    expect(outputBudget).toContain('? 3072');
    expect(outputBudget).toContain(': undefined');
  });

  it('returns a server choice plan so the picker is available even when the model omits its wrapper', () => {
    const chat = source('src/pages/api/chat.ts');

    expect(chat).toContain("headers.set('x-diagram-plan', JSON.stringify(diagramPlan));");
    expect(chat).toContain("if (diagramPlan.mode !== 'none') headers.set('x-diagram-plan'");
  });

  it('keeps artifact requests failover-capable instead of pinning a hallucinating tool model', () => {
    const chat = source('src/pages/api/chat.ts');

    expect(chat).toContain("pool = isDev ? ['gemini-flash', 'cloudflare-llama', 'groq-fast']");
    expect(chat).toContain('const routeSessionId = needsArtifact ? \'\' : sessionId;');
    expect(chat).toContain('const forceSticky = false;');
  });
});
