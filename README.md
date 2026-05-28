# Technical Writer Bot

### The AI Writing Assistant Built for Real Technical Work

[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-f38020?style=flat-square&logo=cloudflare)](https://pages.cloudflare.com)
[![Astro](https://img.shields.io/badge/Astro-6.1-ff5d01?style=flat-square&logo=astro)](https://astro.build)
[![Svelte](https://img.shields.io/badge/Svelte-5-ff3e00?style=flat-square&logo=svelte)](https://svelte.dev)

**[Live Demo](https://tw-bot.pages.dev)** · **[Documentation](#features)** · **[Deployment](#getting-started)**

---

## The Problem

Technical writing is the backbone of every software company. Every API reference, user guide, architecture decision log, and onboarding document requires precision, clarity, and domain expertise. Yet the tools technical writers rely on haven't caught up with what modern AI can actually do.

Most AI chat tools treat technical writing as an afterthought — a generic wrapper around a language model that doesn't understand the nuances of documentation, the importance of diagram accuracy, or the difference between a flow chart and a sequence diagram. They hallucinate code that doesn't compile. They cite sources that don't exist. They produce generic responses that lack the depth serious technical work demands.

We built Technical Writer Bot because we believe AI should make technical writers *more* authoritative — not replace them. The tool should understand your codebase, your documentation standards, and your domain. It should generate diagrams that actually render. It should search the live web for current information rather than relying on training cutoffs. It should work with documents you provide, not around them.

This isn't a chatbot you use for fun. It's a precision instrument for people who take technical communication seriously.

---

## What It Does

Technical Writer Bot is an AI chat application purpose-built as a technical writing and research assistant. It combines real-time web search, codebase-aware context, document-based retrieval augmented generation (RAG), and automated diagram generation into a single conversational interface.

It runs on Cloudflare Pages with a Svelte 5 reactive frontend and Cloudflare Workers AI as the inference backbone — with automatic failover across five additional providers.

---

## Features

### Diagrams That Actually Work

Generic AI tools produce Mermaid syntax that breaks, Graphviz that doesn't compile, or D2 code that renders as a blank screen. Technical Writer Bot handles the full diagram pipeline - from streaming detection of artifact tags as the AI generates them, through on-demand server-side rendering via Kroki.io without durable application caching, to client-side progressive enhancement.

**12 artifact types supported:**

| Type | Description |
|---|---|
| Mermaid | Flowcharts, sequence diagrams, class/ER/Gantt charts, mind maps |
| Graphviz | Directed/undirected graphs with DOT syntax |
| D2 | Terrastruct's D2 diagramming language |
| PlantUML | UML diagrams via PlantUML server |
| Vega / Vega-Lite | Statistical visualizations — bar, line, scatter, heatmap |
| KaTeX | Mathematical notation and equations |
| Markmap | Mind maps from Markdown headings |
| Flowchart | Flowchart.js syntax |
| Code | Syntax-highlighted blocks via Prism.js |
| HTML | Self-contained HTML/CSS snippets |
| React | Live React components in sandboxed iframes |
| SVG | Inline graphics with sanitized rendering |

When a diagram fails to render, the system surfaces the error and offers an AI-powered fix. No manual syntax debugging.

### Live Research, Not Stale Training Data

Every response from a generic AI is bounded by when that model was trained. Technical Writer Bot integrates real-time web search across three tiers:

**Basic search** — DuckDuckGo Instant Answers, Wikipedia, and Reddit. No API keys required. Attempted automatically for substantive queries.

**Enhanced search** — Tavily AI and Exa AI for deep, relevance-ranked results when you explicitly activate **Live mode**. Every claim is cited inline as `[1]`, `[2]`, etc. with clickable footnotes. Reviewers can verify every source.

Enhanced search is available on demand — 3 uses per day by default, adjustable by user tier — because it has real cost, and most questions don't need it.

**Query handling:**
- Automatic query expansion for short queries (strips filler words, adds related terms)
- Relevance scoring and URL deduplication across all sources
- Search results are processed for the current request without durable content caching
- Fallback to expanded queries when zero results are returned

### Codebase-Aware Responses

Upload a compressed knowledge graph representing your actual codebase — not generic knowledge, but your specific functions, classes, modules, and their relationships. The AI grounds its responses in your real code.

- Up to 3 degrees of neighbor expansion
- CamelCase and snake_case identifier matching
- Community-clustered summaries for natural context
- Configurable 1200-token context window

### Document-Centric RAG

Upload your existing documentation — `.txt`, `.md`, `.json`, `.csv` up to 5MB — and ask questions grounded in your actual content. The system:

1. Chunks your document (~500 chars, 100-char overlap, max 100 chunks)
2. Generates embeddings via Workers AI `bge-small-en-v1.5`
3. Falls back to local Transformers.js if the server is unavailable
4. Holds vectors in active browser memory only for the open page session
5. Surfaces top 3 relevant chunks with cosine similarity ≥ 0.3

Privacy-first mode does not enable persistent document storage across sessions or devices.

### User-Controlled Documentation Tools

The `Tools` panel exposes two explicit, non-autonomous actions:

- **Review Document** runs deterministic checks on the currently uploaded text for heading-level skips, unclosed code fences, empty Markdown links, duplicate headings, and optional terminology preferences entered for that review. It remains usable even when document embedding for chat context is unavailable.
- **Find Code References** runs a bounded, read-only lookup against the configured project graph and returns matching `src/` references only. It does not return document nodes or generic graph hubs when a term has no match.

Uploaded review source, terminology input, findings, and reference results remain in active page memory only; the application does not intentionally persist them in durable storage.

### Multi-Provider Reliability with Circuit Breaker

No single AI provider offers guaranteed uptime, best latency for every query type, and free access. Technical Writer Bot runs across **six providers** with automatic failover:

| Provider | Model | Role |
|---|---|---|
| Groq | llama-3.3-70b-versatile | Fast |
| Cerebras | llama-3.1-8b | Balanced |
| Gemini | gemini-2.0-flash | Heavy |
| NVIDIA | meta/llama-3.1-8b-instruct | Fallback |
| OpenRouter | meta-llama/llama-3.1-8b-instruct | Fallback |
| Cloudflare Workers AI | @cf/meta/llama-3.1-8b-instruct | Fallback |

The circuit breaker pattern (`src/lib/zen-router.ts`) ejects providers after 3 failures in 60 seconds. Permanent auth failures get a 10-minute cool-down. Your conversation continues even when a provider doesn't.

Per-session provider affinity ensures a single provider handles your conversation for consistency, not model-hopping on every turn.

### Intelligent Query Routing

Every query is classified into one of three paths that determine how much processing it receives:

- **Fast** — Greetings, conversational exchanges, short non-technical queries. Skips search and graph. Targets sub-2-second responses.
- **Balanced** — Standard technical questions. Basic search + knowledge graph consultation. Default for most substantive queries.
- **Heavy** — Long queries (1500+ chars), research intent, recency keywords ("latest", "2026", "announced"). Triggers enhanced search + full graph retrieval + most capable models.

Path determination persists across the session for consistency.

### Token Budget and Context Management

Long conversations drain tokens that could be used for actual context. The system proactively manages this:

- Hard **2048-token ceiling** on system prompts, enforced via layered priority (date → persona → graph → document → search → artifact instructions)
- Automatic conversation summarization using Llama 3.2-1b-instruct when tokens exceed 3000 (or 5000 on topic shift)
- Token usage reported in every response header (`x-token-usage`)

### Privacy-First Processing

- Chats and generated responses remain available only while the page is open and are not intentionally written to durable application storage.
- Uploaded document context is held in active browser memory for the current page session and is not written to Cloudflare KV.
- Documentation tool inputs and results remain in active page memory; graph lookup responses are read-only, bounded, and sent with no-store caching directives.
- Rendered artifact output and search-result content are not stored in application caches.
- Limited operational metadata may be retained temporarily for security, rate limiting, provider reliability, and aggregate usage reporting; it does not include message content.
- Requested features may transmit necessary content to Cloudflare Workers AI, selected AI/search providers, or Kroki under their own terms.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Browser (Svelte 5)                      │
│         ChatIsland → Messages → Input → ArtifactSplit        │
└────────────────────────────┬─────────────────────────────────┘
                             │ SSE / HTTP
┌────────────────────────────▼─────────────────────────────────┐
│                    Cloudflare Pages (Astro)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐  │
│  │ /api/chat   │  │ /api/embed  │  │ /api/render-artifact │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬───────────┘  │
│         │                │                    │              │
│  ┌──────▼─────────────────▼────────────────────▼──────────┐  │
│  │            zen-router (Circuit Breaker)                  │  │
│  │     Groq / Cerebras / Gemini / NVIDIA / OpenRouter / CF  │  │
│  └─────────────────────────────────────────────────────────┘  │
│         │                │                    │              │
│  ┌──────▼──────┐  ┌───────▼──────┐  ┌─────────▼──────────┐  │
│  │ SESSION KV  │  │  Workers AI  │  │     Kroki.io       │  │
│  │ (rate limit, │  │ (embeddings, │  │ (Mermaid/Graphviz/ │  │
│  │  health,     │  │  chat LLM)   │  │  D2/PlantUML/Vega) │  │
│  │  counters)   │  │              │  │                    │  │
│  └─────────────┘  └──────────────┘  └────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology |
|---|---|
| Framework | Astro 6.1 |
| UI | Svelte 5 |
| Styling | Tailwind CSS 4 |
| Runtime | Cloudflare Pages + Workers AI |
| AI Routing | Custom circuit breaker (6 providers) |
| Vector Store | In-memory document context for the active page session |
| Diagram Rendering | Kroki.io + client-side libraries |
| Search | DuckDuckGo, Wikipedia, Reddit, Tavily, Exa |

---

## Enterprise and Agency Use

### For Technical Writing Agencies

Agencies face a specific problem: writers need to rapidly absorb client documentation context, produce output matching client terminology, generate diagrams that render correctly, and cite verifiable sources.

- **Faster client context onboarding** — Upload the client's existing docs and the RAG system grounds every response in their actual terminology and content
- **Diagrams that pass client review** — Automated rendering pipeline means every diagram is verified before delivery, not fixed after
- **Verifiable claims** — Enhanced search with live citations meets the standard that serious publications require
- **No downtime** — Circuit breaker ensures work continues even when a provider has issues

### For Enterprise Teams

Technical Writer Bot is hosted on Cloudflare, while requested chat, live-search, and diagram features may transmit necessary content to selected AI, search, or rendering providers under their own terms.

- **Self-hostable** — Deploy to your own Cloudflare Pages project with privacy-first session-only document context.
- **Access tier system** — Six reputation tiers (Premium → Blocked) automatically manage abusive usage without affecting legitimate users
- **Token budget visibility** — Every response shows token counts and processing path. IT teams can monitor aggregate operational usage in their deployment environment.
- **Dev IP bypass** — Configure `DEV_IPS` for trusted ranges to bypass rate limits during internal use

---

## Building Around LLM Limitations

Building a serious application on top of LLMs requires honestly confronting what they get wrong:

| Challenge | How Technical Writer Bot Addresses It |
|---|---|
| **Hallucination** | Live search with source citations; knowledge graph grounds responses in actual code; document RAG constrains answers to provided content |
| **Context window pressure** | Hard 2048-token system prompt cap; proactive conversation summarization; layered budget enforcement |
| **Provider inconsistency** | Circuit breaker removes failing providers; session affinity locks a provider for consistent responses |
| **Non-deterministic artifact output** | Streaming parser detects `<artifact>` tags character-by-character as they arrive; renders diagrams progressively |
| **Embedding computation** | Offloaded to Workers AI and Transformers.js, not the LLM; dedicated services for their respective tasks |

---

## Getting Started

### Prerequisites

- Node.js 22.12.0+
- Cloudflare Pages project (free tier works)
- API keys for desired providers (Groq and Cloudflare AI are free)

### Environment Variables

```env
GROQ_API_KEY=gru_...
CEREBRAS_API_KEY=...
GEMINI_API_KEY=...
NVIDIA_API_KEY=...
OPENROUTER_API_KEY=...
TAVILY_API_KEY=...        # Optional — for enhanced search
EXA_API_KEY=...           # Optional — for enhanced search
DEV_IPS=1.2.3.4,5.6.7.8   # Optional — comma-separated IPs bypass rate limits
```

### Installation

```bash
git clone https://github.com/your-username/techwriter-bot.git
cd techwriter-bot
npm install
```

### Development

```bash
npm run dev
# Opens at http://localhost:4321
```

### Build and Deploy

```bash
npm run build           # Production build
npm run deploy:pages    # Deploy to Cloudflare Pages
```

For local Windows builds:
```bash
npm run build:local
```

---

## Project Structure

```
src/
├── pages/
│   ├── index.astro              # Main entry point
│   └── api/
│       ├── chat.ts              # Primary chat endpoint
│       ├── embed.ts             # Embedding generation
│       ├── render-artifact.ts   # Kroki rendering proxy
│       ├── summarize.ts          # Conversation summarization
│       ├── rag-store.ts         # Disabled legacy persistence endpoint
│       └── search-credits.ts     # Credit balance endpoint
├── components/
│   ├── ChatIsland.svelte         # Root UI orchestrator
│   ├── ChatMessages.svelte       # Message log with markdown
│   ├── ChatInput.svelte          # Input with Fast/Brain/Live modes
│   ├── ArtifactSplitView.svelte  # Desktop artifact panel
│   ├── ArtifactOverlay.svelte    # Mobile artifact overlay
│   └── ChatArtifactChip.svelte   # Artifact preview pills
└── lib/
    ├── providers.ts              # AI provider registry
    ├── zen-router.ts            # Circuit breaker + routing
    ├── search.ts                # Multi-tier search orchestration
    ├── graph-query.ts          # Knowledge graph retrieval
    ├── rag-client.ts           # Document upload + chunk search
    ├── embed-pipeline.ts       # Embedding with Transformers.js fallback
    ├── stream-parser.ts        # SSE artifact tag parser
    ├── renderer-loader.ts      # CDN preloader + client renderers
    ├── kroki-renderer.ts       # Server-side Kroki integration
    ├── reputation.ts            # User scoring + tier system
    ├── token-counter.ts        # Budget enforcement
    └── session-persist.ts       # Legacy browser-content cleanup
supabase/
└── schema.sql                   # pgvector RAG schema
```

---

## How It Works: Request Lifecycle

```
1. User submits message
2. Document RAG context retrieved (if document uploaded)
3. POST /api/chat with sanitized messages + sessionId + intent
4. Session binding via IP+UA hash
5. Query classified into fast/balanced/heavy path
6. Basic search (+ enhanced search if Live mode)
7. Knowledge graph consulted (if balanced/heavy)
8. System prompt assembled with layered context
9. Token budget enforced (2048 ceiling)
10. Circuit breaker routes to available provider
11. SSE streaming response begins
12. ArtifactStreamParser detects diagram tags as tokens arrive
13. Diagrams render via Kroki (server) or client renderer
14. Conversation remains in active page memory only
15. Token usage and credits tracked
```

---

## Why Technical Writer Bot vs. Generic AI Chat?

| Capability | Generic AI Chat | Technical Writer Bot |
|---|:---:|:---:|
| Diagram rendering | Raw code, breaks often | 12 types, server + client pipeline, auto-fix |
| Live web search | Training data cutoff only | 3-tier search with source citations |
| Codebase context | None | Knowledge graph, 3-degree neighbor expansion |
| Document RAG | None | Active-session in-memory document context |
| Provider uptime | Single provider, downtime expected | Circuit breaker across 6 providers, auto-failover |
| Access management | None | 6-tier reputation system, auto rate-limiting |
| Streaming artifacts | None | Progressive, renders as AI generates |
| Token management | Ignores | Hard 2048 cap, auto-summarization |
| Deployment | SaaS only | Self-hostable on Cloudflare edge |
| Content retention | Varies | Privacy-first: no durable application content storage |

---

## The Decision to Build This

The creator — a solo developer and technical writer — needed a tool that didn't exist: an AI assistant that understood technical documentation workflows, rendered diagrams correctly without manual debugging, searched current information rather than training data, worked with actual documents, and could be self-hosted without complex infrastructure.

Existing solutions fell short across the board. Generic AI tools produce generic output. Documentation-focused tools lack real-time search and diagram support. Enterprise AI platforms require expensive infrastructure without the fine-grained control technical writing workflows demand. Open-source solutions need significant setup and don't include the multi-provider routing, circuit breaking, and streaming artifact support that production use requires.

Technical Writer Bot was built to fill that gap: a production-ready, self-hostable technical writing assistant that handles the full workflow from research to document Q&A to diagram generation to code output, with the reliability guarantees serious work demands.

---

## License

MIT
