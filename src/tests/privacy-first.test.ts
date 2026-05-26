import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('privacy-first content retention', () => {
  it('keeps uploaded document chunks in memory and clears them', async () => {
    const rag = await import('../lib/rag-db');

    await rag.storeVectors('session-private', [{ text: 'private content', vector: [1, 0] }]);
    expect((await rag.getStoredVectors('session-private'))[0]?.text).toBe('private content');

    await rag.clearSessionVectors('session-private');
    expect(await rag.getStoredVectors('session-private')).toEqual([]);
  });

  it('does not write user content into durable application storage', () => {
    expect(source('src/lib/session-persist.ts')).not.toContain('localStorage.setItem');
    expect(source('src/lib/cleanup.ts')).toContain("localStorage.removeItem('tw_conv')");
    expect(source('src/lib/rag-db.ts')).not.toContain('indexedDB.open');
    expect(source('src/pages/api/chat.ts')).not.toContain("from '../../lib/query-cache'");
    expect(source('src/pages/api/chat.ts')).not.toContain('searchRagKV');
    expect(source('src/pages/api/chat.ts')).not.toContain('idempotencyKey');
    expect(source('src/pages/api/chat.ts')).not.toContain('cached.body');
    expect(source('src/components/ChatIsland.svelte')).not.toContain('idempotencyKey');
    expect(source('src/pages/api/rag-store.ts')).not.toContain('.put(');
    expect(source('src/lib/query-cache.ts')).not.toContain('.put(');
    expect(source('src/lib/search.ts')).not.toContain('.put(');
    expect(source('src/lib/search.ts')).not.toContain('searchCache.set');
    expect(source('src/lib/kroki-renderer.ts')).not.toContain('.put(');
    expect(source('src/pages/api/render-artifact.ts')).toContain("'Cache-Control': 'no-store, private'");
  });

  it('does not log search terms in provider-error diagnostics', () => {
    expect(source('src/lib/search.ts')).not.toMatch(/query:\s*query/);
    expect(source('src/lib/search-reddit.ts')).not.toMatch(/query:\s*query/);
    expect(source('src/lib/search-enhanced.ts')).not.toMatch(/query:\s*query/);
  });

  it('offers an expandable accessible privacy notice with accurate wording', () => {
    const input = source('src/components/ChatInput.svelte');

    expect(input).toContain('aria-expanded={privacyOpen}');
    expect(input).toContain('id="privacy-notice"');
    expect(input).toContain("style:grid-template-rows={privacyOpen ? '1fr' : '0fr'}");
    expect(input).toContain('class="min-h-0 overflow-hidden"');
    expect(input).toContain('Private by default');
    expect(input).toContain('durable application storage');
    expect(input).toMatch(/no online service\s+can promise absolute security/);
  });

  it('offers open-session-only continuity during a live provider outage', () => {
    const island = source('src/components/ChatIsland.svelte');

    expect(island).toContain('createLiveOutageState');
    expect(island).toContain('Live AI unavailable.');
    expect(island).toContain('this open session only');
    expect(island).toContain('onclick={regenerate}');
  });
});
