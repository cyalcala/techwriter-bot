# Bounded Documentation Tool Pack

Date: 2026-06-04
Status: Started; glossary, API reference checker, and release-notes reviewer slices deployed; OpenAPI summary locally implemented

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

## Second Slice

Continue with API reference consistency because technical writers routinely
repeat endpoint references across conceptual docs, release notes, and reference
pages. The smallest useful implementation stays inside the existing
deterministic `Review Document` action.

The second slice should:

- Detect duplicate exact endpoint references such as `GET /v1/users`.
- Detect equivalent endpoint shapes that use different path-parameter names,
  such as `GET /v1/users/{userId}` and `GET /v1/users/{id}`.
- Report findings with source-line warnings.
- Reuse `reviewDocument()` and run only after the user clicks `Review`.
- Keep document text and findings in component memory only.
- Avoid network calls, OpenAPI fetching, schema validation services, KV writes,
  localStorage, IndexedDB, WebContainer, background work, and autonomous tool
  execution.

## Second Slice Acceptance Criteria

- Duplicate exact `METHOD /path` endpoint references are reported.
- Matching endpoint shapes with mismatched path-parameter names are reported.
- Endpoint checks do not require a saved OpenAPI file or live API call.
- Existing structural and glossary checks still work.
- UI remains compact and does not introduce a dashboard.
- Privacy tests continue to prove the tool panel performs no direct fetch or
  durable browser writes.

## Second Slice Deferred

- Full OpenAPI parsing.
- Live API validation.
- Schema diffing.
- Automatic reference rewrites.
- Saved client-wide API catalogs.

## Third Slice

Continue with release-notes draft review because it is a common technical
writing workflow and can be checked deterministically without asking an AI to
rewrite the document.

The third slice should:

- Detect release-note-like documents from headings such as `Release Notes`,
  `Changelog`, or standard release sections like `Added`, `Changed`, `Fixed`,
  `Deprecated`, `Removed`, and `Security`.
- Warn when release notes do not identify a release version or date.
- Warn when release notes still contain placeholder draft text such as `TODO`
  or `TBD`.
- Warn when breaking, removed, or deprecated entries do not include migration,
  upgrade, action-required, compatibility, or workaround guidance.
- Reuse `reviewDocument()` and run only after the user clicks `Review`.
- Keep document text and findings in component memory only.
- Avoid network calls, AI rewrites, release-management API calls, KV writes,
  localStorage, IndexedDB, WebContainer, background work, and autonomous tool
  execution.

## Third Slice Acceptance Criteria

- Release-note drafts with placeholders are reported with source lines.
- Release-note drafts without a version or date are reported.
- Breaking/removal/deprecation entries without migration guidance are reported.
- Ordinary setup guides with TODO text are not treated as release notes.
- Existing structural, glossary, and API-reference checks still work.
- UI remains compact and does not introduce a dashboard.

## Third Slice Deferred

- AI-generated release-note rewriting.
- Saved release-note templates.
- Integration with issue trackers or release-management systems.
- Client-wide release policy storage.

## Fourth Slice

Continue with an OpenAPI change-summary helper, starting with a bounded
operation inventory instead of full schema diffing. This gives writers a useful
source list for change summaries while staying deterministic and local.

The fourth slice should:

- Accept YAML/YML OpenAPI uploads in the existing document upload path.
- Detect OpenAPI YAML from `openapi:` or `swagger:` version markers.
- Extract a bounded method, path, summary, deprecated inventory from `paths:`.
- Show the operation inventory only after the user clicks `Review`.
- Keep document text and operation summaries in component memory only.
- Avoid live API validation, OpenAPI fetching, schema diffing, saved catalogs,
  KV writes, localStorage, IndexedDB, WebContainer, background work, and
  autonomous tool execution.

## Fourth Slice Acceptance Criteria

- OpenAPI YAML operations are summarized with method, path, source line,
  summary text, and deprecated state.
- The operation list is bounded.
- YAML/YML uploads are accepted by the document upload input.
- Existing structural, glossary, API-reference, and release-note checks still
  work.
- The tool panel performs no direct fetch or durable browser writes.
- UI remains compact and does not introduce a dashboard.

## Fourth Slice Deferred

- Comparing two OpenAPI versions.
- JSON OpenAPI parsing beyond future explicit follow-up work.
- Live API validation.
- Schema compatibility analysis.
- Saved client API catalogs.
