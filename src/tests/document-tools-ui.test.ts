import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('document review tool UI boundary', () => {
  it('keeps uploaded source and findings in active component state only', () => {
    const island = source('src/components/ChatIsland.svelte');
    const rag = source('src/lib/rag-client.ts');

    expect(island).toContain('toolDocument');
    expect(island).toContain('toolFindings');
    expect(island).toContain('result.sourceText');
    expect(island.indexOf('if (result.sourceText)')).toBeGreaterThan(-1);
    expect(island.indexOf('if (result.sourceText)')).toBeLessThan(island.indexOf('if (result.success)'));
    expect(rag).toContain('sourceText?: string');
    expect(rag).not.toContain('localStorage');
    expect(rag).not.toContain('indexedDB');
  });

  it('exposes review through an explicit panel action with session terminology', () => {
    const input = source('src/components/ChatInput.svelte');
    const panel = source('src/components/DocumentToolsPanel.svelte');
    const island = source('src/components/ChatIsland.svelte');

    expect(input).toContain('onToggleTools');
    expect(input).toContain('aria-controls="document-tools-panel"');
    expect(panel).toContain('Review Document');
    expect(panel).toContain('Avoid term');
    expect(panel).toContain('Preferred term');
    expect(panel).toContain('onReview');
    expect(island).toContain('runDocumentReview');
    expect(island).not.toContain('$effect(() => runDocumentReview');
  });

  it('exposes bounded graph lookup as a separate explicit tool action', () => {
    const panel = source('src/components/DocumentToolsPanel.svelte');
    const island = source('src/components/ChatIsland.svelte');

    expect(panel).toContain('Find Code References');
    expect(panel).toContain('onLookup');
    expect(island).toContain('runGraphLookup');
    expect(island).toContain("fetch('/api/tool-graph-lookup'");
  });

  it('clears document tool memory on remove, new chat, and clear chat paths', () => {
    const island = source('src/components/ChatIsland.svelte');

    expect(island).toContain('function clearDocumentToolState()');
    expect(island.match(/clearDocumentToolState\(\);/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
