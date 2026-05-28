import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { clearGraphCache, ensureGraph, queryGraphReferences } from '../lib/graph-query';
import { boundLookupResult, validateLookupTerm } from '../lib/tool-graph-lookup';

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

describe('bounded tool graph lookup', () => {
  it('accepts a bounded term and rejects blank or oversized input', () => {
    expect(validateLookupTerm('  ChatIsland  ')).toBe('ChatIsland');
    expect(validateLookupTerm('  ')).toBeNull();
    expect(validateLookupTerm('x'.repeat(201))).toBeNull();
    expect(validateLookupTerm({})).toBeNull();
  });

  it('bounds graph context and node counts for the UI response', () => {
    const result = boundLookupResult({
      available: true,
      context: 'x'.repeat(5000),
      nodeCount: 42,
      tokenCount: 1250,
      version: 'internal-build',
    });

    expect(result.available).toBe(true);
    expect(result.context).toHaveLength(4000);
    expect(result.nodeCount).toBe(20);
    expect(result).not.toHaveProperty('version');
  });

  it('returns targeted references without falling back to unrelated hubs', async () => {
    clearGraphCache();
    const compressed = toArrayBuffer(gzipSync(JSON.stringify({
      nodes: [
        { id: 'chat-island', label: 'ChatIsland', source_file: 'src/components/ChatIsland.svelte' },
        { id: 'post', label: 'POST()', source_file: 'src/pages/api/chat.ts' },
        { id: 'internal-doc', label: 'Secret Setup', source_file: 'docs/internal.md', file_type: 'document' },
      ],
      links: [{ source: 'post', target: 'chat-island' }],
    })));
    const kv = {
      get: async (key: string) => key === 'graph:version' ? 'test' : compressed,
    };

    expect((await ensureGraph(kv)).available).toBe(true);
    expect(queryGraphReferences('ChatIsland').context).toContain('src/components/ChatIsland.svelte');
    expect(queryGraphReferences('Secret Setup').context).toBe('');
    expect(queryGraphReferences('NoSuchFeature').context).toBe('');
    expect(queryGraphReferences('NoSuchFeature').nodeCount).toBe(0);
  });
});
