# Gauntlet Audit Baseline — 2026-08-23

## Orientation

| Item | Value |
|---|---|
| Repository | `cyalcala/techwriter-bot` cloned to `C:\Users\admin\Desktop\technical-writer` |
| Base SHA | `04338792ea937b475d6f33217f8f4fdb0b759657` (main, synced with origin/main) |
| Local state | Clean working tree at clone; no pre-existing dirty files |
| Stray host artifact | Unrelated git repo initialized at `C:\` root (remote `skills-hub`, zero commits). Untouched; out of scope. |

## Baseline verification (all passing at base SHA)

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npm.cmd test` | 51 files, 338/338 pass, 17.4s |
| Build | `npm.cmd run build` (`CLOUDFLARE_REMOTE_BINDINGS=false`) | Complete; known non-failing vite chunk warnings for `deck-schema.ts` / `doc-schema.ts` |
| Production | `https://tw-bot.pages.dev` (GitHub Actions deploys from main) | Last accepted run per docs: healthy, 4/6 providers |

## Architecture reality (verified from code, not docs)

```text
Browser (Svelte 5 islands: ChatIsland → messages/input/artifact views)
  │ SSE + JSON
Cloudflare Pages Functions (Astro 6, src/pages/api/*)
  ├── chat.ts        path classification → search/graph/RAG context → zen-router
  │                  (6-provider circuit breaker, SSE streaming)
  ├── render-artifact.ts  Kroki proxy (12 artifact types, sanitization, retries)
  ├── embed.ts       Workers AI bge-small-en-v1.5 embeddings (batched client-side)
  ├── tool-graph-lookup.ts  bounded read-only code-graph lookup
  ├── health/version/stats/webhook-export/youtube-transcript/summarize
  │
  ├── KV (SESSION binding): prefixed operational state only — privacy-first:
  │    NO durable chat/document/artifact content (approved product decision)
  │
  └── graphify CI (Python, scripts/graphify-ci.sh):
       tree-sitter AST → graph.json → gzip → KV "graph:latest"
       consumed at runtime by src/lib/graph-query.ts
```

Key subsystems and their state:

| Subsystem | Entry points | State |
|---|---|---|
| Provider routing | `src/lib/zen-router.ts`, `providers.ts`, `provider-health.ts` | Mature; circuit breaker, telemetry, fault-injection harness, tests |
| Artifacts/diagrams | `stream-parser.ts`, `kroki-renderer.ts`, `artifact-*.ts`, `renderer-loader.ts` | Mature; parser hardening, repair, mobile fixes, 12 types |
| RAG | `rag-client.ts` (chunker), `rag-db.ts`, `embed-pipeline.ts`, `sim-search.ts` | Functional; citations + registry + re-embed. **No retrieval-quality measurement** |
| Search | `search.ts`, `search-enhanced.ts`, `search-reddit.ts` | 3-tier, graceful degradation tested |
| Code graph | `graph-query.ts` + `scripts/graphify-ci.sh` + `graphify-out/` | Working; Python already in CI (unpinned pip dep) |
| Document tools | `document-review.ts`, `code-area-explanation.ts`, `tool-graph-lookup.ts` | Bounded, user-invoked, production-accepted (Phase 5B) |
| Exports | `chat-markdown-export.ts`, `deck-*`, `doc-*`, `webhook-export.ts` | Present; tests |
| Security | `csrf.ts`, `security-headers.ts`, `rate-limiter.ts`, `reputation.ts`, `turnstile.ts`, `middleware.ts` | Layered; privacy-first audit history |

## Approved product constraints (from docs, honored by this gauntlet)

1. Privacy-first: no durable user-content retention.
2. Bounded, user-invoked tools only; no autonomous execution.
3. Per-client Cloudflare deployment, free-tier target.
4. Relay discipline: docs checkpoints + GitHub as durable memory.
