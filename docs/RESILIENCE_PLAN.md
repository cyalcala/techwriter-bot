# Resilience & Reliability Enhancement Plan

## Threat Model

A well-meaning user exhibits these patterns:
1. Sends multiple messages rapidly before AI responds
2. Aborts mid-stream, edits message, resends
3. Switches topic abruptly (OAuth2 → BPO workflow → modern dating)
4. Opens/closes artifacts rapidly while stream is active
5. Refreshes page mid-conversation
6. Hits rate limits on free provider tiers
7. Uses on flaky mobile connection (offline → online transitions)
8. Long conversations (20+ turns) with token bloat
9. Rapid artifact requests triggering concurrent Kroki calls
10. Clicks "New Chat" while a response is streaming

---

## Current Weaknesses — Audit

| # | Weakness | Impact | Severity |
|---|----------|--------|----------|
| 1 | **No abort-cleanup on rapid sends** | If user sends 3 messages before 1st response completes, stale streams accumulate. AbortController exists but no cleanup of in-progress resolveArtifact promises or pending UI state | High |
| 2 | **No session persistence on refresh** | Full page reload loses all messages, artifacts, KV session data. User must start over. localStorage saves sessionId but not conversation | High |
| 3 | **No reconnection for broken SSE** | If connection drops mid-stream, client silently stops receiving. 30s idle timer cancels, but no retry or partial-state recovery | High |
| 4 | **Concurrent artifact resolution** | Multiple Kroki calls fire simultaneously. If 5 diagrams in one message, 5 parallel POST /api/render-artifact calls. No queue/backoff | Medium |
| 5 | **No conversation length governor** | Summarization triggers at 4000 tokens but only for oldest messages. If user keeps adding, edge model context windows may overflow | Medium |
| 6 | **Provider exhaustion cascade** | If Groq rate-limits after 30 req/min, fast-path users hit Cerebras → Gemini → cloudflare. Each fails sequentially with 12s timeout. User waits up to 48s before seeing error | Medium |
| 7 | **New Chat during active stream** | `clearAllData()` runs but the stream from the previous request still has an active reader. AbortController may not cancel properly if called after state reset | Medium |
| 8 | **No mobile offline graceful degradation** | Online/offline transition shows banner but doesn't queue messages or retry failed sends | Low |
| 9 | **Artifact chip state after rapid close/reopen** | Opening, closing, re-opening artifacts rapidly can leave stale splitArtifact references in state | Low |
| 10 | **No retry for failed SSE chunk parse** | If a malformed JSON chunk arrives in SSE, it's silently dropped. Content is lost permanently | Low |

---

## Enhancement Plan

### 1. Guaranteed Abort Cleanup (30 min)

**Files**: `ChatIsland.svelte`

Every `doSend()` starts with a complete state reset:
```javascript
async function doSend() {
  // Force cancellation of any in-flight request
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  
  // Clear any pending artifact resolution
  pendingResolutions.clear(); // new: track pending resolveArtifact promises
  
  // Reset streaming state
  isStreaming = false;
  isLoading = false;
  
  // Proceed with new request...
}
```

Add a `pendingResolutions: Set<Promise<void>>` that tracks in-flight `resolveArtifact()` calls. On abort, iterate and clear.

### 2. Session Persistence (1.5 hours)

**Files**: `ChatIsland.svelte`, new `src/lib/session-persist.ts`

Save conversation to localStorage on each message change:
```typescript
// New module: session-persist.ts
export function saveConversation(messages: Message[]): void {
  try { localStorage.setItem('tw_conv', JSON.stringify(messages.slice(-50))); } catch {}
}
export function loadConversation(): Message[] {
  try { const raw = localStorage.getItem('tw_conv'); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
```

On mount, check for saved conversation. If found and sessionId matches, restore. Show "Session restored" badge. Auto-save on every message add + every 5 seconds during streaming.

### 3. SSE Connection Resilience (1 hour)

**Files**: `ChatIsland.svelte`

Add retry with exponential backoff for broken SSE connections:
```javascript
let sseRetries = 0;
const MAX_SSE_RETRIES = 2;

// On reader error/cancel that isn't user-initiated:
if (!abortController?.signal.aborted && sseRetries < MAX_SSE_RETRIES) {
  sseRetries++;
  await new Promise(r => setTimeout(r, 1000 * sseRetries));
  // Re-send the last user message to get a fresh response
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  if (lastUserMsg) await doSend();
}
```

Also add partial-content persistence: every 500ms during streaming, checkpoint the current content so a mid-stream crash doesn't lose everything.

### 4. Kroki Request Queue (30 min)

**Files**: `ChatIsland.svelte` (resolveArtifact)

Cap concurrent Kroki calls at 2. Queue the rest:
```typescript
let krokiQueue: Array<() => Promise<void>> = [];
let activeKrokiCalls = 0;
const MAX_CONCURRENT_KROKI = 2;

async function enqueueKroki(fn: () => Promise<void>) {
  if (activeKrokiCalls >= MAX_CONCURRENT_KROKI) {
    krokiQueue.push(fn);
    return;
  }
  activeKrokiCalls++;
  try { await fn(); } finally {
    activeKrokiCalls--;
    const next = krokiQueue.shift();
    if (next) enqueueKroki(next);
  }
}
```

### 5. Aggressive Token Governor (30 min)

**Files**: `ChatIsland.svelte`, `token-counter.ts`

Add a hard cap at 3000 tokens (not 4000) for conversation summarization trigger. At 5000 tokens, force a "Start new chat" prompt:
```javascript
if (totalEst > 5000) {
  messages = [...messages, { role: 'assistant', content: 'This conversation is getting long. Consider starting a new chat for optimal performance.' }];
  // Trim to last 8 messages + summary
}
```

### 6. Provider Health Pre-Flight (30 min)

**Files**: `chat.ts`

Before routing to fast path, do a lightweight health check on Groq:
```javascript
// At startup, not per-request: ping Groq with a 1-token request every 5 minutes
// If Groq is rate-limited, temporarily demote to balanced path for ALL fast-path requests
// Restore after 60s
```

Actually, simpler: add a `x-provider-status` header to 503 responses so the client can display "Groq is currently rate-limited. Using backup provider." instead of generic error.

### 7. New Chat Guard (15 min)

**Files**: `ChatIsland.svelte`

```javascript
function newChat() {
  if (isStreaming || isLoading) {
    abortController?.abort();
    isLoading = false;
    isStreaming = false;
  }
  // ... rest of newChat logic
}
```

### 8. Mobile Offline Queue (Optional, 1 hour)

**Files**: `ChatIsland.svelte`

Queue failed sends when offline:
```javascript
let offlineQueue: Array<{content: string, timestamp: number}> = [];

// On send failure (network error):
if (!navigator.onLine) {
  offlineQueue.push({ content: inputMessage, timestamp: Date.now() });
  messages = [...messages, { role: 'assistant', content: 'Message queued. Will send when connection returns.' }];
}

// On online event:
window.addEventListener('online', async () => {
  while (offlineQueue.length > 0) {
    const msg = offlineQueue.shift()!;
    inputMessage = msg.content;
    await sendMessage();
  }
});
```

Deferred — lower priority since mobile use is typically connected.

### 9. Artifact State Guard (15 min)

**Files**: `ChatIsland.svelte`

Wrap all `artState.splitArtifact` mutations in a guard:
```javascript
function safeSetSplit(split: SplitArtifact | null) {
  if (split === null) {
    artState.splitArtifact = null;
    return;
  }
  // Verify artifact still exists in artState.artifacts
  const exists = split.artifacts.every(a => 
    artState.artifacts.some(existing => existing.artifact.id === a.artifact.id)
  );
  if (exists) artState.splitArtifact = split;
}
```

### 10. SSE Parse Resilience (10 min)

**Files**: `ChatIsland.svelte`

```javascript
// Current: silently drops malformed JSON
// New: log + skip + continue
try {
  const json = JSON.parse(rawData);
  // ... process
} catch (e) {
  if (rawData && !rawData.includes('{')) {
    artifactParser.feed(rawData); // Plain text fallback
  } else {
    console.warn('[SSE] Dropped malformed chunk:', rawData.slice(0, 100));
    // Continue — don't break the stream
  }
}
```

---

## Priority Sequence

| # | Enhancement | Effort | Impact | Dependencies |
|---|------------|--------|--------|-------------|
| **1** | Abort cleanup | 30 min | Prevents stale-state bugs | None |
| **3** | SSE retry | 1 hour | Recovers from connection drops | #1 |
| **2** | Session persistence | 1.5 hours | Survives page refresh | None |
| **7** | New Chat guard | 15 min | Prevents abort-after-reset bugs | #1 |
| **4** | Kroki queue | 30 min | Prevents 5-simultaneous API calls | None |
| **5** | Token governor | 30 min | Prevents context overflow | None |
| **10** | SSE parse resilience | 10 min | Recovers partial data from malformed chunks | None |
| **9** | Artifact state guard | 15 min | Prevents stale splitArtifact references | None |
| **6** | Provider pre-flight | 30 min | Better error messaging | None |
| **8** | Offline queue | 1 hour | Mobile resilience | Deferred |

**Total: ~5.5 hours for all priority items. ~2 hours for the top 3.**

---

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Rapid-send abort success | ~70% (stale streams linger) | 100% (guaranteed cleanup) |
| Page refresh data loss | 100% (all messages lost) | 0% (conversation restored) |
| SSE drop recovery | None (stream lost) | Auto-retry within 2s, up to 2 attempts |
| Kroki concurrency | Unlimited (all fire at once) | Max 2 concurrent, rest queued |
| Token overflow | Silent degradation | Proactive "start new chat" prompt at 5000 tokens |
| Provider failure UX | Generic "unavailable" | Specific provider name + suggested action |
