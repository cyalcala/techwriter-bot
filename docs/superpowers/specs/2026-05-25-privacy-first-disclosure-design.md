# Privacy-First Disclosure and Content Retention Design

Date: 2026-05-25
Status: Approved direction, pending implementation

## Goal

Add a simple, smooth, responsive privacy disclosure to the existing chat footer and change application behavior so the disclosure makes a meaningful and accurate privacy promise.

The product will not claim that no processing occurs or that all data is absolutely secure. It will claim only what the application can enforce: user chat, upload, generated response, and rendered artifact content is not intentionally retained in durable application storage, while limited non-content operational data may be retained for abuse prevention and reliability.

## Existing Behavior Requiring Change

The application currently has durable content retention paths:

- Chat messages and artifact queue data are written to browser `localStorage`.
- Uploaded document chunks and vectors are written to browser `IndexedDB`.
- Uploaded document chunks and vectors are sent to Cloudflare KV by the RAG storage API.
- User prompts and AI responses are cached in Cloudflare KV.
- Rendered artifact SVG content is cached in Cloudflare KV and may be browser/proxy cached.
- Search result caching retains query-linked data in Cloudflare KV and runtime memory.
- Reputation state persists raw recent query text in Cloudflare KV.
- Error logging in search paths may include excerpts of user queries.

The current system also transmits user content to processors as required for requested features:

- AI inference providers receive chat requests.
- Cloudflare Workers AI receives embedding and summarization requests.
- Search providers receive search terms when search is used.
- Kroki receives server-rendered diagram source where that renderer is needed.

Removing application storage does not eliminate this necessary processing or control those processors' independent operational logging.

## User-Facing Design

Add a small `Privacy` button beside the existing footer reminder in `ChatInput.svelte`. The button opens an inline disclosure panel above or adjacent to the footer metadata, without introducing a modal or routing the user away from the chat.

Interaction requirements:

- The panel opens and closes with a subtle height and opacity transition.
- The button exposes `aria-expanded` and `aria-controls`.
- A visible close affordance and Escape-key close behavior are provided.
- The panel fits the existing stone/amber visual language.
- Text remains readable without obscuring the input on narrow mobile screens.
- Reduced-motion preferences disable or greatly shorten the transition.

Proposed visible copy:

> **Privacy Notice**
>
> Private by default: this site does not intentionally retain your chat messages, uploaded document content, generated responses, or rendered artifact content in durable application storage. Your active chat remains in memory while this page is open. Content is sent only as needed to provide the feature you request, which may involve Cloudflare, AI providers, search providers, or a diagram renderer operating under their own terms. Limited technical data, such as request counts, provider health, and abuse-prevention signals, may be retained temporarily without message content. We use security controls including encrypted HTTPS transit, but no online service can promise absolute security. Do not submit highly sensitive personal data. We do not sell personal information or use it for targeted advertising.
>
> For privacy questions, contact the site operator through the creator link above.

This is a general transparency notice, not a representation that the site satisfies every jurisdiction-specific obligation without information about the operator, users, vendors, and processing agreements.

## Application Behavior

### Content Kept Only In Active Memory

Chat messages, streamed responses, active document vectors, artifact state, and queued prompts remain usable during the current open page session. They are held only in page or Worker runtime memory required to complete active requests.

On refresh, navigation away, `Clear`, or `New`, content will no longer be restored from local or server-side application storage.

### Browser Storage Removal

- Stop writing conversation history, artifact queues, and session identifiers to `localStorage`.
- Replace IndexedDB-backed document vector persistence with in-memory document vectors scoped to the open page.
- Delete legacy browser keys and the legacy IndexedDB document database on load or when the user clears the chat.

### Server Content Storage Removal

- Stop uploading document vectors to `/api/rag-store`; retain document retrieval context in active browser memory and submit only selected context needed for an active AI request.
- Disable the RAG storage endpoint so it cannot create new KV content records.
- Disable prompt/response cache reads and writes in the chat route.
- Disable persistent search-result caching and query-bearing diagnostic logs.
- Do not persist raw query text in reputation state. Abuse checks may retain request timing, counts, or non-content signals for their existing limited lifetime.
- Disable KV and browser/proxy caching for server-rendered artifacts containing user-provided labels or source.

### Operational Metadata Preserved

The application may continue using limited metadata required to operate safely and reliably:

- Short-lived IP-associated rate limit, credit, and abuse-prevention state.
- Provider circuit-breaker and failover health information.
- Aggregated token counts and app-version markers that do not include chat text.
- Request identifiers and ordinary infrastructure processing required to serve requests.

The disclosure must not call this "no data storage." It distinguishes non-retention of submitted content from temporary operational processing and metadata.

## Documentation And Migration

- Update README claims that currently describe local or KV content persistence.
- Correct any wording that suggests all processing remains within Cloudflare when external model, search, or rendering providers can receive content.
- On deployment, remove legacy application content records where feasible from the configured KV namespace: document RAG records, prompt/response caches, search-result content caches, and reputation records that may contain query text.

## Error Handling

- If a document cannot be retained in memory or embedded, show the existing upload failure/degraded feedback; never silently fall back to durable content storage.
- If model or rendering providers are unavailable, report the failure normally; do not fall back to cached user content.
- Privacy panel rendering does not require network requests and must not block use of the chat input.

## Verification

- Unit tests confirm that chat requests do not invoke response cache reads or writes and that reputation serialization stores no raw user query.
- Unit tests confirm RAG storage returns disabled behavior and in-memory document operations clear data.
- A repository search checks for remaining writes of message, document, response, rendered artifact, or query content to `localStorage`, `IndexedDB`, and Cloudflare KV.
- Build the Astro/Cloudflare deployment output and run the existing test suite.
- In a real browser, verify open/close animation, keyboard accessibility, readable mobile layout, desktop layout, and reduced-motion behavior.
- Deploy to the configured Cloudflare Pages project and verify the deployed privacy interaction.

## Out Of Scope

- Legal advice or a jurisdiction-specific compliance certification.
- Negotiating or validating zero-data-retention agreements with AI, search, rendering, or infrastructure providers.
- Replacing external providers with Cloudflare-only processing.
- Adding user accounts, consent management, data-access request workflows, or analytics controls not otherwise present in this product.
