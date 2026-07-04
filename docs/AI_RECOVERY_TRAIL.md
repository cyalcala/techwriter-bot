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
6. `docs/PORTFOLIO_BUYER_NARRATIVE.md`
7. `docs/PORTFOLIO_SCREENSHOT_MANIFEST.md`
8. `docs/PORTFOLIO_PDF_PACKET.md`
9. `docs/superpowers/specs/2026-06-04-bounded-documentation-tool-pack.md`
10. `graphify-out/GRAPH_REPORT.md`

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

As of 2026-06-05:

- Latest behavior code backup: `4563754` (`feat: add bounded code area
  explanation`), pushed to GitHub on `main` with docs/Graphify checkpoint
  `41823f5`; Phase 5B closure audit accepted with no further code changes.
- Behavior added: `Find Code References` now exposes an explicit
  `Explain code area` action that accepts a small user-entered term, calls the
  existing private graph lookup endpoint after user click, and renders a
  compact source-reference explanation scaffold in active page memory.
- Verification evidence: focused red-green code-area/tool UI tests, adjacent
  privacy/document/tool/graph tests, full `npm.cmd test` (43 files, 208
  tests), production audit with 0 high vulnerabilities, forbidden-scope diff
  scan, `git diff --check`, and the recorded `build:local` command all passed
  before the code commit.
- Deployment evidence: GitHub Actions run `26950672782` passed, immutable URL
  `https://e70c3b39.tw-bot.pages.dev`; production alias and immutable URL both
  returned `200`, `ok` health with 4 active providers out of 6, matching app
  version `0.0.1`, and private bounded graph lookup for
  `createCodeAreaExplanation`.
- Local Graphify after the code-area explanation slice: 878 nodes and 1443
  edges from `4563754b`; latest accepted production runtime graph reports 1080
  nodes and 1646 edges.
- Closure evidence: focused bounded-tool tests passed (7 files, 46 tests);
  full `npm.cmd test` passed (43 files, 208 tests);
  `npm.cmd audit --omit=dev --audit-level=high` found 0 vulnerabilities;
  `git diff --check` was clean; the recorded `build:local` command passed with
  known non-failing warnings; production app/health smoke returned `200`, `ok`,
  4 active providers out of 6, and matching app version `0.0.1`; production
  graph smoke returned private no-store references for all Phase 5B tool
  symbols; Playwright CLI real-browser smoke confirmed the production
  `Explain code area` flow renders a bounded source-reference scaffold.
- Phase 5C initial collateral checkpoint: `docs/PORTFOLIO_BUYER_NARRATIVE.md`
  was added on 2026-06-05. It captures the portfolio case study, buyer
  one-pager, recruiter/client summary, before/after workflow story, demo
  script, screenshot checklist, architecture narrative, objection handling, and
  external portfolio outline. This is documentation/collateral only; it does
  not add an in-app marketing page or broaden product scope.
- Phase 5C collateral acceptance: docs commit `9a7ac29` deployed successfully
  in GitHub Actions run `26979426208`, immutable URL
  `https://be36a3cd.tw-bot.pages.dev`; Graphify CI uploaded a runtime graph
  with 1112 nodes and 1677 edges; production smoke confirmed the alias returns
  `200`, shows `Technical Writer` and `Try sample data`, `/api/health` returns
  `ok`, 4 active providers out of 6, expected/stored app version `0.0.1`, and
  no version mismatch.
- Phase 5C screenshot checkpoint: `docs/PORTFOLIO_SCREENSHOT_MANIFEST.md`
  records 13 production screenshots captured from the accepted deployment.
  Images are stored under `output/playwright/phase-5c-portfolio/` and cover the
  app shell, sample data, document review, glossary rules, bounded graph
  lookup, coverage map, code-area explanation, rendered artifact,
  source/export controls, health response evidence, and GitHub Actions success.
- Phase 5C portfolio/PDF checkpoint: `docs/PORTFOLIO_PDF_PACKET.md` records
  the external portfolio/PDF source copy. The assembled files are
  `output/portfolio/techwriter-bot-portfolio-packet.html`,
  `output/portfolio/techwriter-bot-portfolio-packet.pdf`, and
  `output/portfolio/techwriter-bot-portfolio-packet-preview.png`.
  Browser sanity confirmed the HTML packet loads screenshots and the only
  console issue during PDF generation was a missing localhost favicon.
- Diagram-rendering audit checkpoint: common AI-generated Mermaid syntax
  mistakes are normalized before queueing, export/source views, standalone
  artifact rendering, browser preview, and Kroki rendering. The repair covers
  extra `>` characters after labeled edges, escaped arrow entities, styled
  subgraph titles with spaces, Mermaid-like flowchart aliases, and
  Flowchart.js staying client-rendered instead of being misrouted to Kroki.
  Server-rendered diagram types now bypass optional browser CDN script loads
  and go straight to the Kroki-backed fallback path. Flowchart.js loads its
  browser renderer on demand only for true Flowchart.js syntax. Browser QA also
  found the standalone artifact route was missing the app stylesheet, so that
  route now imports `src/styles/global.css`. Browser QA also exposed that
  switching async diagrams from Code back to Preview could leave a stale
  placeholder, so the Preview control now re-triggers rendering. Mobile QA
  found Mermaid's generated `width="100%"` SVG output was shrinking wide
  diagrams into an unreadable strip, so rendered diagram SVGs now preserve
  intrinsic width and strip embedded Mermaid `max-width` CSS so they scroll
  horizontally on small screens, with flex shrink disabled for rendered diagram
  SVGs and scroll position starting at the beginning of the diagram. Local
  verification passed: focused
  diagram/artifact tests (8 files, 51 tests) before the
  Flowchart.js endpoint correction, then focused parser/renderer/standalone/
  mobile regression tests after the interaction and mobile readability fixes (5
  files, 41 tests), full `npm.cmd test` (44 files, 218 tests), then focused
  flex-shrink regression tests (5 files, 42 tests) and full `npm.cmd test` (44
  files, 219 tests), `npm.cmd audit
  --omit=dev --audit-level=high` (0 vulnerabilities), `git diff --check`, and
  the recorded `build:local` command with known non-failing warnings. Local
  Graphify refresh reports 894 nodes and 1489 edges. Production acceptance for
  commit `1eec50d` passed in GitHub Actions run `27021251021`, immutable URL
  `https://16502d06.tw-bot.pages.dev`; Graphify CI reported 1156 nodes and
  1759 edges. Production smoke confirmed the alias and immutable URL return
  `200`, `/api/health` returns `ok`, the broken BPO Mermaid sample from the
  screenshot renders SVG without syntax errors after one retryable Kroki
  timeout, pure Flowchart.js API requests return a non-retryable client-rendered
  response, Mermaid-like flowchart aliases render SVG, and real Chrome
  Playwright browser QA passed on desktop `1440x900` and mobile `390x844` with
  styled standalone artifacts, Code -> Preview recovery, no artifact error
  panel, and horizontally scrollable wide diagrams.
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
  progress updates: approved Phase 1 through Phase 4 roadmap is 100%
  accepted; Phase 5A is complete enough for pilots; Phase 5B is
  closure-accepted; paid-pilot readiness is about 97%.
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
- Phase 5B coverage-map local code checkpoint: `57969f9` adds
  `extractDocumentationCoverageTerms()` and an explicit `Map coverage` action
  to the existing user-invoked `Find Code References` path. The action extracts
  at most six active-document terms locally and checks them with bounded
  `POST /api/tool-graph-lookup` calls, without sending the full document or
  adding durable user-content storage.
- Verification for `57969f9`: focused document-review/tool UI tests passed
  after red-green implementation (2 files, 20 tests); adjacent
  privacy/document/tool tests passed (5 files, 41 tests); full `npm.cmd test`
  passed (42 files, 206 tests); `npm.cmd audit --omit=dev --audit-level=high`
  found 0 vulnerabilities; `git diff --check` reported only known CRLF
  warnings; and the recorded `build:local` command passed with known
  non-failing `Drive already SUBSTed`, `punycode`, and Cloudflare local
  AI-binding warnings.
- Local Graphify after `57969f9`: 872 nodes and 1436 edges from commit
  `57969f9f`; `extractDocumentationCoverageTerms()` appears in the
  document-review community.
- Phase 5B coverage-map production acceptance: docs/Graphify checkpoint
  `5927615` deployed in GitHub Actions run `26949729477`, immutable URL
  `https://1e721488.tw-bot.pages.dev`; production alias returned `200`,
  `/api/health` returned `ok` with 4 active providers out of 6 and matching app
  version `0.0.1`, the immutable URL returned `200` and `ok` health with 4
  active providers out of 6, and bounded graph lookup for
  `extractDocumentationCoverageTerms` returned 1 node with `Cache-Control:
  no-store, private` on both targets.
- Phase 5B code-area explanation local code checkpoint: `4563754` adds
  `createCodeAreaExplanation()` and an explicit `Explain code area` action to
  the existing user-invoked `Find Code References` path. It converts bounded
  graph lookup context into a compact source-reference explanation scaffold,
  without AI rewriting, autonomous traversal, or durable user-content storage.
- Verification for `4563754`: focused code-area/tool UI tests passed after
  red-green implementation (2 files, 6 tests); adjacent
  privacy/document/tool/graph tests passed (7 files, 46 tests); full
  `npm.cmd test` passed (43 files, 208 tests);
  `npm.cmd audit --omit=dev --audit-level=high` found 0 vulnerabilities;
  forbidden-scope diff scan found no forbidden additions; `git diff --check`
  reported only known CRLF warnings; and the recorded `build:local` command
  passed with known non-failing `Drive already SUBSTed`, `punycode`, and
  Cloudflare local AI-binding warnings.
- Local Graphify after `4563754`: 878 nodes and 1443 edges from commit
  `4563754b`; `createCodeAreaExplanation()` appears in the code-area
  explanation community.
- Phase 5B code-area explanation production acceptance: docs/Graphify
  checkpoint `41823f5` deployed in GitHub Actions run `26950672782`, immutable
  URL `https://e70c3b39.tw-bot.pages.dev`; production alias returned `200`,
  `/api/health` returned `ok` with 4 active providers out of 6 and matching app
  version `0.0.1`, the immutable URL returned `200` and `ok` health with 4
  active providers out of 6, and bounded graph lookup for
  `createCodeAreaExplanation` returned 1 node with `Cache-Control: no-store,
  private` on both targets.
- Phase 5B closure audit acceptance: focused bounded-tool tests passed (7
  files, 46 tests); full test suite passed (43 files, 208 tests); production
  audit found 0 high vulnerabilities; `git diff --check` was clean; the
  recorded build passed; production health and graph smoke passed for all
  Phase 5B tool symbols; and real-browser Playwright CLI smoke confirmed the
  code-area explanation UI flow.
- Next safe task (superseded below by an urgent mobile bug report): return to
  client-specific onboarding or run a real-client deployment when credentials
  are available. The diagram-rendering audit is production-accepted. The
  Phase 5C collateral packet, screenshot checklist, and external
  portfolio/PDF packet are already assembled. Do not start
  autonomous/background tools, WebContainer/runtime package tooling, auth,
  billing, multi-tenancy, email, marketing pages, Kubernetes, Redis, or
  complex dashboards.

## Latest Checkpoint (2026-07-04) — Mobile Bug Audit, In Progress

User reported `https://tw-bot.pages.dev/` "does not work on mobile" and
requested a full audit/debug/refine pass with GitHub-backed documentation.
Full detail is in `docs/MOBILE_AUDIT_2026-07-04.md` — read that file first,
this is only the checkpoint summary.

- **No code changes yet.** This checkpoint is research + attempted
  reproduction only.
- Confirmed (again) that the local `astro dev` Cloudflare/Miniflare server
  hangs on startup in this sandbox after the "AI bindings always access
  remote resources" warning and never binds its port. This matches the
  already-recorded "Cloudflare local preview issue" caveat in
  `docs/IMPLEMENTATION_STATUS.md` — treat it as a known environment
  limitation, not a new regression, and do not re-litigate it; use
  production-URL reproduction instead (Playwright CLI or the
  `claude-in-chrome` MCP tools), the same way Phase 4's mobile smoke was
  originally done.
- Chrome browser MCP tools were not connected this session
  ("Claude in Chrome is not connected") — retry needed before a live
  reproduction can happen.
- Static re-read of the mobile-relevant code (`ChatIsland.svelte`,
  `ArtifactOverlay.svelte`, `ArtifactPanel.svelte`, `ArtifactSplitView.svelte`,
  `ArtifactStandalone.svelte`, `global.css`,
  `src/tests/mobile-artifacts.test.ts`) found the previously-accepted
  viewport/scroll-lock/pinch-zoom/swipe-dismiss work still intact, but
  surfaced five unconfirmed candidate gaps, ranked in
  `docs/MOBILE_AUDIT_2026-07-04.md`: (1) `mobile-artifacts.test.ts` is
  static source-pattern verification only, not a real rendered-interaction
  test, so a live regression could pass CI; (2) mobile detection
  (`window.innerWidth < 768`) has no `orientationchange`/`matchMedia`
  listener, only `resize`; (3) the chat input textarea has no explicit
  max-height, so a long message could grow it unbounded on a small screen;
  (4) swipe-dismiss geometry doesn't appear to account for
  `env(safe-area-inset-*)` on notched devices; (5) `public/_headers` sets
  `Cross-Origin-Embedder-Policy: credentialless` alongside third-party
  script allowances (esm.sh, unpkg, jsdelivr, cdnjs) for the diagram
  renderers — COEP/COOP enforcement differs across mobile browser engines
  and is a plausible candidate for a mobile-only silent asset-load failure,
  but is unconfirmed without a real console/network trace.
- Next task: reproduce for real against `https://tw-bot.pages.dev/` at a
  phone viewport (do not guess-fix), read console/network for CSP
  violations or JS errors, confirm one root cause, then fix, verify, and
  update this file plus `docs/IMPLEMENTATION_STATUS.md` with the commit hash
  and evidence per the existing format.

### Session 2 update (2026-07-04 afternoon) — reproduction achieved, root cause evidenced

- User confirmed the symptom: chat reports **"no AI available" on mobile**
  (recorded in `docs/MOBILE_AUDIT_2026-07-04.md` "Confirmed Symptom").
- A real mobile-viewport reproduction now works WITHOUT the Chrome
  extension or local dev: `scripts/mobile-repro.mjs` (playwright-core from
  the npx cache + system Chrome, `channel: 'chrome'`, headless, 390x844
  touch emulation). Evidence under
  `output/playwright/mobile-audit-2026-07-04/`.
- Result: load, hydration, layout, typing, sending, and AI reply all
  **worked** in emulated mobile Chrome with zero console/network errors —
  the UI is not the failure. The reply only arrived after visible
  provider **failover** (groq → cerebras → gemini badges).
- **Root-cause evidence:** `GET /api/health` on production shows **4 of 6
  providers down** — cerebras 403, groq 403 (bad/revoked keys), gemini 429
  (quota), cloudflare-llama binding erroring (status null); only nvidia +
  openrouter healthy. When those two blip, `zen-router.ts` returns
  `AI_PROVIDERS_UNAVAILABLE` — exactly the user's symptom. Snapshot:
  `output/playwright/mobile-audit-2026-07-04/health-snapshot-2026-07-04.json`.
- Secondary iOS-only lead (unfixed): 15px chat-input font triggers iOS
  Safari auto-zoom-on-focus; recommend 16px on mobile.
- Still **no app code changes** — user requested a checkpoint here. The
  prioritized fix list is in `docs/MOBILE_AUDIT_2026-07-04.md` "What
  remains for the fix session" (run `scripts/mobile-repro2.mjs` first,
  then fix the cloudflare-llama binding, rotate Cerebras/Groq keys, trace
  the Turnstile/CSP gate, apply the 16px fix, then the Session-1
  refinements).
- **New pending task captured:** video + presentation generation upgrade
  (presenton/OpenMontage research → strategy → architecture), briefed in
  `docs/VIDEO_PRESENTATION_UPGRADE_BRIEF.md`. Not started; mobile fix
  takes priority.

## Recovery Prompt

Use this prompt when handing work to another AI agent:

```text
Continue from C:\Users\admin\Downloads\techwriter-bot (this project has moved
location before, e.g. previously referenced under C:\Users\admin\Desktop —
verify the working path is correct before running commands). Read
docs\MOBILE_AUDIT_2026-07-04.md first — it has the active task. Then read
docs\MASTER_EXECUTION_PLAN.md, docs\IMPLEMENTATION_STATUS.md,
docs\AI_RECOVERY_TRAIL.md (this file's "Latest Checkpoint (2026-07-04)"
section), docs\SELLABLE_READINESS_HANDOFF.md, docs\CLIENT_DEPLOYMENT_KIT.md,
docs\PORTFOLIO_BUYER_NARRATIVE.md, docs\PORTFOLIO_SCREENSHOT_MANIFEST.md,
docs\PORTFOLIO_PDF_PACKET.md, docs\superpowers\specs\2026-06-04-bounded-documentation-tool-pack.md,
and graphify-out\GRAPH_REPORT.md for standing project context. The active,
user-requested task is the mobile bug audit/fix in
docs\MOBILE_AUDIT_2026-07-04.md — reproduce against the live production URL
(local `astro dev` is known-blocked in this sandbox, do not re-debug that),
confirm a root cause with real evidence, then fix, verify, and update the
docs per the existing format before pushing. Preserve GitHub backups after
each coherent slice. Do not rebuild OAuth, Stripe, multi-tenancy, email,
marketing pages, autonomous agents, Kubernetes, Redis, complex dashboards, or
WebContainer/runtime package tooling.
```
