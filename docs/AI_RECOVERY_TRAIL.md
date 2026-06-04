# AI Recovery Trail

This file defines the documentation and GitHub backup mechanism that keeps the
project fixable by any future AI agent or human maintainer.

## Purpose

Every meaningful implementation move must leave enough context in GitHub to
answer four questions without relying on chat history:

- What changed?
- Why was that choice made?
- How was it verified?
- What should the next agent do next?

## Canonical Recovery Files

Start every recovery pass by reading, in this order:

1. `docs/MASTER_EXECUTION_PLAN.md`
2. `docs/IMPLEMENTATION_STATUS.md`
3. `docs/AI_RECOVERY_TRAIL.md`
4. `docs/SELLABLE_READINESS_HANDOFF.md`
5. `docs/CLIENT_DEPLOYMENT_KIT.md`
6. `docs/superpowers/specs/2026-06-04-bounded-documentation-tool-pack.md`
7. `graphify-out/GRAPH_REPORT.md`

These files are the standing handoff packet. Chat transcripts are useful, but
GitHub is the source of truth.

## Required Backup Loop

For every coherent slice of work:

1. Make the smallest useful code or documentation change.
2. Run the relevant targeted tests first.
3. Run the recorded verification gate when behavior changes.
4. Commit the code slice with a descriptive message.
5. Run `graphify update .` after code changes that alter project structure.
6. Update the handoff docs with:
   - decision or behavior change,
   - commit hash,
   - verification commands and results,
   - Graphify node and edge counts when refreshed,
   - deployment run id and immutable URL when deployed,
   - production smoke evidence when available,
   - the exact next task.
7. Commit the docs/Graphify checkpoint separately when practical.
8. Push to GitHub.
9. Watch GitHub Actions and record production acceptance in the docs when the
   change deploys.
10. Push the production-acceptance docs checkpoint.

## Required Evidence

Each meaningful status update should preserve:

- local verification command names and pass/fail results,
- `npm.cmd test` totals when run,
- `npm.cmd audit --omit=dev --audit-level=high` result when run,
- recorded `build:local` result when run,
- GitHub Actions run id,
- immutable Cloudflare Pages URL,
- production alias smoke result,
- bounded graph lookup result when relevant.

## Decision Trail Rules

- Record product decisions in `docs/MASTER_EXECUTION_PLAN.md` when they affect
  scope, architecture, privacy, deployment, or business direction.
- Record implementation progress and next tasks in
  `docs/IMPLEMENTATION_STATUS.md`.
- Add a dedicated ADR under `docs/decisions/` only when a decision would be
  expensive to reverse or needs alternatives captured in detail.
- Never hide important rationale only in chat.
- Never leave the repo in a state where a fresh agent has to guess the next
  safe task.

## Scope Guardrails

Unless the user explicitly changes strategy in writing, do not rebuild:

- OAuth
- Stripe
- Multi-tenancy
- Email
- Marketing pages
- Autonomous or background agents
- Kubernetes
- Redis
- Complex dashboards
- WebContainer or arbitrary browser package runtime tooling

## Latest Checkpoint

As of 2026-06-04:

- Latest behavior code backup: `8f1e6bf` (`feat: add openapi operation summary
  review`), pushed to `origin/main` with docs/Graphify checkpoint `6b82b34`.
- Behavior added: `Review Document` now shows a bounded active-session OpenAPI
  operation summary for uploaded YAML/YML OpenAPI documents after the user
  clicks `Review`, using local parsing only.
- Verification evidence: focused red-green document-review/tool UI tests,
  adjacent privacy/document/tool tests, full `npm.cmd test` (42 files, 204
  tests),
  production audit with 0 high vulnerabilities, `git diff --check`, and the
  recorded `build:local` command all passed before the code commit.
- Deployment evidence: GitHub Actions run `26948498789` succeeded from
  docs/Graphify checkpoint `6b82b34`, immutable URL
  `https://9dde1140.tw-bot.pages.dev`; Graphify CI uploaded the runtime graph
  with 1060 nodes and 1621 edges. Production alias and immutable URL returned
  `200`, health `ok`, matching app version `0.0.1`, and private bounded graph
  lookup for `summarizeOpenApiOperations`.
- Local Graphify after the OpenAPI code slice: 869 nodes and 1431 edges from
  `8f1e6bff`; latest accepted production runtime graph reports 1060 nodes and
  1621 edges.
- Kroki/artifact-renderer-down audit: existing renderer tests and production
  render API smoke cover private standardized route failures, transient Kroki
  retry, permanent syntax no-retry, sanitized SVG success, and visible
  retry/View code artifact recovery controls.
- Phase 4 closure audit: focused Phase 4 tests, full test suite, production
  audit, `git diff --check`, the recorded `build:local` command, production
  app/health smoke, bounded graph lookups, and a real mobile overlay
  import/pinch/swipe smoke all passed. The real mobile smoke used Playwright
  CLI against production at 390x844 with a synthetic session artifact and left
  no local helper files behind.
- Phase 4 closure acceptance: docs commit `de89ee3` deployed successfully in
  GitHub Actions run `26883014551`, immutable URL
  `https://4a3cfc7d.tw-bot.pages.dev`; final production smoke returned `200`
  for the app shell and `ok` health with four active providers, app version
  `0.0.1`, and no version mismatch.
- Readiness handoff: `docs/SELLABLE_READINESS_HANDOFF.md` now records the
  post-Phase-4 sellability summary, intentional exclusions, tooling-agent
  status, employability positioning, and Phase 5 options. Use this framing for
  progress updates: approved Phase 1 through Phase 4 roadmap is 100% accepted;
  paid-pilot readiness is about 90%.
- Phase 5A deployment kit: `docs/CLIENT_DEPLOYMENT_KIT.md` now records the
  client setup checklist, environment guide, per-client `deploy.sh` path,
  existing GitHub Actions caveat, production acceptance runbook, demo script,
  troubleshooting map, support boundary, and evidence checklist.
- Phase 5A self-client dry run: docs checkpoint `64d43e5` deployed
  successfully in GitHub Actions run `26883926741`, immutable URL
  `https://2482adc7.tw-bot.pages.dev`; Graphify CI uploaded the runtime graph.
  Production alias `https://tw-bot.pages.dev` returned `200`, contained
  `Technical Writer`, `Try sample data`, the active-session notice, and the
  privacy notice. `/api/health` returned `ok`, 4 active providers out of 6,
  expected/stored app version `0.0.1`, and mismatch `false`. Bounded graph
  lookup for `sampleData` returned 2 nodes with `Cache-Control: no-store,
  private`; Graphviz render smoke returned SVG with `Cache-Control: no-store,
  private`. The immutable URL also returned `200` and `ok` health with matching
  app version.
- Phase 5B local code checkpoint: `8bce438` (`feat: add glossary review
  rules`) starts the Bounded Documentation Tool Pack with a deterministic
  glossary-compliance upgrade to `Review Document`. The new
  `parseTerminologyRules()` helper parses compact `avoid -> prefer`,
  `avoid => prefer`, or `avoid | prefer` lines, bounds the active-session rules,
  de-duplicates avoided terms, and reuses `reviewDocument()` only after the
  user clicks `Review`.
- Verification for `8bce438`: focused document review/tool UI tests passed
  after red-green implementation (2 files, 11 tests); adjacent
  privacy/document tests passed (5 files, 32 tests); full `npm.cmd test` passed
  (42 files, 197 tests); `npm.cmd audit --omit=dev --audit-level=high` found 0
  vulnerabilities; `git diff --check` had only known CRLF warnings; and the
  recorded `build:local` command passed with known non-failing `punycode` and
  Cloudflare local AI-binding warnings.
- Local Graphify after `8bce438`: 865 nodes and 1426 edges from commit
  `8bce4389`; `parseTerminologyRules()` now appears in the document-review
  community with `reviewDocument()`.
- Phase 5B glossary production acceptance: docs/Graphify checkpoint `148c100`
  deployed successfully in GitHub Actions run `26913659132`, immutable URL
  `https://6bff987e.tw-bot.pages.dev`; Graphify CI uploaded the runtime graph.
  Production alias and immutable URL returned `200`, `/api/health` returned
  `ok` with 4 active providers out of 6 and matching app version `0.0.1`, and
  bounded graph lookup for `parseTerminologyRules` returned 1 node with
  `Cache-Control: no-store, private`. A real Playwright CLI smoke opened the
  immutable production app, clicked `Try sample data`, opened `Tools`,
  confirmed the `Glossary rules` textarea, filled `whitelist -> allowlist`,
  clicked `Review`, and saw `1 glossary rule applied.` plus `No findings.`
  The sample-data click also showed two embedding-failure messages before
  loading `sample-release-process.md`; this did not block the glossary flow and
  should be treated as a graceful-degradation demo caveat.
- Phase 5B API-checker local code checkpoint: `8e6de7d` adds deterministic
  API reference review rules to the existing user-invoked `reviewDocument()`
  path. The checker reports duplicate `METHOD /path` endpoint references and
  equivalent endpoint shapes that use different `{pathParameter}` names, with
  source-line warnings.
- Verification for `8e6de7d`: focused document-review tests passed after
  red-green implementation (1 file, 9 tests); adjacent privacy/document/tool
  tests passed (5 files, 34 tests); full `npm.cmd test` passed (42 files, 199
  tests); `npm.cmd audit --omit=dev --audit-level=high` found 0
  vulnerabilities; `git diff --check` reported only known CRLF warnings; and
  the recorded `build:local` command passed with known non-failing `punycode`,
  already substituted `T:`, and Cloudflare local AI-binding warnings.
- Local Graphify after `8e6de7d`: 867 nodes and 1428 edges from commit
  `8e6de7d6`.
- Phase 5B API-checker production acceptance: docs/Graphify checkpoint
  `6e9609d` deployed in GitHub Actions run `26947031364`, immutable URL
  `https://78e4ed6c.tw-bot.pages.dev`; production alias returned `200`,
  `/api/health` returned `ok` with 4 active providers out of 6 and matching
  app version `0.0.1`, the immutable URL returned `200` and `ok` health with 3
  active providers out of 6, and bounded graph lookup for `extractApiEndpoint`
  returned 1 node with `Cache-Control: no-store, private` on both targets.
- Phase 5B release-notes local code checkpoint: `72efda6` adds deterministic
  release-note draft checks to the existing user-invoked `reviewDocument()`
  path. Release-note-like documents now warn about missing release version/date
  identity, placeholder draft text, and breaking/removal/deprecation notes that
  lack migration or action-required guidance.
- Verification for `72efda6`: focused document-review tests passed after
  red-green implementation (1 file, 12 tests); adjacent privacy/document/tool
  tests passed (5 files, 37 tests); full `npm.cmd test` passed (42 files, 202
  tests); `npm.cmd audit --omit=dev --audit-level=high` found 0
  vulnerabilities; `git diff --check` reported only known CRLF warnings; and
  the recorded `build:local` command passed with known non-failing `Drive
  already SUBSTed`, `punycode`, and Cloudflare local AI-binding warnings.
- Local Graphify after `72efda6`: 867 nodes and 1428 edges from commit
  `72efda60`.
- Phase 5B release-notes production acceptance: docs/Graphify checkpoint
  `f8073ab` deployed in GitHub Actions run `26947748180`, immutable URL
  `https://dad791b6.tw-bot.pages.dev`; production alias returned `200`,
  `/api/health` returned `ok` with 3 active providers out of 6 and matching
  app version `0.0.1`, the immutable URL returned `200` and `ok` health with 4
  active providers out of 6, and bounded graph lookup for
  `release notes reviewDocument` returned 3 nodes with `Cache-Control:
  no-store, private` on both targets.
- Phase 5B OpenAPI local code checkpoint: `8f1e6bf` adds
  `summarizeOpenApiOperations()` and an active-session OpenAPI summary display
  to the existing user-invoked `Review Document` path. It accepts YAML/YML
  uploads and extracts a bounded method/path/summary/deprecated operation
  inventory locally, without live API validation, schema diffing, saved
  catalogs, or durable user-content storage.
- Verification for `8f1e6bf`: focused document-review/tool UI tests passed
  after red-green implementation (2 files, 18 tests); adjacent
  privacy/document/tool tests passed (5 files, 39 tests); full `npm.cmd test`
  passed (42 files, 204 tests); `npm.cmd audit --omit=dev --audit-level=high`
  found 0 vulnerabilities; `git diff --check` reported only known CRLF
  warnings; and the recorded `build:local` command passed with known
  non-failing `Drive already SUBSTed`, `punycode`, and Cloudflare local
  AI-binding warnings.
- Local Graphify after `8f1e6bf`: 869 nodes and 1431 edges from commit
  `8f1e6bff`; `summarizeOpenApiOperations()` appears in the document-review
  community.
- Phase 5B OpenAPI production acceptance: docs/Graphify checkpoint `6b82b34`
  deployed in GitHub Actions run `26948498789`, immutable URL
  `https://9dde1140.tw-bot.pages.dev`; production alias returned `200`,
  `/api/health` returned `ok` with 4 active providers out of 6 and matching app
  version `0.0.1`, the immutable URL returned `200` and `ok` health with 3
  active providers out of 6, and bounded graph lookup for
  `summarizeOpenApiOperations` returned 1 node with `Cache-Control: no-store,
  private` on both targets.
- Next safe task: continue Phase 5B with a documentation coverage map unless
  the user redirects. Do not start autonomous/background tools,
  WebContainer/runtime package tooling, auth, billing, multi-tenancy, email,
  marketing pages, Kubernetes, Redis, or complex dashboards.

## Recovery Prompt

Use this prompt when handing work to another AI agent:

```text
Continue from C:\Users\admin\Desktop\techwriter-bot. Read docs\MASTER_EXECUTION_PLAN.md, docs\IMPLEMENTATION_STATUS.md, docs\AI_RECOVERY_TRAIL.md, docs\SELLABLE_READINESS_HANDOFF.md, docs\CLIENT_DEPLOYMENT_KIT.md, docs\superpowers\specs\2026-06-04-bounded-documentation-tool-pack.md, and graphify-out\GRAPH_REPORT.md first. Continue only from docs\IMPLEMENTATION_STATUS.md Next Task. Use the recorded build verification command when behavior changes. Preserve GitHub backups after each coherent slice. Do not rebuild OAuth, Stripe, multi-tenancy, email, marketing pages, autonomous agents, Kubernetes, Redis, complex dashboards, or WebContainer/runtime package tooling.
```
