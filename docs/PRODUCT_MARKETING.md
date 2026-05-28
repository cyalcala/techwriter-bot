# Technical Writer Bot — The AI Writing Assistant Built for Real Technical Work

---

## The Problem That Started Everything

Technical writing is the backbone of every software company. Every API reference, every user guide, every architecture decision log, every onboarding document — they all require precision, clarity, and domain expertise. Yet the tools technical writers rely on haven't caught up with the reality of how modern AI can actually help.

Most AI chat tools treat technical writing as an afterthought — a generic wrapper around a language model that doesn't understand the nuances of documentation, the importance of diagram accuracy, or the difference between a flow chart and a sequence diagram. They hallucinate code that doesn't compile. They cite sources that don't exist. They produce generic responses that lack the depth and specificity that serious technical work demands.

We built Technical Writer Bot because we believe AI should make technical writers *more* authoritative — not replace them. The tool should understand the context of your codebase, your documentation standards, and your domain. It should generate diagrams that actually render correctly. It should search the live web for the latest information rather than relying on training cutoffs. It should work with documents you provide, not around them.

This isn't a chatbot you use for fun. It's a precision instrument for people who take technical communication seriously.

---

## Built for Technical Precision, Not Generic AI Chat

Technical Writer Bot was architected from day one around the specific demands of technical content creation:

### Diagrams That Actually Work

Generic AI tools produce Mermaid syntax that breaks, Graphviz that doesn't compile, or D2 code that renders as a blank screen. Technical Writer Bot handles the full diagram pipeline - from streaming detection of artifact tags as the AI generates them, through on-demand server-side rendering via Kroki.io without durable application content caching, to client-side progressive enhancement using libraries like Mermaid.js, Graphviz WASM, D2, Vega-Embed, KaTeX, and Flowchart.js.

The system currently supports **12 distinct artifact types**: Mermaid diagrams, Graphviz graphs, D2 diagrams, PlantUML, Vega statistical charts, KaTeX mathematical notation, Markmap mind maps, Flowchart.js flows, syntax-highlighted code blocks, self-contained HTML/CSS snippets, live React components in sandboxed iframes, and sanitized inline SVG graphics.

When a diagram fails to render — which happens even with perfect code — the system surfaces the error and offers an AI-powered fix. You don't debug broken diagram syntax manually. The tool assists.

### Live Research, Not Stale Training Data

Every response from a generic AI tool is bounded by when that model was trained. Technical Writer Bot integrates real-time web search across multiple tiers:

**Basic search** pulls from DuckDuckGo Instant Answers, Wikipedia, and Reddit — no API keys required, fast enough for every query.

**Enhanced search** uses Tavily AI and Exa AI when you explicitly activate Live mode, giving you deep, relevance-ranked results from across the web with proper source citations. Enhanced search is available on demand (3 uses per day by default, adjustable by user tier) precisely because it has real cost — and because most questions don't need it.

Every source is cited inline as `[1]`, `[2]`, etc. and rendered as clickable footnotes. You see exactly where information comes from, and your readers can verify it.

### Codebase-Aware Responses

The system can load and query a compressed knowledge graph representing your actual codebase — not generic knowledge, but your specific functions, classes, modules, and their relationships. When you ask about architecture decisions, specific functions, or domain concepts from your project, the AI grounds its responses in your actual code.

The graph supports up to 3 degrees of neighbor expansion, community-clustered summaries, camelCase and snake_case identifier matching, and a configurable 1200-token context window.

### Document-Centric RAG

Upload your existing documentation — text, Markdown, JSON, or CSV files up to 5MB — and ask questions that require understanding of your actual content. The system chunks your document, generates embeddings using Cloudflare Workers AI's bge-small-en-v1.5 model (with automatic fallback to a local Transformers.js pipeline if the server is unavailable), holds vectors for the active page session only, and surfaces relevant excerpts with citation markers.

Privacy-first operation intentionally does not persist uploaded document content across sessions or devices.

### Multi-Provider Reliability

No single AI provider offers guaranteed uptime, best-in-class latency for every query type, and unlimited free access. Technical Writer Bot implements a circuit breaker pattern across six providers — Groq, Cerebras, Google Gemini, NVIDIA NIM, OpenRouter, and Cloudflare Workers AI — with automatic failover and per-session provider affinity.

If Groq hits a rate limit, Cerebras takes over. If Cerebras times out, Gemini tries. The circuit breaker ejects failing providers after 3 errors in 60 seconds, with permanent auth failures getting a 10-minute cool-down. Your conversation continues even when a provider doesn't.

---

## Enterprise-Grade Architecture

Technical Writer Bot was designed for team use from the beginning, not bolted on as an afterthought.

### Reputation and Access Tier System

Not all users should have the same access. The reputation system tracks behavior — natural conversational usage improves your standing, while duplicate queries, burst requests, bot-like behavior, and datacenter IP sources all increase friction. Six tiers range from Premium (500 daily requests, all providers, 3 enhanced searches) to Blocked (service suspended). This means abusive usage patterns are automatically rate-limited without affecting legitimate users.

### Security at Every Layer

- **Cloudflare Turnstile** — Invisible CAPTCHA verification for sensitive operations (enhanced search, document embedding)
- **CSRF protection** — Origin and Referer validation against an explicit allowlist
- **Bot detection** — User-Agent pattern matching, Cloudflare Bot Score integration, datacenter ASN detection
- **Input sanitization** — Control character stripping, length limits, role/content structure validation
- **Session binding** — Session IDs derived from a hash of session token + IP + User-Agent prefix

### Token Budget Enforcement

Every system prompt is enforced to a hard 2048-token ceiling through a layered priority system: date and persona always appear, then graph context, document context, search results, and finally artifact generation instructions — each layer consuming only what remains. Long conversations are automatically summarized using a lightweight Llama 3.2-1b-instruct model when they approach token limits, preserving key facts while freeing context space.

### Content Retention and Request Handling

- Query responses are processed for the active request without durable content caching
- Rendered diagram SVGs are returned without durable application content caching
- Conversation and uploaded document context remain available only in the open page session
- Limited operational metadata may be retained for rate limits, health, and aggregate provider reliability

---

## Why Agencies Need This Specifically

Technical writing agencies face a unique problem: their writers need to rapidly absorb context from client-provided documentation, produce output that matches client terminology and style, generate diagrams that render correctly the first time, and cite sources that are actually verifiable. Generic AI tools fail on all four counts.

**Faster onboarding to client context.** Upload the client's existing documentation — API references, architecture decision records, previous technical content — and the RAG system grounds every response in that material. The AI writes with your client's voice and terminology, not generic boilerplate.

**Diagrams that client reviewers don't reject.** The automated rendering pipeline means every Mermaid diagram, Graphviz graph, or D2 chart is rendered and verified before delivery. No more "the diagram doesn't look right" feedback cycles.

**Verifiable claims with live sources.** When writing about technologies, standards, or APIs, enhanced search pulls from current web sources. Every claim is cited. Reviewers can click through to verify. This is the standard that serious technical publications require.

**Multi-provider redundancy.** Agencies can't afford downtime. The circuit breaker ensures that if one provider has issues, the work continues. Writers stay productive.

---

## Why Enterprises Should Care

For enterprises, Technical Writer Bot provides a self-hostable AI writing assistant on Cloudflare Pages and Workers AI. Content needed for a requested operation may be transmitted to configured AI or search providers, or to Kroki when rendering a server-side diagram; the application does not durably retain that content in its own caches.

**Compliance-friendly architecture.** Privacy-first operation keeps conversation and uploaded-document content out of durable application storage. Configured model providers process generated requests, Live mode can call Tavily or Exa, and server-side diagram rendering can call Kroki; each external service remains governed by its own terms.

**Configurable provider policies.** Enterprise deployments can configure `DEV_IPS` for trusted internal IP ranges that bypass rate limits, set custom daily enhanced search limits, and configure the provider pool to prefer specific models for compliance requirements.

**Token budget visibility.** Every response includes token usage counts and which processing path was used (fast/balanced/heavy). Enterprise IT teams can monitor content-free operational usage patterns through their deployment environment.

---

## The Challenge of Building Around LLM Limitations

Building a serious application on top of LLMs requires honestly confronting what they get wrong:

**Hallucination.** Language models confidently state things that aren't true. Technical Writer Bot addresses this through live search with source citations — every factual claim can be verified. When the knowledge graph is loaded, responses are grounded in actual code. When a user uploads documents, answers are constrained to that content.

**Context window pressure.** A long conversation consumes tokens that could be used for actual context. The system proactively summarizes old messages, enforces a hard token budget at the system prompt layer, and truncates gracefully rather than failing silently.

**Provider inconsistency.** The same prompt can produce different quality responses from different providers, or from the same provider at different times. Session affinity locks a provider for the duration of a conversation, and the circuit breaker removes consistently underperforming providers from the pool.

**Non-deterministic artifact output.** AI models don't reliably output properly formatted artifact tags. The streaming parser handles incremental token consumption, detecting artifact open/close tags as they arrive character by character, and rendering diagrams progressively rather than waiting for the complete response.

**Tool use limitations.** Many tasks — embedding generation, diagram rendering, summarization — are offloaded to dedicated services rather than asking the LLM to do them. This keeps the LLM focused on what it does well: generating text and code, not computing embeddings or managing SVG rendering.

---

## The Decision to Build This

The creator — a solo developer and technical writer — needed a tool that didn't exist: an AI assistant that understood technical documentation workflows, rendered diagrams correctly without manual debugging, searched current information rather than training data, worked with actual documents, and could be self-hosted without complex infrastructure.

The existing solutions fell short in one or more dimensions:

- Generic AI tools don't understand documentation context and produce generic output
- Documentation-focused tools (some of them) lack real-time search and diagram support
- Enterprise AI platforms require expensive infrastructure and don't offer the fine-grained control needed for technical writing workflows
- Open-source solutions require significant setup and don't include the multi-provider routing, circuit breaking, and artifact streaming that production use requires

Technical Writer Bot was built to fill that gap: a production-ready, self-hostable technical writing assistant that handles the full workflow from research to document Q&A to diagram generation to code output, with the reliability guarantees that serious work demands.

---

## Summary: Why Technical Writer Bot Is Different

| Capability | Generic AI Chat | Technical Writer Bot |
|---|---|---|
| **Diagram rendering** | Raw code only, breaks frequently | 12 types, server + client render pipeline, auto-fix |
| **Live search** | Training data cutoff only | 3-tier search, source citations, no durable content cache |
| **Codebase context** | None | Knowledge graph, 3-degree neighbor expansion |
| **Document RAG** | None | Active-session document context only |
| **Provider reliability** | Single provider, downtime expected | Circuit breaker across 6 providers, auto-failover |
| **Access control** | None | 6-tier reputation system with rate limits |
| **Security** | Basic | Turnstile, CSRF, bot detection, datacenter blocking |
| **Streaming artifacts** | None | Incremental parsing, progressive rendering |
| **Token budget** | Ignores | Hard 2048 prompt cap, auto-summarization |
| **Enterprise-ready** | No | Cloudflare edge, optional Supabase, RLS, self-hostable |

Technical writing is not a generic task. It deserves a tool built specifically for it — one that understands diagrams, citations, document context, codebase references, and the real cost of hallucination in a professional context.

That's why Technical Writer Bot exists.
