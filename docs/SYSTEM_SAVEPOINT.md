# TechWriter Bot — System Savepoint
## Commit: `b2ac2c0` | Branch: `main` | Deployed: `tw-bot.pages.dev`

### State Summary
- **Build**: Green | **Tests**: 12/12 | **Deploy**: Success | **Cost**: $0/month

---

## File Inventory (Source Files Only)

```
src/
├── lib/
│   ├── zen-router.ts              Circuit breakers, failover, SSE streaming, path-based timeouts
│   ├── providers.ts               6-provider AI registry (Groq, Cerebras, Gemini, NVIDIA, OpenRouter, CF Workers)
│   ├── path-router.ts             Three-path classifier (fast/balanced/heavy), artifact detection, format-choice detection
│   ├── token-counter.ts           Token estimation (chars/4), budget enforcement (2048/4096), KV logging, getTokenStats()
│   ├── graph-query.ts             KV graph load (gzip decompress), keyword + direct-label matching, god-node boost
│   ├── query-cache.ts             SHA-256 hash pre-filter, KV cache (15min TTL), cached response retrieval
│   ├── kroki-renderer.ts          Kroki API client, KV diagram cache (24h TTL), 8s timeout, type mapping
│   ├── prompts.ts                 Path-aware budget-enforced prompt builder, proactive artifact instructions
│   ├── rag-client.ts              Extracted RAG pipeline (upload, embed, search, format)
│   ├── rag-db.ts                  IndexedDB + KV dual-write vector store, cosine similarity, stale purge
│   ├── embed-pipeline.ts          Server-first (CF Workers AI) + Xenova local fallback, chunk text
│   ├── search.ts                  DDG/Wiki/Reddit/Tavily/Exa search router, KV search cache (15min TTL)
│   ├── search-enhanced.ts         Tavily + Exa APIs, budget tracking (1000/month/provider)
│   ├── search-reddit.ts           Reddit JSON API search
│   ├── relevance.ts               Regex-based query classification (greeting/conversational/inquiry/ambiguous)
│   ├── reputation.ts              Score/tier system (premium→blocked), per-IP state in KV (7200s TTL)
│   ├── rate-limiter.ts            Per-IP sliding window rate limiter
│   ├── csrf.ts                    Origin/referer CSRF validation
│   ├── turnstile.ts               Cloudflare Turnstile CAPTCHA verification
│   ├── env-reader.ts              Environment key loader (cfGlobalEnv + locals.runtime.env + import.meta.env)
│   ├── stream-parser.ts           Buffer-based artifact stream parser, ArtifactStreamParser class
│   ├── artifact-detector.ts       Post-hoc artifact fallback detection (fences, DOT patterns, SVG tags)
│   ├── artifact-state.ts          Multi-artifact state (SplitArtifact, activeIdx, prev/next helpers)
│   ├── renderer-loader.ts         CDN-to-local renderer loader, centralized error wrapper, KaTeX/Mermaid/GV
│   ├── token-batcher.ts           rAF-based token batching for smooth DOM updates
│   ├── cleanup.ts                 Session cleanup, localStorage persistence, stale data check
│   ├── sim-search.ts              Web Worker similarity search with 3s fallback timeout
│   └── markdown.ts                Extracted markdown formatting + disclaimer stripping
├── pages/
│   ├── index.astro                Main page, renderer preload in <head>, Google Fonts
│   └── api/
│       ├── chat.ts                Main POST/GET handler — hash cache, idempotency, path routing, token enforcement
│       ├── embed.ts               CF Workers AI embedding endpoint
│       ├── debug.ts               Full system diagnostics endpoint
│       ├── debug-ai.ts            AI binding test endpoint
│       ├── search-credits.ts      Enhanced search credits endpoint
│       ├── rag-store.ts           KV RAG storage endpoint (24h TTL)
│       ├── render-artifact.ts     Kroki proxy endpoint (type+code → SVG)
│       └── summarize.ts           Workers AI conversation summarization endpoint
├── components/
│   ├── ChatIsland.svelte          Main chat UI — streaming, artifacts, RAG, mode switcher, paper aesthetic
│   ├── ArtifactPanel.svelte       Desktop artifact display — thumbnail strip, fade transitions, Code/Preview tabs
│   └── ArtifactOverlay.svelte     Mobile artifact overlay — iframe pinch-zoom, copy/download, back button, carousel
└── tests/
    └── critical.test.ts           12 tests: CSRF, rate limiter, reputation, env reader, Turnstile

scripts/
└── graphify-ci.sh                 CI pipeline: Python graphify extraction → gzip → KV upload

.github/workflows/
└── deploy.yml                     CI/CD: graphify job + deploy job (build, post-process, wrangler deploy, env vars)
```

---

## Deployed Capabilities

### Routing Intelligence
- Three-path classifier (fast/balanced/heavy) with recency triggers, artifact detection, format-choice replies
- Artifact requests force premium model pool ['groq-fast','gemini-flash','cerebras-llama','cloudflare-llama']
- Session path affinity (once heavy, stays heavy)
- Path-based timeouts: 15s fast, 25s balanced, 35s heavy
- Fast path: no retries, no KV ops, no search, no graph
- Balanced path: graph context only, no search
- Heavy path: graph + search + retries

### Artifact Rendering
- 20+ diagram types via Kroki API (Mermaid, Graphviz, D2, PlantUML, Vega, Flowchart)
- KV diagram cache: SHA-256(type+code) → SVG, <5ms hits, 24h TTL
- Buffer-based stream parser (250x faster than char-by-char)
- Hash-based dedup: prevents duplicate artifacts
- Two-step → proactive prompt: AI builds immediately, offers alternatives after
- 4-tier fallback: KV → Kroki → bundled renderer → raw code
- Mobile: pinch-to-zoom iframe overlay, copy/download SVG, hardware back button
- Desktop: scrollable thumbnail strip, amber active ring, ◂ 1/3 ▸ nav, 150ms fade transitions

### Knowledge Graph
- Graphify CI pipeline: Python tree-sitter AST → 229 nodes/395 edges → gzip → KV
- Runtime: module-scope memory cache, keyword + direct label match, god node boost
- Version check on each balanced/heavy request
- 400 token budget, skipped on fast path

### Token Economics
- Estimation: chars/4 per message
- Enforcement: 2048 system cap, 4096 total cap, pre-send isWithinBudget() check
- Logging: per-hour provider aggregates in KV (7-day TTL)
- Visibility: x-token-usage header, footer badge, GET diagnostics with tokenUsage

### Caching
- Hash pre-filter: SHA-256 query → KV qcache, 15min TTL
- Idempotency: UUID per message → KV idem, 5min TTL
- Search: normalized query → KV, 15min TTL
- Kroki: type+code SHA-256 → KV, 24h TTL

### Security
- CSRF: origin/referer validation
- Rate limiting: 20 req/60s per IP
- Turnstile CAPTCHA
- Reputation: 6-tier score-based throttling
- Input sanitization: 8KB cap, control char stripping
- Bot detection: UA heuristics + CF bot score
- DC IP penalization
- Session binding: SHA-256(IP + UA + sessionId)
- Artifact iframe sandboxing

### Mobile/Desktop UX
- Paper/warm stone aesthetic (#faf7f2)
- Green pulsing dot branding
- Edit/Copy/Retry buttons always visible
- Mobile artifact overlay with slide-up transition
- Desktop thumbnail strip with SVG previews

### Infra
- Cloudflare Pages + Workers + KV + Workers AI
- Kroki public API (free)
- Graphify CI (GitHub Actions)
- $0/month total
