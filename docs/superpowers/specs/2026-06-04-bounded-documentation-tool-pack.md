# Bounded Documentation Tool Pack

Date: 2026-06-04
Status: Started

## Goal

Extend Techwriter Bot from the accepted first tooling slice into a broader,
human-controlled documentation tool pack while preserving the existing
privacy-first active-session boundary.

This phase deepens the product as a tooling agent, not an autonomous agent. A
writer deliberately invokes each tool. No tool runs on a timer, no tool chains
actions behind the user's back, and no tool writes document content to durable
application storage.

## Phase 5B Tool Candidates

- Glossary compliance checker.
- API reference consistency checker.
- Release-notes draft reviewer.
- OpenAPI change-summary helper.
- Documentation coverage map from bounded graph references.
- Code-area explanation helper that returns constrained source references.

## First Slice

Start with glossary compliance because the existing deterministic
`Review Document` tool already accepts one session terminology preference. The
smallest useful upgrade is to let the user paste multiple glossary rules for
the current review.

The first slice should:

- Parse multiple active-session glossary rules from a textarea.
- Support simple `avoid -> prefer` style lines.
- Bound and de-duplicate rules before review.
- Reuse the existing deterministic `reviewDocument()` path.
- Keep source text, glossary text, and findings in component memory only.
- Avoid network calls, KV writes, localStorage, IndexedDB, WebContainer,
  background work, and autonomous tool execution.

## User Workflow

1. Upload or load a document into the active page session.
2. Open `Tools`.
3. Choose `Review Document`.
4. Paste one or more glossary rules.
5. Click `Review`.
6. Read line-specific findings and revise manually or choose to ask the chat
   for help.

## Acceptance Criteria

- Multiple glossary rules can be applied in one explicit review action.
- Invalid or blank glossary lines are ignored locally.
- Duplicate avoided terms keep the first rule.
- Terminology inside fenced code blocks is not flagged.
- Existing structural checks still work.
- UI remains compact and does not introduce a dashboard.
- Privacy tests continue to prove the tool panel performs no direct fetch or
  durable browser writes.

## Deferred

- Client-wide saved glossary configuration.
- Durable glossary storage.
- Organization-wide policy management.
- Automated document rewriting.
- Background review.
- AI-generated glossary suggestions.
