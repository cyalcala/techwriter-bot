import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearSessionVectors,
  deleteDocumentVectors,
  getStoredDocuments,
  getStoredVectors,
  storeVectors,
} from '../lib/rag-db';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('RAG uploaded document registry', () => {
  it('summarizes uploaded documents without exposing chunk content', async () => {
    const sessionId = 'session-registry-summary';
    await clearSessionVectors(sessionId);

    await storeVectors(sessionId, [
      {
        text: 'private auth details',
        vector: [1, 0],
        filename: 'api.md',
        documentId: 'doc-api',
        startLine: 1,
        endLine: 2,
      },
      {
        text: 'more private auth details',
        vector: [0.9, 0.1],
        filename: 'api.md',
        documentId: 'doc-api',
        startLine: 3,
        endLine: 5,
      },
      {
        text: 'private onboarding guide',
        vector: [0, 1],
        filename: 'guide.md',
        documentId: 'doc-guide',
        startLine: 1,
        endLine: 4,
      },
    ]);

    const documents = await getStoredDocuments(sessionId);

    expect(documents).toEqual([
      { id: 'doc-api', filename: 'api.md', chunkCount: 2 },
      { id: 'doc-guide', filename: 'guide.md', chunkCount: 1 },
    ]);
    expect(JSON.stringify(documents)).not.toContain('private');
  });

  it('deletes one uploaded document without clearing other session chunks', async () => {
    const sessionId = 'session-registry-delete';
    await clearSessionVectors(sessionId);

    await storeVectors(sessionId, [
      { text: 'api content', vector: [1, 0], filename: 'api.md', documentId: 'doc-api' },
      { text: 'guide content', vector: [0, 1], filename: 'guide.md', documentId: 'doc-guide' },
    ]);

    await deleteDocumentVectors(sessionId, 'doc-api');

    expect(await getStoredDocuments(sessionId)).toEqual([
      { id: 'doc-guide', filename: 'guide.md', chunkCount: 1 },
    ]);
    expect((await getStoredVectors(sessionId)).map((chunk) => chunk.filename)).toEqual(['guide.md']);
  });

  it('wires a visible Knowledge Base list and delete control into chat UI', () => {
    const input = source('src/components/ChatInput.svelte');
    const island = source('src/components/ChatIsland.svelte');

    expect(input).toContain('ragDocuments');
    expect(input).toContain('Knowledge Base');
    expect(input).toContain('chunkCount');
    expect(input).toContain('onDeleteDocument');
    expect(island).toContain('deleteDocumentVectors');
    expect(island).toContain('removeDocument');
  });

  it('keeps re-embed source text in active chat state only', () => {
    const rag = source('src/lib/rag-client.ts');
    const island = source('src/components/ChatIsland.svelte');

    const recordInterface = rag.slice(
      rag.indexOf('export interface UploadedDocumentRecord'),
      rag.indexOf('export interface UploadResult'),
    );

    expect(recordInterface).not.toContain('text');
    expect(recordInterface).not.toContain('sourceText');
    expect(island).toContain('documentSources');
    expect(island).toContain('result.sourceText');
    expect(island).not.toContain('localStorage.setItem');
  });

  it('wires user-invoked Knowledge Base re-embed controls through the upload path', () => {
    const input = source('src/components/ChatInput.svelte');
    const island = source('src/components/ChatIsland.svelte');

    expect(input).toContain('onReembedDocument');
    expect(input).toContain('Re-embed');
    expect(island).toContain('reembedDocument');
    expect(island).toContain('new File([source.text]');
    expect(island).toContain('processFileUpload(file)');
  });
});
