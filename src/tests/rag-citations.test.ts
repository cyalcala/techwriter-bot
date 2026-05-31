import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDocumentChunks, createRagRetrievalMessage, formatRagContext } from '../lib/rag-client';
import { searchInWorker } from '../lib/sim-search';
import type { ChunkVector } from '../lib/rag-db';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('RAG citations and retrieval guard', () => {
  it('adds filename, line, and heading metadata to uploaded document chunks', () => {
    const chunks = createDocumentChunks('# API\n\nIntro paragraph.\n\n## Auth\nUse bearer tokens.', 'api.md', 80, 20, 5);

    expect(chunks[0]).toMatchObject({
      filename: 'api.md',
      startLine: 1,
      endLine: 6,
      heading: 'API',
    });
    expect(chunks[0].text).toContain('Use bearer tokens.');
  });

  it('formats retrieved document context with source citations instead of generic points', () => {
    const context = formatRagContext([
      {
        text: 'Use bearer tokens for API requests. Rotate keys every quarter.',
        score: 0.91,
        filename: 'api.md',
        startLine: 45,
        endLine: 46,
        heading: 'Authentication',
      },
    ]);

    expect(context).toContain('[Doc: api.md, line 45]');
    expect(context).toContain('Authentication');
    expect(context).toContain('Use bearer tokens for API requests');
    expect(context).not.toContain('[Point 1]');
  });

  it('preserves chunk metadata through similarity fallback search', async () => {
    const vectors: ChunkVector[] = [
      {
        id: 'chunk-1',
        sessionId: 'session-1',
        text: 'Relevant API auth details',
        vector: [1, 0],
        timestamp: 1,
        filename: 'api.md',
        startLine: 12,
        endLine: 14,
        heading: 'Auth',
      },
    ];

    const result = await searchInWorker(vectors, [1, 0], 3, 0.3);

    expect(result[0]).toMatchObject({
      filename: 'api.md',
      startLine: 12,
      endLine: 14,
      heading: 'Auth',
    });
  });

  it('provides deterministic retrieval failure messages', () => {
    expect(createRagRetrievalMessage({ embedFailed: false })).toBe(
      "I don't have enough context in the uploaded document to answer that.",
    );
    expect(createRagRetrievalMessage({ embedFailed: true })).toContain('Document retrieval is temporarily unavailable');
  });

  it('wires document retrieval guards into the chat path', () => {
    const island = source('src/components/ChatIsland.svelte');

    expect(island).toContain('createRagRetrievalMessage({ embedFailed })');
    expect(island).toContain('Cite every document-backed claim with [Doc: filename, line n]');
  });
});
