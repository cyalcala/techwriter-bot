import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storeVectors: vi.fn(),
}));

vi.mock('../lib/embed-pipeline', () => ({
  validateDocument: () => null,
  chunkText: () => ['Document content'],
  embedChunks: async () => ({ vectors: [], skipped: 1, degraded: true }),
}));

vi.mock('../lib/rag-db', () => ({
  storeVectors: mocks.storeVectors,
  getStoredVectors: vi.fn(),
}));

vi.mock('../lib/sim-search', () => ({
  searchInWorker: vi.fn(),
}));

describe('document review upload handoff', () => {
  it('retains valid source text for local review if vector indexing fails', async () => {
    const { handleFileUpload } = await import('../lib/rag-client');
    const file = new File(['# Draft\n\nContent to review.'], 'draft.md', { type: 'text/markdown' });

    const result = await handleFileUpload(file, 'active-session', vi.fn(), vi.fn());

    expect(result.success).toBe(false);
    expect(result.sourceText).toBe('# Draft\n\nContent to review.');
    expect(mocks.storeVectors).not.toHaveBeenCalled();
  });
});
