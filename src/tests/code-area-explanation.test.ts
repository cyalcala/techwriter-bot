import { describe, expect, it } from 'vitest';
import {
  MAX_CODE_AREA_EXPLANATION_REFERENCES,
  createCodeAreaExplanation,
} from '../lib/code-area-explanation';

describe('bounded code-area explanation helper', () => {
  it('creates a bounded explanation scaffold from graph context references', () => {
    const context = [
      'KNOWLEDGE GRAPH CONTEXT (5 of 1070 nodes):',
      'ChatIsland (component, src/components/ChatIsland.svelte:539)',
      'runCoverageMap() (function, src/components/ChatIsland.svelte:597)',
      'DocumentToolsPanel (component, src/components/DocumentToolsPanel.svelte)',
      'tool-graph-lookup (api, src/pages/api/tool-graph-lookup.ts:1)',
      'ExtraReference (function, src/lib/extra.ts:10)',
    ].join('\n');

    const explanation = createCodeAreaExplanation('  ChatIsland  ', {
      available: true,
      context,
      nodeCount: 5,
    });

    expect(explanation.available).toBe(true);
    expect(explanation.term).toBe('ChatIsland');
    expect(explanation.nodeCount).toBe(5);
    expect(explanation.references).toHaveLength(MAX_CODE_AREA_EXPLANATION_REFERENCES);
    expect(explanation.references[0]).toEqual({
      label: 'ChatIsland',
      kind: 'component',
      file: 'src/components/ChatIsland.svelte',
      line: '539',
    });
    expect(explanation.summary).toContain('ChatIsland');
    expect(explanation.summary).toContain('src/components/ChatIsland.svelte');
    expect(JSON.stringify(explanation)).not.toContain('ExtraReference');
  });

  it('degrades without pretending to explain missing references', () => {
    const unavailable = createCodeAreaExplanation('Graph', {
      available: false,
      context: '',
      nodeCount: 0,
    });
    const empty = createCodeAreaExplanation('NoSuchThing', {
      available: true,
      context: '',
      nodeCount: 0,
    });

    expect(unavailable.available).toBe(false);
    expect(unavailable.summary).toBe('Reference index unavailable.');
    expect(unavailable.references).toEqual([]);
    expect(empty.available).toBe(true);
    expect(empty.summary).toBe('No code references found for "NoSuchThing".');
    expect(empty.references).toEqual([]);
  });
});
