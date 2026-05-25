# Privacy-First Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an accurate, smooth privacy notice backed by removal of durable application storage for user-submitted and generated content.

**Architecture:** Preserve active in-page chat and document retrieval in memory, while removing browser and Cloudflare KV content retention paths. Keep non-content operational controls such as provider health, usage totals, and rate/abuse state, with reputation serialization no longer retaining raw queries.

**Tech Stack:** Astro 6, Svelte 5, TypeScript, Vitest, Cloudflare Pages/Workers AI/KV, Wrangler 4.

---

## File Map

- `src/components/ChatInput.svelte`: accessible expanding footer privacy notice.
- `src/components/ChatIsland.svelte`: in-session-only chat state and removal of document/server persistence calls.
- `src/lib/session-persist.ts`, `src/lib/cleanup.ts`, `src/lib/rag-db.ts`: remove legacy browser persistence and keep document vectors in page memory.
- `src/pages/api/chat.ts`, `src/pages/api/rag-store.ts`, `src/lib/reputation.ts`: remove durable content storage from chat/RAG paths while preserving metadata controls.
- `src/lib/search.ts`, `src/lib/search-reddit.ts`, `src/lib/search-enhanced.ts`: remove content/search-term caching and query-bearing logs.
- `src/lib/kroki-renderer.ts`, `src/pages/api/render-artifact.ts`: remove rendered content caching and return `no-store`.
- `src/tests/privacy-first.test.ts`, `src/tests/critical.test.ts`: prevent privacy regressions.
- `README.md`: describe privacy-first behavior and correct storage/provider claims.

### Task 1: Enforce No Durable Content Retention

**Files:**
- Create: `src/tests/privacy-first.test.ts`
- Modify: `src/tests/critical.test.ts`
- Modify: `src/lib/session-persist.ts`
- Modify: `src/lib/cleanup.ts`
- Modify: `src/lib/rag-db.ts`
- Modify: `src/components/ChatIsland.svelte`
- Modify: `src/pages/api/chat.ts`
- Modify: `src/pages/api/rag-store.ts`
- Modify: `src/lib/reputation.ts`
- Modify: `src/lib/search.ts`
- Modify: `src/lib/search-reddit.ts`
- Modify: `src/lib/search-enhanced.ts`
- Modify: `src/lib/kroki-renderer.ts`
- Modify: `src/pages/api/render-artifact.ts`

- [ ] **Step 1: Write failing retention tests**

Create tests asserting in-memory RAG behavior and source-level storage invariants:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('privacy-first content retention', () => {
  it('keeps uploaded document chunks in memory and clears them', async () => {
    const rag = await import('../lib/rag-db');
    await rag.storeVectors('s1', [{ text: 'private content', vector: [1, 0] }]);
    expect((await rag.getStoredVectors('s1'))[0].text).toBe('private content');
    await rag.clearSessionVectors('s1');
    expect(await rag.getStoredVectors('s1')).toEqual([]);
  });

  it('does not write chat, rag, response, or artifact content to durable app storage', () => {
    expect(source('src/lib/session-persist.ts')).not.toContain('localStorage.setItem');
    expect(source('src/lib/rag-db.ts')).not.toContain('indexedDB.open');
    expect(source('src/pages/api/chat.ts')).not.toContain("from '../../lib/query-cache'");
    expect(source('src/pages/api/rag-store.ts')).not.toContain('.put(');
    expect(source('src/lib/kroki-renderer.ts')).not.toContain('.put(');
  });
});
```

Extend the existing reputation test:

```ts
state = updateReputation(state, 'dup_query', { message: 'my sensitive prompt' });
expect(serializeReputation(state)).not.toContain('my sensitive prompt');
```

- [ ] **Step 2: Run tests and observe the expected failures**

Run: `npm test -- src/tests/privacy-first.test.ts src/tests/critical.test.ts`

Expected: failures identify current `localStorage`, IndexedDB, Cloudflare KV, response cache, artifact cache, and serialized raw-query behavior.

- [ ] **Step 3: Replace durable browser content storage with active-session memory**

Implement memory-backed document vector functions in `src/lib/rag-db.ts`:

```ts
const vectorsBySession = new Map<string, ChunkVector[]>();

export async function getStoredVectors(sessionId: string): Promise<ChunkVector[]> {
  return [...(vectorsBySession.get(sessionId) || [])];
}

export async function storeVectors(sessionId: string, chunks: { text: string; vector: number[] }[]): Promise<void> {
  const existing = vectorsBySession.get(sessionId) || [];
  vectorsBySession.set(sessionId, existing.concat(chunks.map((chunk, i) => ({
    id: `${sessionId}_${Date.now()}_${i}`,
    sessionId,
    text: chunk.text,
    vector: chunk.vector,
    timestamp: Date.now(),
  }))));
}

export async function clearSessionVectors(sessionId: string): Promise<void> {
  vectorsBySession.delete(sessionId);
}
```

Make `session-persist.ts` clear only the legacy key, and make `cleanup.ts` remove legacy local keys plus the legacy IndexedDB database when the page loads/clears. Remove imports and calls for saving/restoring conversations, artifacts, session identifiers, and `/api/rag-store` from `ChatIsland.svelte`.

- [ ] **Step 4: Remove server-side durable content paths**

In `src/pages/api/chat.ts`, remove query-cache imports, query cache lookup, stale answer fallback, response-body cache collection, and KV RAG retrieval. The already-generated in-browser document context remains part of the active request:

```ts
const liveSearch = !!body.liveSearch;
const clientSessionId = body.sessionId || '';
// No server-side RAG or response cache: selected document context is already in messages.
```

Change `src/pages/api/rag-store.ts` into a disabled compatibility route:

```ts
export const POST: APIRoute = async () => apiError({
  requestId: createRequestId(),
  status: 410,
  code: 'CONTENT_RETENTION_DISABLED',
  message: 'Persistent document storage is disabled in privacy-first mode.',
});
```

In `src/lib/reputation.ts`, retain runtime duplicate detection but exclude query values when serializing:

```ts
export function serializeReputation(state: ReputationState): string {
  return JSON.stringify({ ...state, queries: [] });
}
```

Remove durable result caching and query-text logs from search modules. Remove KV reads/writes in `renderViaKroki`, and set the rendering response header to:

```ts
'Cache-Control': 'no-store, private',
```

- [ ] **Step 5: Run retention tests and full test suite**

Run: `npm test -- src/tests/privacy-first.test.ts src/tests/critical.test.ts`

Expected: all targeted tests pass.

Run: `npm test`

Expected: full suite passes, updating obsolete cache-retention tests to assert the new no-retention contract if they fail for the deliberately removed behavior.

### Task 2: Add Smooth Accessible Privacy Notice

**Files:**
- Modify: `src/components/ChatInput.svelte`
- Modify: `src/tests/privacy-first.test.ts`

- [ ] **Step 1: Add failing UI-source assertions**

Append to `privacy-first.test.ts`:

```ts
it('offers an expandable accessible privacy notice with accurate wording', () => {
  const input = source('src/components/ChatInput.svelte');
  expect(input).toContain('aria-expanded={privacyOpen}');
  expect(input).toContain('id="privacy-notice"');
  expect(input).toContain('Private by default');
  expect(input).toContain('durable application storage');
  expect(input).toContain('no online service can promise absolute security');
});
```

- [ ] **Step 2: Run the UI test and observe failure**

Run: `npm test -- src/tests/privacy-first.test.ts`

Expected: failure because `privacyOpen` and the notice markup do not exist.

- [ ] **Step 3: Implement inline disclosure**

In `ChatInput.svelte`, add local state and Escape closing:

```svelte
let privacyOpen = $state(false);

function closePrivacyOnEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') privacyOpen = false;
}

<svelte:window onkeydown={closePrivacyOnEscape} />
```

Add a disclosure panel before the footer metadata and a footer button:

```svelte
<div id="privacy-notice" aria-hidden={!privacyOpen}
  class="grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out motion-reduce:duration-0 {privacyOpen ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'}">
  <div class="overflow-hidden">
    <section class="rounded-xl border border-stone-200 bg-white/75 px-3.5 py-3 text-[11px] leading-relaxed text-stone-600" aria-label="Privacy Notice">
      <div class="flex justify-between gap-3">
        <strong class="text-stone-700">Privacy Notice</strong>
        <button type="button" onclick={() => privacyOpen = false} aria-label="Close privacy notice">Close</button>
      </div>
      <p class="mt-1.5">Private by default: this site does not intentionally retain your chat messages, uploaded document content, generated responses, or rendered artifact content in durable application storage. Your active chat remains in memory while this page is open.</p>
      <p class="mt-1.5">Content is processed only to provide requested features and may be handled by Cloudflare, AI providers, search providers, or a diagram renderer under their own terms. Limited non-content technical data may be retained temporarily for security and reliability. We use encrypted HTTPS transit, but no online service can promise absolute security.</p>
    </section>
  </div>
</div>
<button type="button" aria-expanded={privacyOpen} aria-controls="privacy-notice" onclick={() => privacyOpen = !privacyOpen}>Privacy</button>
```

- [ ] **Step 4: Verify the UI test**

Run: `npm test -- src/tests/privacy-first.test.ts`

Expected: targeted privacy tests pass.

### Task 3: Documentation, Legacy Cleanup, Build And Deployment

**Files:**
- Modify: `README.md`
- Verify: `wrangler.json`, Cloudflare Pages deployment

- [ ] **Step 1: Update public documentation**

Replace obsolete content-persistence claims with this product description:

```md
### Privacy-First Processing

- Chats and generated responses remain available only while the page is open and are not intentionally written to durable application storage.
- Uploaded document context is held in active browser memory for the current page session and is not written to Cloudflare KV.
- Limited operational metadata may be retained temporarily for security, rate limiting, provider reliability, and aggregate usage reporting; it does not include message content.
- Requested features may transmit necessary content to Cloudflare Workers AI, selected AI/search providers, or Kroki under their own terms.
```

- [ ] **Step 2: Audit durable content writes**

Run:

```powershell
rg -n "localStorage\.setItem|indexedDB\.open|rag:\$\{|qcache:|kroki:|searchCache\.set|query:\s*query" src -g "!tests"
```

Expected: no remaining durable storage of chat, uploaded content, generated answers, artifact output, or stored raw queries; any output is reviewed as non-content metadata or removed.

- [ ] **Step 3: Verify and build**

Run:

```powershell
npm test
npm run build
npx wrangler --version
```

Expected: tests and build exit with code `0`, Wrangler reports version `4.x`.

- [ ] **Step 4: Browser-check the interaction**

Launch the local built/development site, open it through the in-app browser, click `Privacy`, confirm the notice is legible and toggles smoothly at desktop and mobile viewport widths, confirm Escape closes it, and inspect browser storage to ensure no chat/document content keys appear after interaction.

- [ ] **Step 5: Remove feasible legacy KV content**

List existing production KV keys using the namespace configured in `wrangler.json`, then delete only known content prefixes from this application:

```powershell
$namespace = 'ad577f3ebe2c4cd3bb1542f1e6caf081'
$keys = npx wrangler kv key list --namespace-id $namespace --remote | ConvertFrom-Json
$contentKeys = $keys | Where-Object {
  $_.name -match '(^|:)(rag:|qcache:|reputation:|search:(?!enhanced:))'
}
$contentKeys | ForEach-Object {
  npx wrangler kv key delete $_.name --namespace-id $namespace --remote
}
```

Delete confirmed keys matching legacy RAG, query-response cache, search-result cache, or query-bearing reputation records. Do not delete app version, aggregate usage, enhanced-search budget, or circuit/provider health keys.

- [ ] **Step 6: Deploy and verify live**

Run the existing Cloudflare Pages deployment flow:

```powershell
npm run build
node .\deploy-final.js
```

Expected: Wrangler reports a successful Pages deployment URL for project `tw-bot`. Open the deployed URL through the in-app browser and repeat the privacy toggle and storage checks.
