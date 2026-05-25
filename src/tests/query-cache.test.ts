import { describe, expect, it } from 'vitest';

class MemoryKV {
  writes: Array<{ key: string; value: string; options?: { expirationTtl?: number } }> = [];
  reads: string[] = [];
  store = new Map<string, string>();

  async get(key: string, type?: string) {
    this.reads.push(key);
    const raw = this.store.get(key) ?? null;
    if (type === 'json' && raw) return JSON.parse(raw);
    return raw;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    this.store.set(key, value);
    this.writes.push({ key, value, options });
  }
}

describe('privacy-first query handling', () => {
  it('does not read or write persisted response content', async () => {
    const { checkCache, checkStaleCache, writeCache } = await import('../lib/query-cache');
    const kv = new MemoryKV();

    await writeCache(kv, 'How do I write API docs?', 'Use a task-first structure.', 'groq-fast', 'none', 'fast', { PROJECT_NAME: 'Acme' });
    await expect(checkCache(kv, 'How do I write API docs?', { PROJECT_NAME: 'Acme' })).resolves.toEqual({ hit: false });
    await expect(checkStaleCache(kv, 'How do I write API docs?', { PROJECT_NAME: 'Acme' })).resolves.toEqual({ hit: false });
    expect(kv.writes).toEqual([]);
    expect(kv.reads).toEqual([]);
  });

  it('collects streamed provider text for cache writes', async () => {
    const { collectSSETextForCache } = await import('../lib/query-cache');
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    await expect(collectSSETextForCache(stream)).resolves.toBe('Hello world');
  });

  it('builds a last-resort SSE payload with a visible unavailable banner', async () => {
    const { cachedResponseToSSE } = await import('../lib/query-cache');

    const payload = cachedResponseToSSE({
      text: 'Cached answer.',
      provider: 'groq-fast',
      searchTier: 'none',
      path: 'fast',
      cached: true,
      stale: true,
      ts: Date.now(),
    }, { liveUnavailable: true });

    expect(payload).toContain('Live AI unavailable');
    expect(payload).toContain('Cached answer.');
    expect(payload).toContain('data: [DONE]');
  });
});
