# Graph Report - techwriter-bot  (2026-06-03)

## Corpus Check
- 128 files · ~84,888 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 854 nodes · 1405 edges · 31 communities detected
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 90 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2d4867df`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]

## God Nodes (most connected - your core abstractions)
1. `POST()` - 32 edges
2. `createRequestId()` - 29 edges
3. `apiError()` - 26 edges
4. `jsonResponse()` - 20 edges
5. `searchRouter()` - 16 edges
6. `kvKey()` - 15 edges
7. `Technical Writer Bot` - 14 edges
8. `Antigravity Cloudflare API Rotation Strategy` - 14 edges
9. `readEnvKeys()` - 13 edges
10. `setTimeout()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `fail()` --calls--> `formatArtifactRendererError()`  [INFERRED]
  src/components/ArtifactPanel.svelte → src/lib/artifact-error-boundary.ts
- `copySource()` --calls--> `setTimeout()`  [INFERRED]
  src/components/ArtifactSplitView.svelte → src/components/ChatIsland.svelte
- `pingProvider()` --calls--> `setTimeout()`  [INFERRED]
  src/lib/provider-health.ts → src/components/ChatIsland.svelte
- `renderKatexArtifact()` --calls--> `setTimeout()`  [INFERRED]
  src/lib/renderer-loader.ts → src/components/ChatIsland.svelte
- `renderMarkmapArtifact()` --calls--> `setTimeout()`  [INFERRED]
  src/lib/renderer-loader.ts → src/components/ChatIsland.svelte

## Communities (64 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (55): GET(), ALLOWED_ORIGINS, checkCSRF(), dailyEmbedCounts, now, POST(), RateLimitEntry, rateLimits (+47 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (44): ../lib/artifact-detector, regenerateArtifactEntry(), detectAllArtifacts(), detectLang(), langToType(), normalizeType(), RawArtifact, validateArtifact() (+36 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (58): ALLOWED_ORIGINS, bindSession(), checkCSRF(), checkRateLimit(), dailyUsage, DC_ASNS, GET(), getReputation() (+50 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (38): ../lib/artifact-lifecycle, ../lib/artifact-queue, ../lib/artifact-state, ../lib/artifact-types, ../lib/cleanup, ../lib/markdown, ../lib/renderer-loader, ../lib/session-persist (+30 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (43): ../lib/rag-client, ../lib/rag-db, clearAllData(), clearLegacyBrowserState(), runStaleCheck(), chunkText(), embedChunks(), embedLocal() (+35 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (32): getInjectedProviderStatus(), parseProviderFaultInjection(), parseProviderFaultSpec(), readEnvString(), safeEquals(), asCount(), emptyBucket(), recordProviderTelemetry() (+24 more)

### Community 6 - "Community 6"
Cohesion: 0.1
Nodes (27): chatMarkdownExportFilename(), cleanInline(), cleanResponseMarkdown(), codeFence(), createChatMarkdownExport(), createSingleMessageMarkdownExport(), createSlackMessageCopy(), escapeLinkText() (+19 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (39): 10. Response Caching and Idempotency, 1. Intelligent Chat Paths, 2. Multi-Provider AI Routing with Circuit Breaker, 3. Real-Time Artifact Generation, 4. Multi-Tier Live Search, 5. Knowledge Graph Context, 6. Document RAG (Retrieval Augmented Generation), 7. Reputation and Access Tier System (+31 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (38): Architecture, Build and Deploy, Building Around LLM Limitations, Codebase-Aware Responses, code:block1 (┌───────────────────────────────────────────────────────────), code:env (GROQ_API_KEY=gru_...), code:bash (git clone https://github.com/your-username/techwriter-bot.gi), code:bash (npm run dev) (+30 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (34): detectLanguage(), domReady(), escapeAttr(), escapeHtml(), getReactHtml(), loadedScripts, loadedStyles, loadingScripts (+26 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (27): GET(), setTimeout(), checkEnvKeys(), readEnvKeys(), extractKeyTerms(), filterRelevantResults(), getDailyLimits(), checkEnhancedBudget() (+19 more)

### Community 11 - "Community 11"
Cohesion: 0.07
Nodes (26): 10. SSE Parse Resilience (10 min), 1. Guaranteed Abort Cleanup (30 min), 2. Session Persistence (1.5 hours), 3. SSE Connection Resilience (1 hour), 4. Kroki Request Queue (30 min), 5. Aggressive Token Governor (30 min), 6. Provider Health Pre-Flight (30 min), 7. New Chat Guard (15 min) (+18 more)

### Community 12 - "Community 12"
Cohesion: 0.14
Nodes (17): GET(), loadEnv(), POST(), buildCommunityContext(), buildContextFromNodes(), clearGraphCache(), ensureGraph(), getGodNodes() (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.1
Nodes (19): Acceptance Criteria, Antigravity Cloudflare API Rotation Strategy, Cloudflare Setup, code:text (CEREBRAS_API_KEY), code:text (GET /api/debug-keys), code:text (EPERM: operation not permitted, lstat 'C:\Users\admin'), code:text (npm run build), code:text (src/pages/api/debug-ai.ts: Cannot find module 'cloudflare:wo) (+11 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (18): Built for Technical Precision, Not Generic AI Chat, Caching and Idempotency, Codebase-Aware Responses, Diagrams That Actually Work, Document-Centric RAG, Enterprise-Grade Architecture, Live Research, Not Stale Training Data, Multi-Provider Reliability (+10 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (16): [1.x] - Earlier releases, [2.0.0] - 2026-05-10 — Intelligent Artifact Auto-Correction Fallback, [2.1.0] - 2026-05-11 — One-Shot Artifact Rendering Engine Overhaul, All 12 Artifact Types — Stability Status, Changelog, Changes, Deployment, Overview (+8 more)

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (15): cleanSlateConfig, clientChunks, clientDir, distDir, ignorePath, internalConfigs, legacyEntry, midPath (+7 more)

### Community 17 - "Community 17"
Cohesion: 0.13
Nodes (14): Artifact Rendering, Caching, code:block1 (src/), Commit: `b2ac2c0` | Branch: `main` | Deployed: `tw-bot.pages.dev`, Deployed Capabilities, File Inventory (Source Files Only), Infra, Knowledge Graph (+6 more)

### Community 18 - "Community 18"
Cohesion: 0.3
Nodes (11): asCount(), collectOperationalStats(), emptyStats(), finalizeStats(), hourPrefix(), isStatsAuthorized(), listKeys(), parseTelemetryKey() (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.2
Nodes (4): fixArtifactError(), getActiveArtifact(), SplitArtifact, SplitTab

### Community 20 - "Community 20"
Cohesion: 0.33
Nodes (6): CachedResponse, cacheKey(), checkCache(), normalizeQuery(), sha256(), writeCache()

### Community 21 - "Community 21"
Cohesion: 0.32
Nodes (4): closesFence(), containsTerm(), escapeRegExp(), reviewDocument()

### Community 22 - "Community 22"
Cohesion: 0.25
Nodes (4): DIAGRAM_LANGS, lang, origCode, renderer

### Community 23 - "Community 23"
Cohesion: 0.25
Nodes (7): env, keys, req, restored, rl, serialized, state

### Community 24 - "Community 24"
Cohesion: 0.29
Nodes (5): chunksDir, clientDir, distDir, files, serverDir

### Community 25 - "Community 25"
Cohesion: 0.38
Nodes (3): loadRaw(), saveArtifactQueue(), saveConversation()

### Community 26 - "Community 26"
Cohesion: 0.33
Nodes (5): config, configPath, distDir, serverDir, wranglerCache

### Community 27 - "Community 27"
Cohesion: 0.7
Nodes (4): cleanDisplayText(), cleanLogoUrl(), cleanPrimaryColor(), readWhiteLabelConfig()

## Knowledge Gaps
- **230 isolated node(s):** `distDir`, `clientDir`, `serverDir`, `serverFiles`, `workerEntry` (+225 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `setTimeout()` connect `Community 10` to `Community 0`, `Community 2`, `Community 3`, `Community 5`, `Community 9`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `createRequestId()` connect `Community 0` to `Community 2`, `Community 12`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `apiError()` connect `Community 0` to `Community 2`, `Community 12`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `POST()` (e.g. with `createRequestId()` and `getRequestLimits()`) actually correct?**
  _`POST()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `createRequestId()` (e.g. with `GET()` and `POST()`) actually correct?**
  _`createRequestId()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **Are the 14 inferred relationships involving `apiError()` (e.g. with `GET()` and `POST()`) actually correct?**
  _`apiError()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `jsonResponse()` (e.g. with `POST()` and `GET()`) actually correct?**
  _`jsonResponse()` has 9 INFERRED edges - model-reasoned connections that need verification._