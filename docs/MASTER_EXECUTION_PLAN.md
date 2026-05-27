# Master Execution Plan

This is the standing reference for turning Techwriter Bot into a sellable,
per-client AI writing engine deployed to each client's Cloudflare account.

Use this file before starting implementation work. It captures the product
scope, build order, graph-grounded code hotspots, verification gates, and
explicit non-goals.

## Product Context

- Solo developer.
- Stack: Svelte 5, Astro, Cloudflare Pages/Workers/KV.
- Business model: per-client deployment sold to technical writing teams.
- Deployment model: each client runs this in their own Cloudflare account.
- Infrastructure target: Cloudflare free tier, near-zero ongoing infra cost.
- Current boundary: no SaaS auth, billing, or multi-tenant platform.
- Privacy boundary: user chat, document, generated-response, search-result,
  and rendered-artifact content is not intentionally retained in durable
  application storage.
- Product direction: evolve into a human-controlled Documentation Tooling
  Agent with bounded, user-invoked tools; do not build autonomous execution.
- Runtime boundary: support controlled documentation renderers and explicit
  tools; do not depend on arbitrary in-browser Node/package environments.
- First tooling design reference:
  `docs/superpowers/specs/2026-05-27-documentation-tooling-agent-foundation-design.md`.

## Do Not Build

Do not add these unless the product strategy changes in writing:

- OAuth
- Stripe
- Multi-tenancy
- Docusaurus plugin
- Email
- Marketing pages
- Autonomous or background agents
- Kubernetes
- Redis
- Complex admin dashboards

## Execution Rules

- Build in the order below.
- Test each phase before starting the next.
- Keep changes small, reviewable, and reversible.
- Prefer the current architecture and local patterns over new abstractions.
- Add no dependency unless the feature is painful, risky, or wasteful without it.
- Every feature must work on Cloudflare free tier.
- If a feature appears to add more than 4 hours of complexity, stop and record a simpler alternative.
- Every user-visible failure must degrade gracefully with a clear message.
- Every API response should have a request id once Phase 1 begins.
- Reliability telemetry may persist non-content metadata only: provider health,
  latency, aggregate token/cost counters, rate limits, and version markers.
- Never persist prompt text, generated answers, uploaded document content,
  artifact content, or search-result content by default.

## Graphify Reference

The current code graph was generated on 2026-05-13:

- Report: `graphify-out/GRAPH_REPORT.md`
- Graph: `graphify-out/graph.json`
- Summary: 600 nodes, 863 edges, 42 communities
- Extraction confidence: 100% EXTRACTED, 0% INFERRED, 0% AMBIGUOUS
- Built from commit: `e51be6bf`

Before broad architecture work, read `graphify-out/GRAPH_REPORT.md` first.
When the graph may be stale, run:

```powershell
graphify update .
```

Then prefer:

```powershell
graphify query "<question>" --budget 4000
graphify explain "<node>"
graphify path "<node-a>" "<node-b>"
```

Use source reads only after the graph has oriented the work.

## Current Architecture Hotspots

Graphify identified these as the main implementation pressure points:

- API hub: `src/pages/api/chat.ts`
  - `POST()` is the central node for rate limits, sanitization, active-request document context, search, prompt building, routing, provider calls, and diagnostics.
- Provider routing: `src/lib/zen-router.ts`
  - `routeChat()`, `callProvider()`, circuit state, failover, provider metadata.
- Search and credits: `src/lib/search.ts`
  - `searchRouter()`, enhanced search budget, provider search fallback.
- Prompt and path logic:
  - `src/lib/prompts.ts`
  - `src/lib/path-router.ts`
  - `src/lib/relevance.ts`
- Legacy query cache:
  - `src/lib/query-cache.ts` must remain disabled for durable response content
    while privacy-first behavior is active.
- RAG:
  - `src/lib/rag-client.ts`
  - `src/lib/rag-db.ts`
  - `src/lib/embed-pipeline.ts`
  - `src/lib/sim-search.ts`
  - `src/pages/api/rag-store.ts`
- Artifacts:
  - `src/lib/stream-parser.ts`
  - `src/lib/artifact-detector.ts`
  - `src/lib/artifact-lifecycle.ts`
  - `src/lib/artifact-queue.ts`
  - `src/components/ChatIsland.svelte`
  - `src/components/ArtifactSplitView.svelte`
  - `src/components/ArtifactPanel.svelte`
  - `src/components/ArtifactOverlay.svelte`

## Phase 1: Deploy And Harden

Goal: make the app sellable and safe to deploy.

### 1. Bulletproof Deployment

Deliver:

- `deploy.sh` that:
  - Creates the KV namespace if missing.
  - Validates all configured AI/search provider API keys with live pings.
  - Injects `PROJECT_NAME` as the KV prefix.
  - Outputs the live deployed URL.
- `.env.template` documenting every key with "get it here" links.
- `APP_VERSION` stored in KV.
- Boot-time schema mismatch detection.
- Migration path for legacy deployments: remove retained content records and
  preserve only required non-content operational configuration.

Likely files:

- `deploy.sh`
- `.env.template`
- `src/pages/api/chat.ts`
- `src/lib/env-reader.ts`
- New small KV/version helper if needed.

Verification:

- Missing env keys produce actionable errors.
- Invalid provider keys fail deploy validation.
- KV namespace creation is idempotent.
- Version mismatch shows the privacy-safe legacy cleanup/migration path.

### 2. Zero-Downtime AI Pipeline

Deliver:

- `/api/health` endpoint testing configured providers with a 1-token ping and
  returning only sanitized public availability fields.
- Circuit breaker failover log with timestamp and provider name.
- UI footer showing recent failover events.
- Last-resort mode: if all providers fail, provide a retryable unavailable
  response; the open browser session may show its own prior in-memory response
  with a "Live AI unavailable" banner, but no durable answer cache is permitted.
- Query routing that records cost and latency per provider and prefers cheapest/fastest per query class.

Likely files:

- `src/pages/api/health.ts`
- `src/lib/zen-router.ts`
- `src/lib/providers.ts`
- `src/components/ChatMessages.svelte`
- `src/components/ChatIsland.svelte`

Verification:

- Mock one provider failure and confirm failover.
- Mock all providers down and confirm retryable outage behavior plus any
  session-memory-only UI continuity.
- Confirm health response lists provider status without configuration
  inventories, raw provider errors, or secret values.

### 3. Safety And Sanity

Deliver:

- Input sanitization:
  - Strip HTML except markdown-safe content.
  - Max 4000 characters per chat input.
  - Max 5 MB upload.
- Rate limits:
  - 30 requests per minute per IP.
  - 500 requests per day per IP.
  - Env configurable.
- CSP headers.
- Sandboxed iframes for HTML and React artifacts.
- Standard error shape:

```json
{ "error": "Human readable message", "code": "MACHINE_CODE", "retryable": true }
```

- `x-request-id` header on every response.

Likely files:

- `src/pages/api/chat.ts`
- Astro/Cloudflare headers config
- Artifact iframe renderers
- Shared error helper

Verification:

- Oversized text is rejected.
- Oversized uploads are rejected.
- Rate limit behavior matches env config.
- All API responses include `x-request-id`.
- CSP does not break artifact rendering.

## Phase 2: Core Engine

Goal: make the system worth paying for.

### 4. Artifacts That Never Break

Deliver:

- Error boundary per artifact type.
- Kroki failure path:
  - Try Kroki.
  - Fall back to client-side rendering.
  - Show inline error message with Regenerate button.
- Active-session artifact reuse only; server-rendered user artifacts are served
  with `Cache-Control: no-store, private`.
- Regenerate replaces the active-session rendering without durable cache writes.
- Artifact gallery sidebar:
  - All diagrams in session.
  - Click to jump.
  - Regenerate.
  - Copy source.
- Export diagram as zip:
  - SVG.
  - PNG.
  - Source code.

Likely files:

- `src/lib/artifact-*`
- `src/components/ArtifactSplitView.svelte`
- `src/components/ArtifactPanel.svelte`
- `src/components/ArtifactOverlay.svelte`

Complexity flag:

- ZIP export may exceed 4 hours without a dependency. Simpler alternative: ship separate SVG, PNG, and source downloads first.

Verification:

- Kroki down still shows useful artifact output or a clear inline failure.
- Regenerate replaces the active-session rendering.
- Gallery actions work for multiple artifacts.

### 5. Streaming That Feels Native

Deliver parser state machine:

- `IDLE`
- `TAG_OPEN`
- `TYPE`
- `CONTENT`
- `CLOSE`

Handle:

- Malformed tags.
- Nested artifacts.
- UTF-8 split across chunk boundaries.
- 50 ms debounce on artifact DOM updates.
- 30 second stream timeout with "Provider slow, switching..." message.

Likely files:

- `src/lib/stream-parser.ts`
- `src/components/ChatIsland.svelte`
- `src/tests/artifacts.test.ts`

Verification:

- Unit tests for malformed tags, nested artifacts, and split UTF-8 chunks.
- Timeout path switches provider or exits with a retryable error.

### 6. RAG With Teeth

Deliver:

- Multi-document upload.
- Upload progress bar.
- 5 MB file size warning.
- Chunk metadata:
  - Filename.
  - Heading hierarchy.
  - Line numbers.
- Citation format: `[Doc: api.md, line 45]`
- Similarity guard:
  - If top 3 chunks are below 0.3 cosine similarity, answer "I don't have enough context."
- Knowledge Base sidebar:
  - Uploaded docs.
  - Chunk count.
  - Delete doc.
  - Re-embed button.

Likely files:

- `src/lib/rag-client.ts`
- `src/lib/rag-db.ts`
- `src/lib/embed-pipeline.ts`
- `src/lib/sim-search.ts`
- `src/pages/api/rag-store.ts`
- `src/components/ChatIsland.svelte`

Verification:

- Multi-doc upload preserves filename metadata.
- Low-similarity query refuses to hallucinate.
- Citations include filename and line.
- Delete and re-embed update sidebar state.

### 7. Brand Voice Per Client

Deliver:

- `SYSTEM_PROMPT` env var injected into every chat request.
- Multi-line, markdown-friendly prompt handling.
- `PERSONA_NAME` in UI header.
- Empty chat shows 3 suggested prompts derived from `SYSTEM_PROMPT`.

Likely files:

- `src/lib/prompts.ts`
- `src/pages/api/chat.ts`
- `src/components/ChatIsland.svelte`

Verification:

- Prompt injection is present in chat requests.
- UI says client persona name, not generic chatbot naming.
- Suggested prompts change with system prompt content.

## Phase 3: Workflow And Trust

Goal: make customers keep using it.

### 8. Conversation Management

Deliver:

- New Conversation button.
- Fresh context per conversation.
- Sidebar history list.
- Auto-title from first user message using a 3-word AI summary.
- Rename conversation.
- Delete conversation.
- Archive conversation.
- User-initiated session export/import JSON file backup with messages,
  artifacts, and docs metadata; no automatic KV content retention.

Likely files:

- `src/components/ChatIsland.svelte`
- `src/lib/session-persist.ts`
- New active-session conversation helper if needed.

Verification:

- New conversation does not leak prior context.
- Explicit file export/import round-trips messages, artifacts, and doc metadata.
- Delete/archive do not remove unrelated sessions.

### 9. Export That Meets Them Where They Work

Deliver:

- Full chat to Markdown with timestamps and inline citations.
- Single response to clean Markdown.
- Copy as Slack message.
- Webhook export:
  - Retry 3 times.
  - Backoff: 1s, 5s, 15s.
- Manual retry button while content remains in the open session.
- Optional durable delivery metadata must not contain exported content.

Likely files:

- Chat UI components.
- New export helpers.
- Non-content delivery telemetry helper if needed.

Verification:

- Markdown exports are readable and citation-preserving.
- Slack copy has compact team-channel formatting.
- Webhook failure is visible and can be manually retried without storing payload content.

### 10. Client Transparency

Deliver:

- Footer on every response:
  - Active provider count.
  - Token count.
  - Latency.
  - Provider used.
- `/api/stats` endpoint protected by env password.
- Stats:
  - Requests in the last 24 hours.
  - Average latency.
  - Tokens used.
  - Top provider.
- Search credit dashboard:
  - Enhanced search usage.
  - Approximate cost per query.
  - 80% warning banner.

Likely files:

- `src/lib/zen-router.ts`
- `src/lib/search.ts`
- `src/pages/api/stats.ts`
- Chat footer UI.

Verification:

- Stats endpoint rejects missing/wrong password.
- Footer metadata matches response metadata.
- Warning appears at 80% enhanced search usage.

## Phase 4: Polish And Degrade

Goal: make the app feel professional under both success and failure.

### 11. White-Label Without Code

Deliver env vars:

- `APP_TITLE`
- `APP_LOGO_URL`
- `PRIMARY_COLOR`
- `FOOTER_TEXT`

Principle:

- It should feel like client internal tooling, not a third-party app.

Verification:

- Branding changes by env only.
- Missing logo/color falls back cleanly.

### 12. Onboarding Wow

Deliver:

- Try Sample Data button.
- Dummy OpenAPI spec.
- Two sample docs.
- Instant demo setup.
- Three context-aware suggested prompts.

Verification:

- A fresh deployment can demonstrate value without client data.
- Sample data can be cleared.

### 13. Mobile Artifacts

Deliver:

- Swipe down to dismiss artifact overlay.
- Pinch zoom on diagrams.
- Body scroll lock while overlay is open.

Verification:

- Mobile overlay does not trap the user.
- Page behind overlay does not scroll.
- Diagram zoom remains usable.

### 14. Graceful Degradation

Deliver:

| Failure | Behavior |
| --- | --- |
| KV full | Shed non-content telemetry writes and notify operator. |
| Embedding service down | Skip RAG, use search-only mode, show banner. |
| All search APIs fail | Continue without live results and show warning. |
| Kroki down | Use available client renderer or show inline regeneration guidance. |
| Page refresh/navigation | Clearly treat active-session content as ended. |

Verification:

- Each failure mode has a test or manual reproduction note.
- Each fallback is visible to the user.
- No failure mode produces a blank screen.

## Recommended Implementation Strategy

1. Start with shared safety primitives:
   - Request id helper.
   - Standard error helper.
   - KV prefix helper for non-content operational state.
   - Env parsing helper.
   - Provider ping helper.
2. Harden `src/pages/api/chat.ts` before broad UI work.
3. Extend `src/lib/zen-router.ts` for provider telemetry and failover.
4. Wire metadata into the UI footer.
5. Stabilize stream/artifact behavior with tests before adding artifact UI features.
6. Add RAG metadata and guards before conversation management.
7. Add workflow/export features only after the core chat loop is reliable and
   without restoring durable application content retention.
8. Finish with white-label polish and explicit degradation states.

## Testing Gates

Before closing Phase 1:

- Build passes.
- API contract tests pass.
- Missing env, bad input, rate limit, and provider health paths are verified.
- KV version mismatch and legacy-content cleanup guidance are verified.

Before closing Phase 2:

- Artifact parser tests cover malformed, nested, and split chunk cases.
- Provider failure/fallback behavior is verified.
- RAG similarity guard is verified.
- Artifact render fallback is verified.

Before closing Phase 3:

- Conversation export/import round-trips.
- Stats auth is verified.
- Webhook failure and manual retry are verified without durable payload storage.

Before closing Phase 4:

- Branding works from env only.
- Mobile artifact overlay is manually tested.
- Each graceful degradation row is verified.

## Done Means

A deliverable is done only when:

- It works locally.
- It works within Cloudflare free-tier constraints.
- It has focused test coverage or a written manual verification note.
- It avoids the explicit "Do Not Build" list.
- It degrades gracefully when upstream services fail.
- It preserves the privacy-first content retention boundary.
- It is reflected in this plan if the strategy changes.
