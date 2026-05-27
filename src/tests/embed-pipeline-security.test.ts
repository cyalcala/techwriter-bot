import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedChunks } from '../lib/embed-pipeline';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('controlled document embeddings', () => {
  it('does not retain a third-party browser embedding runtime dependency', () => {
    expect(source('package.json')).not.toContain('@xenova/transformers');
    expect(source('src/lib/embed-pipeline.ts')).not.toContain('@xenova/transformers');
    expect(source('src/lib/embed-pipeline.ts')).not.toContain('cdn.jsdelivr.net');
    expect(source('src/lib/embed-pipeline.ts')).not.toContain('embedLocal');
  });

  it('degrades visibly when the controlled embedding endpoint is unavailable', async () => {
    vi.useFakeTimers();
    const progress: string[] = [];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = embedChunks(['document content'], (state) => progress.push(state.stage));
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ vectors: [[]], skipped: 1, degraded: true });
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([url]) => url === '/api/embed')).toBe(true);
    expect(progress.at(-1)).toBe('error');
  });
});
