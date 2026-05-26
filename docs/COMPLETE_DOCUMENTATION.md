# Technical Writer Bot — Documentation

**Version:** 0.0.1 | **Stack:** Astro 6 + Svelte 5 + Cloudflare Pages | **Deploy:** Cloudflare Workers AI

---

## Overview

Technical Writer Bot is a full-featured AI chat application purpose-built as a technical writing and research assistant. It combines real-time web search, codebase-aware context, document-based retrieval augmented generation (RAG), and automated diagram generation into a single conversational interface.

The application runs on Cloudflare Pages with server-side rendering via Astro, a Svelte 5 reactive frontend, and Cloudflare Workers AI as the primary inference backbone. It intelligently routes queries across multiple AI providers (Groq, Cerebras, Gemini, NVIDIA, OpenRouter) based on query type, user reputation, and availability.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (Svelte 5)                    │
│  ChatIsland → ChatMessages → ChatInput → ArtifactSplitView  │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTP / SSE
┌────────────────────────────▼────────────────────────────────┐
│                     Cloudflare Pages (Astro)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │  /api/chat   │  │ /api/embed    │  │/api/render-     │  │
│  │  POST        │  │  POST         │  │ artifact POST   │  │
│  └──────┬───────┘  └──────┬───────┘  └─────────────────┘  │
│         │                 │                    │           │
│  ┌──────▼─────────────────▼────────────────────▼─────────┐ │
│  │              zen-router (Circuit Breaker)               │ │
│  │  Groq / Cerebras / Gemini / NVIDIA / OpenRouter / CF  │ │
│  └────────────────────────────────────────────────────────┘ │
│         │                  │                    │           │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌────────▼───────┐  │
│  │  SESSION KV  │  │ Workers AI   │  │   Kroki.io     │  │
│  │  (Rate limit,│  │  (Embeddings, │  │  (Diagram       │  │
│  │  health,     │  │   Chat LLM)  │  │   rendering)   │  │
│  │  counters)   │  │              │  │                │  │
│  └──────────────┘  └──────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │
    ┌────▼────────┐
    │  Supabase   │  ← Deferred schema, not active Phase 1 storage
    │  (notes,    │
    │   entities, │
    │   links)    │
    └─────────────┘
```

---

## Technology Stack

| Layer | Technology | Role |
|---|---|---|
| **Framework** | Astro 6.1.9 | SSR pages, routing, build |
| **UI** | Svelte 5.55 | Reactive chat island, artifact views |
| **Styling** | Tailwind CSS 4.2 | Utility-first design system |
| **Runtime** | Cloudflare Pages | Edge hosting,Workers AI binding |
| **AI Inference** | Workers AI + Multi-Provider | Chat completions, embeddings |
| **Document Context** | Active browser-session memory | Privacy-first retrieval context |
| **Database** | Supabase schema (deferred) | Not used for Phase 1 content storage |
| **Diagram** | Kroki.io + Client renderers | Mermaid, Graphviz, D2, PlantUML, Vega |
| **Search** | DuckDuckGo, Wikipedia, Reddit, Tavily, Exa | Multi-tier live search |
| **Security** | Cloudflare Turnstile, CSRF, bot detection | Abuse prevention |

---

## Core Features

### 1. Intelligent Chat Paths

The system classifies every incoming query and routes it to one of three processing paths:

**Fast Path** — Greetings, conversational exchanges, and short non-technical queries skip search and graph enrichment entirely. Response time targets under 2 seconds. No live search, no knowledge graph context.

**Balanced Path** — Standard technical queries. Search is attempted via DuckDuckGo, Wikipedia, and Reddit. The knowledge graph is consulted if available. This is the default path for most substantive technical questions.

**Heavy Path** — Long queries (1500+ characters), explicit research requests, or queries containing recency keywords (e.g., "latest", "2026", "announced"). Triggers enhanced search via Tavily and Exa, full graph retrieval, and uses the most capable models.

Path determination happens in `src/lib/path-router.ts` via `determineChatPath()` and persists for the duration of a session to maintain consistency across conversation turns.

### 2. Multi-Provider AI Routing with Circuit Breaker

The `zen-router` (`src/lib/zen-router.ts`) implements a production-grade provider routing system with:

**Circuit Breaker Pattern** — Each provider has its own circuit. If a provider fails 3 times within a 60-second window, it is ejected for 30 seconds. Permanent failures (401 auth errors) result in ejection for 10 minutes. This prevents cascading failures from taking down the entire system.

**Provider Priority** — Providers are organized by role (`fast`, `balanced`, `heavy`, `fallback`). The router selects providers in priority order, respecting user reputation tier restrictions.

**Session Affinity** — Once a provider succeeds for a session, it is locked for subsequent turns in that session to improve coherence and reduce provider churn.

**Configured Providers** (`src/lib/providers.ts`):

| Provider | Model | Role | Free Tier |
|---|---|---|---|
| Groq | llama-3.3-70b-versatile | Fast | Yes |
| Cerebras | llama-3.1-8b | Balanced | Yes |
| Gemini | gemini-2.0-flash | Heavy | Yes |
| NVIDIA | meta/llama-3.1-8b-instruct | Fallback | Yes |
| OpenRouter | meta-llama/llama-3.1-8b-instruct | Fallback | Yes |
| Cloudflare Workers AI | @cf/meta/llama-3.1-8b-instruct | Fallback | Yes |

### 3. Real-Time Artifact Generation

The system generates structured visual artifacts from AI responses, including diagrams, charts, and code blocks, streamed in real-time.

**Supported Artifact Types** (`src/lib/stream-parser.ts`):

- **Mermaid** — Flowcharts, sequence diagrams, class diagrams, ER diagrams, gantt charts, mind maps
- **Graphviz** — Directed/undirected graphs with DOT syntax
- **D2** — Terrastruct's D2 diagramming language
- **PlantUML** — UML diagrams rendered via PlantUML server
- **Vega / Vega-Lite** — Declarative statistical visualizations (bar, line, scatter, heatmap)
- **KaTeX** — Mathematical notation and equations
- **Markmap** — Mind maps from Markdown headings
- **Flowchart** — Flowchart.js syntax
- **Code** — Syntax-highlighted code blocks via Prism.js
- **HTML** — Self-contained HTML/CSS snippets
- **React** — Live React components in sandboxed iframes
- **SVG** — Inline SVG graphics

**Streaming Parser** — The `ArtifactStreamParser` class in `src/lib/stream-parser.ts` incrementally parses SSE tokens, detecting `<artifact type="..." title="...">` tags as they stream in. This means diagrams appear before the full response is complete.

**Rendering Pipeline**:
- Server-side via Kroki.io for Mermaid, Graphviz, D2, PlantUML, Vega, Flowchart
- Client-side via preloaded libraries for KaTeX, Markmap, D2, Flowchart, and React
- Rendered artifact content is returned for the active request without durable application caching

### 4. Multi-Tier Live Search

Search is orchestrated in `src/lib/search.ts` with three tiers:

**Basic Search** — DuckDuckGo Instant Answer API, Wikipedia API, Reddit Search JSON. Always attempted for non-trivial queries. Fast (< 4 second timeout per source), no API key required.

**Enhanced Search** — Tavily AI and Exa AI for deep, relevance-ranked web search. Requires API keys. Available in "Live" mode which users explicitly activate, limited to 3 uses per day per IP (configurable by reputation tier). Includes monthly budget caps (1000 requests per provider) tracked in KV.

**Search Result Handling**:
- Query expansion for short queries (strips filler words, adds related terms)
- Relevance scoring against the original query
- Deduplication by URL across all sources
- Fallback to query expansion if zero results returned
- Results are used for the active request without durable content caching

Sources are cited inline as `[1]`, `[2]`, etc. and rendered as clickable footnotes in the chat interface.

### 5. Knowledge Graph Context

The system can load and query a compressed knowledge graph from Cloudflare KV (`graph:latest`, `graph:version`). The graph is pre-built from source code and contains:

- **Nodes** — Functions, classes, modules, concepts with file locations and community cluster assignments
- **Links** — Cross-reference relationships with confidence scores
- **Community Summaries** — LLM-generated descriptions of related node clusters

Graph queries in `src/lib/graph-query.ts`:
- Tokenize and score query terms
- Match camelCase, snake_case, and quoted identifiers
- Expand to neighbor nodes (up to 3 degrees)
- Limit context to 1200 tokens
- Prioritize high-degree "god" nodes for broad coverage
- Use community summaries when available for more natural context

The graph is loaded once and cached in module scope. It is stale-checked against the KV version string.

### 6. Document RAG (Retrieval Augmented Generation)

Users can upload documents (.txt, .md, .json, .csv up to 5MB) to get grounded answers. The pipeline:

**Embedding** (`src/lib/embed-pipeline.ts`):
1. File is chunked into ~500 character segments with 100 character overlap (max 100 chunks)
2. Batched embedding requests (5 chunks/request) sent to Workers AI `@cf/baai/bge-small-en-v1.5`
3. Automatic fallback to local Transformers.js (Xenova/bge-small-en-v1.5) if server fails
4. Degraded mode tracked for transparency

**Storage** — Privacy-first operation holds vectorized document context in active
browser-session memory only. It does not persist uploaded document content to
IndexedDB, Cloudflare KV, or Supabase.

**Querying** (`src/lib/rag-client.ts`):
1. User query is embedded via the same model
2. Cosine similarity search against stored document chunks
3. Top 3 chunks above 0.3 threshold returned as `[Point 1]`, `[Point 2]`, etc.
4. Context appended to system prompt with document citation instructions

**Deferred Supabase Schema** (`supabase/schema.sql`, not active in Phase 1 content storage):
- `notes` table with 384-dimensional `vector` column (matching bge-small-en-v1.5)
- `entities` table for preferred/avoid terminology (user-level)
- `links` table for bi-directional wiki-style graph connections
- `match_notes()` stored function for vector similarity search with session isolation
- Row Level Security (RLS) policies for anon access

### 7. Reputation and Access Tier System

The `reputation.ts` module (`src/lib/reputation.ts`) tracks user behavior and assigns access tiers:

**Tiers**:

| Tier | Score Range | Daily Chat | Enhanced Search | Provider Pool |
|---|---|---|---|---|
| Premium | 0-3 | 500 | 3/day | All providers |
| Standard | 4-8 | 200 | 3/day | Unlimited + Groq/Cerebras |
| Curious | 9-12 | 100 | 3/day | Unlimited + Groq |
| Throttled | 13-18 | 50 | 0 | CF/NVIDIA only, 1024 tokens |
| Restricted | 19-29 | 10 | 0 | CF only, 1024 tokens |
| Blocked | 30+ | 0 | 0 | CF only, 512 tokens |

**Score Modifiers**:
- Natural conversational messages: -0.5 points
- Turnstile CAPTCHA pass: -1 point
- Duplicate queries within 60 seconds: +2 points
- Burst requests (5+ in 10 seconds): +3 points
- Bot-like User-Agent detected: +5 points
- Datacenter IP: +3 points
- Turnstile failures: +5 points (auto-block after 3 failures within 10 minutes)

Scores decay by 1 point every 30 minutes of inactivity, resetting to default state after 2 hours idle.

### 8. Security and Abuse Prevention

Multiple layers protect the service:

**Cloudflare Turnstile** — Invisible CAPTCHA challenge. Required for enhanced search and document embedding. `verifyTurnstile()` in `src/utils/security.ts`.

**CSRF Protection** — Origin and Referer header validation against an allowlist. `checkCSRF()` in `src/lib/csrf.ts`.

**Rate Limiting** — 20 requests/minute per IP at the API level, 50 embedding requests/minute, 500 requests/day per IP in dev mode.

**Bot Detection** — User-Agent pattern matching (curl, wget, python, headless, etc.), Cloudflare Bot Score integration, datacenter ASN detection (Hetzner, DigitalOcean, AWS, etc.).

**Input Sanitization** — Message content stripped of control characters, truncated to 8000 characters, validated for role/content structure.

**Session Binding** — Session IDs are derived from a hash of session token + IP + User-Agent prefix, stored in KV.

### 9. Token Budget Management

The `token-counter.ts` (`src/lib/token-counter.ts`) enforces token budgets across the system:

- System prompt hard cap: 2048 tokens
- Total request cap: 4096 tokens
- Token estimation: `ceil(chars / 4)`
- Budget enforcement in `enforceBudget()` — layers content by priority (date > persona > graph > document > search > artifact instructions), truncating lower-priority layers when approaching limits
- Long conversations auto-summarized via the `/api/summarize` endpoint using Llama 3.2-1b-instruct when total tokens exceed 3000 (oldest messages) or 5000 (topic shift detected)

### 10. Response Caching and Idempotency

- **Query Cache** (`src/lib/query-cache.ts`) — disabled for durable response content under privacy-first behavior
- **Response Replay** — durable content replay and client idempotency-key handling are disabled
- **Artifact Rendering** — rendered SVG output is returned without durable application content caching

---

## API Reference

### POST `/api/chat`

Primary chat endpoint. Handles the full pipeline: routing, search, graph, RAG, model inference, and streaming response.

**Request Body**:
```json
{
  "messages": [{ "role": "user|assistant|system", "content": "string" }],
  "sessionId": "string",
  "intent": "chat-fast|research|deep-reason",
  "liveSearch": boolean,
  "hasDocument": boolean,
  "turnstileToken": "string"
}
```

**Response** — Server-Sent Events stream with `data: {...}` JSON chunks following OpenAI chat completions format.

**Response Headers**:
- `x-provider` — Which AI provider fulfilled the request
- `x-search-tier` — `none`, `basic`, or `enhanced`
- `x-search-remaining` — Remaining enhanced search credits
- `x-chat-path` — `fast`, `balanced`, or `heavy`
- `x-token-usage` — JSON with input and graph token counts

**Error Responses**: 429 (rate/daily limit), 403 (blocked/captcha), 413 (body/token budget exceeded), 503 (all providers failed)

### POST `/api/embed`

Generates vector embeddings for text chunks using Workers AI `@cf/baai/bge-small-en-v1.5`.

**Request Body**:
```json
{ "texts": ["string"], "turnstileToken": "string" }
```

**Response**:
```json
{ "vectors": [[0.1, -0.2, ...]], "errors": [null] }
```

Rate limited to 50 req/min per IP, 500 embeddings/day per IP.

### POST `/api/render-artifact`

Server-side diagram rendering via Kroki.io. Used as fallback when client-side rendering fails or for pre-rendering.

**Request Body**:
```json
{ "type": "mermaid|graphviz|d2|plantuml|vega|flowchart", "code": "string" }
```

**Response**:
```json
{ "svg": "<svg>...</svg>" }
```

### POST `/api/summarize`

Summarizes conversation history for context compression or extracts topics from document chunks.

**Request Body**:
```json
{
  "messages": [{ "role": "user|assistant", "content": "string" }],
  "mode": "summary|topics"
}
```

### POST `/api/rag-store`

Disabled legacy persistence endpoint. Privacy-first operation returns a
content-retention-disabled response rather than storing document embeddings.

### GET `/api/search-credits`

Returns remaining enhanced search credits and current tier information for the requesting IP.

### GET `/api/chat` (GET)

Debug endpoint returning system status: circuit breaker diagnostics, daily request counts, configured API keys, client IP, graph stats, token usage.

---

## Configuration

Environment variables (via `.env` or Cloudflare Pages settings):

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq API key for llama-3.3-70b |
| `CEREBRAS_API_KEY` | Cerebras API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `NVIDIA_API_KEY` | NVIDIA NIM API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `TAVILY_API_KEY` | Tavily AI API key for enhanced search |
| `EXA_API_KEY` | Exa AI API key for enhanced search |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret for CAPTCHA |
| `DEV_IPS` | Comma-separated IPs that bypass rate limits/reputation |

---

## Frontend Components

**`ChatIsland.svelte`** — Root Svelte component, orchestrates the entire chat UI, handles SSE streaming, artifact resolution, file upload, mode switching (Fast/Brain/Live), session persistence, and error recovery.

**`ChatMessages.svelte`** — Renders the message log with markdown formatting, source citations, artifact chips, copy/edit/retry actions. Shows streaming content with progressive rendering.

**`ChatInput.svelte`** — Text input with keyboard shortcuts (Ctrl+Enter to send), file upload trigger, mode toggle buttons (Fast/Brain/Live), token usage display, document upload status indicator.

**`ArtifactSplitView.svelte`** — Split-panel view for artifacts on desktop. Shows code side-by-side with rendered preview, supports multiple artifacts per message, navigation between artifacts, copy button, and error display with AI fix action.

**`ArtifactOverlay.svelte`** — Full-screen artifact overlay on mobile. Same content as split view, triggered by tapping an artifact chip.

**`ArtifactPanel.svelte`** — Renders individual artifact content using the appropriate renderer (Mermaid, Graphviz, D2, KaTeX, Vega, etc.).

**`ChatArtifactChip.svelte`** — Clickable artifact preview pill shown below chat messages. Opens the artifact in the split view or overlay.

---

## Data Flow: Chat Request Lifecycle

```
1. User submits message in ChatInput
2. ChatIsland.doSend() prepares messages, checks document RAG context
3. POST /api/chat with sanitized messages + sessionId + intent
4. Server: bindSession() creates IP+UA hashed session
5. Server: checkCSRF() + checkRateLimit() + getReputation()
6. Server: determineChatPath() (fast/balanced/heavy)
7. If balanced/heavy: searchRouter() → basic + enhanced search
8. If balanced/heavy + includeGraph: ensureGraph() + queryGraph()
9. If hasDocument: searchRagKV() for RAG context
10. buildSystemPrompt() assembles layered context (date → persona → graph → document → search → artifact)
11. enforceBudget() trims to 2048 token system prompt limit
12. routeChat() → circuit breaker → try providers in priority order
13. SSE stream returned with x-provider, x-search-tier, x-token-usage headers
14. Client: TokenBatcher batches RAF-aligned UI updates
15. ArtifactStreamParser detects <artifact> tags as they stream
16. resolveArtifact() renders via Kroki (server) or client renderer
17. ArtifactQueue manages multiple artifacts per message
18. ChatMessages renders formatted markdown + citations + artifact chips
19. Response remains in active page-session state; legacy durable browser storage is cleared
20. pollCredits() refreshes enhanced search credit count
```

---

## Design Decisions and Rationale

**Why Astro + Svelte?** — Astro's zero-JS-by-default model keeps the initial HTML shell lean. Svelte 5's fine-grained reactivity (`$state`, `$derived`, `$effect`) handles the complex chat state (streaming text, artifact queues, mode toggles) without the overhead of a virtual DOM.

**Why Multi-Provider?** — No single provider offers guaranteed uptime, best latency for all query types, and free tier availability. The circuit breaker pattern ensures no single provider failure cascades, and session affinity reduces model inconsistency within a conversation.

**Why active-session document context?** — Privacy-first operation avoids
durable retention of uploaded content while still supporting grounded answers
during the open page session.

**Why Kroki.io?** — Server-side diagram rendering offloads heavy processing to
an external service. The application returns sanitized output for the active
request without storing rendered content in its own durable cache.

**Why Token Budget at System Prompt Level?** — Instead of truncating conversation history, the budget is enforced at the context layer. This preserves conversation continuity while ensuring the model never receives a system prompt exceeding its context window tolerance. The layered priority system (date → persona → graph → document → search → artifact) ensures the most important context is always present.

**Why Separate Fast/Brain/Live Modes?** — Users have different needs. "Fast" gives instant answers for simple questions. "Brain" triggers deep research mode with full context. "Live" activates expensive enhanced search on demand. This tri-state approach avoids forcing users into a one-size-fits-all configuration.

---

## Deployment

```bash
# Install dependencies
npm install

# Local development
npm run dev

# Local build (Windows-compatible)
npm run build:local

# Production build
npm run build

# Deploy to Cloudflare Pages
npm run deploy:pages
```

**Wrangler Configuration** (`wrangler.json`):
- `ai` binding for Workers AI
- `SESSION` KV namespace for rate limits, reputation, health/version markers, and aggregate operational counters
- Node.js compatibility flag enabled
- Pages build output: `dist/client`

---

## File Structure

```
src/
├── pages/
│   ├── index.astro              # Main entry, loads ChatIsland
│   ├── artifact/[id].astro     # Standalone artifact viewer
│   └── api/
│       ├── chat.ts             # Primary chat endpoint
│       ├── embed.ts            # Embedding generation
│       ├── render-artifact.ts   # Kroki rendering proxy
│       ├── summarize.ts        # Conversation/document summarization
│       ├── rag-store.ts        # Disabled legacy vector-persistence endpoint
│       ├── search-credits.ts   # Credit balance endpoint
│       ├── debug.ts            # System diagnostics
│       └── debug-ai.ts         # AI provider diagnostics
├── components/
│   ├── ChatIsland.svelte        # Root UI component
│   ├── ChatMessages.svelte      # Message log renderer
│   ├── ChatInput.svelte         # Input with mode toggles
│   ├── ArtifactSplitView.svelte # Desktop artifact panel
│   ├── ArtifactOverlay.svelte   # Mobile artifact overlay
│   ├── ArtifactPanel.svelte     # Individual artifact renderer
│   └── ChatArtifactChip.svelte  # Artifact preview pills
├── lib/
│   ├── providers.ts             # AI provider registry + routing
│   ├── zen-router.ts           # Circuit breaker + provider selection
│   ├── prompts.ts              # System prompt builder
│   ├── path-router.ts          # Query classification + path assignment
│   ├── search.ts               # Multi-tier search orchestration
│   ├── search-enhanced.ts      # Tavily + Exa integration
│   ├── search-reddit.ts        # Reddit search
│   ├── graph-query.ts          # Knowledge graph retrieval
│   ├── rag-db.ts               # Legacy local vector-storage compatibility
│   ├── rag-client.ts           # Document upload + chunk search
│   ├── embed-pipeline.ts       # Embedding with local fallback
│   ├── sim-search.ts           # Web Worker similarity search
│   ├── stream-parser.ts        # SSE artifact tag parser
│   ├── artifact-detector.ts    # Post-hoc artifact detection
│   ├── artifact-queue.ts      # Artifact state management
│   ├── artifact-lifecycle.ts   # Artifact title + ID utilities
│   ├── artifact-state.ts       # Artifact panel state
│   ├── renderer-loader.ts      # CDN library preloader + client renderers
│   ├── kroki-renderer.ts      # Server-side Kroki integration
│   ├── reputation.ts           # User scoring + tier management
│   ├── token-counter.ts        # Budget enforcement + usage logging
│   ├── query-cache.ts          # Legacy response-cache compatibility, durable writes disabled
│   ├── session-persist.ts     # Legacy browser-content cleanup
│   ├── cleanup.ts             # Stale data purging
│   ├── relevance.ts           # Query classification (greeting/inquiry/etc.)
│   ├── markdown.ts            # Markdown → sanitized HTML
│   ├── token-batcher.ts       # RAF-batched UI updates
│   ├── turnstile.ts           # CAPTCHA verification
│   ├── csrf.ts                # CSRF protection
│   └── env-reader.ts          # Environment variable access
├── utils/
│   └── security.ts            # Turnstile verification utility
├── styles/
│   └── global.css             # Tailwind base + custom properties
supabase/
└── schema.sql                 # pgvector RAG schema with RLS policies
public/
├── favicon.svg
└── workers/
    └── similarity-worker.js    # Web Worker for cosine similarity
```
