# Documentation Tooling Agent Foundation Design

Date: 2026-05-27
Status: Approved product direction captured; implementation not started

## Goal

Turn Technical Writer Bot toward a human-controlled Documentation Tooling
Agent by delivering one bounded tool workflow that improves document quality
without building an autonomous agent platform or an in-browser development
runtime.

The first slice should feel like a writer deliberately running a useful tool,
not an AI choosing actions behind the scenes. It builds on the existing
privacy-first chat surface, active-session document handling, and read-only
knowledge graph.

## Recommended First Slice

Add a compact `Tools` surface in the existing writing workspace with two
explicit actions:

1. `Review Document`: run deterministic checks against an uploaded Markdown or
   text document held in the current page session.
2. `Find Code References`: query the existing project knowledge graph for a
   term the user enters and return bounded read-only references.

These two tools form a coherent first slice: a writer can find correctness and
structure issues in a draft, then check relevant project terminology or source
locations before revising it.

## User Workflow

### Review Document

1. The user uploads or selects the current in-session document.
2. The user opens `Tools` and chooses `Review Document`.
3. The application runs a fixed set of checks and displays an issue list with
   severity, message, and line location when available.
4. The user may copy findings or ask the existing chat flow for help revising
   selected text. The tool does not alter the document itself.

First checks:

- Heading level skips, such as moving from `#` directly to `###`.
- Unclosed fenced code blocks.
- Empty Markdown link destinations.
- Duplicate headings that make anchors ambiguous.
- A configurable terminology list supplied in the current session, with
  preferred and avoided terms.

### Find Code References

1. The user enters a term, identifier, or short question.
2. The user chooses `Find Code References`.
3. The tool runs a bounded read-only query over the existing Graphify-backed
   project graph.
4. Results display matching names, source paths when available, and short
   context snippets suitable for citation while writing.

If no graph is available or no relevant match is found, the tool gives a clear
empty state rather than asking an AI model to invent context.

## Interaction Design

- Place a small `Tools` button beside the existing writing controls, opening a
  compact panel rather than a dashboard.
- Use a segmented control for `Review Document` and `Find Code References`.
- Show review findings in a scan-friendly list with severity icons and line
  labels.
- Show repository references as read-only results with copy actions.
- Keep chat generation separate: users explicitly choose when to send any
  findings or excerpts to an AI provider.

No tool runs automatically on upload, keystroke, page load, or timer.

## Technical Boundaries

### Allowed

- Deterministic parsing and lint-style checks in local application code.
- Active-session input already held in browser memory.
- Existing read-only knowledge-graph retrieval.
- Standard request IDs and structured error envelopes for any tool endpoint.
- Non-content operational telemetry such as tool name, success/failure, and
  latency if it contains no document text or query text.

### Not Allowed

- Autonomous planning, chained tool invocation, scheduled work, or background
  monitoring.
- Arbitrary shell commands, repository file writes, package installation, or
  browser-hosted Node/npm runtimes.
- WebContainer or a home-built equivalent.
- Durable storage of uploaded documents, tool findings that reproduce document
  text, graph queries containing user wording, or generated revisions.
- New account, billing, multi-tenant, email, or administrative dashboard work.

## Proposed Architecture

### Tool Registry

Define a fixed allowlist of user-invoked tools rather than exposing arbitrary
function calling:

```ts
type DocumentationToolId = 'document-review' | 'graph-lookup';
```

Each tool accepts a typed input, returns a typed result, and declares whether
it can transmit content externally. In this first slice both tools run without
new external content processors.

### Document Review Module

Add a small deterministic module, for example `src/lib/document-review.ts`,
which accepts content and optional terminology rules and returns findings:

```ts
interface DocumentFinding {
  rule: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  line?: number;
}
```

The checks should be pure functions so they can be tested without network
requests or storage.

### Graph Lookup Module

Wrap the existing `ensureGraph()` and `queryGraph()` path in a narrow,
read-only interface. Limit input length and output size. Do not persist query
text or use it in telemetry.

### UI Integration

Add a small tool panel to the existing chat workspace. Tool results live in
Svelte state only for the current page session and can be cleared by the user
or discarded on refresh.

## Privacy And Security

- Tool content and results stay in active page memory unless a user explicitly
  submits selected material through the existing chat action.
- No tool endpoint may write document, finding, or query content to KV,
  browser storage, logs, or analytics.
- Tool endpoints, if used, enforce existing input-size limits and provide
  `x-request-id`.
- Graph lookup must return bounded read-only context and never expose server
  configuration or diagnostic information.
- Error messages shown publicly are stable summaries, not raw backend errors.

## Error Handling

- No document selected: show `Select a document to review.` without a network
  call.
- Unsupported document format: show a clear supported-format message.
- Graph unavailable: show `Project reference index is unavailable right now.`
- Tool input over the limit: return a structured, non-retryable size error.
- Tool failure: leave the document and chat usable, with a retry action for
  the same user-invoked tool only.

## Test And Acceptance Plan

- Unit tests for every deterministic review rule, including multiple findings
  and empty input.
- Tests confirming graph lookup is read-only, bounded, and handles an
  unavailable graph without invented results.
- Privacy audit assertions confirming no new localStorage, IndexedDB, KV, or
  query-bearing log writes are introduced.
- API response tests for request IDs and structured safe failures if endpoints
  are introduced.
- UI verification that tools run only on explicit clicks, results clear in the
  open session, and compact/mobile layouts remain usable.
- Run the existing recorded `build:local` command before committing a shipped
  implementation slice.

## Deliberately Deferred

- Direct document editing, patch application, or repository writes.
- Multi-document project-wide linting.
- Export formats beyond copying a report in the open session.
- Automated API reference validation against live services.
- Autonomous agent loops, scheduled reviews, tool chaining, or custom runtime
  sandboxes.

## Success Criteria

The first implementation is successful when a user can explicitly review an
in-session draft and look up bounded project references, see useful structured
results, and remain in full control of whether any content is sent onward for
AI assistance, with no durable retention or arbitrary execution path added.
