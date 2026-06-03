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
5. `graphify-out/GRAPH_REPORT.md`

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

As of 2026-06-03:

- Latest behavior code backup: `b27ecff` (`fix: shed telemetry writes when KV
  is unavailable`), pushed to `origin/main`. The subsequent Phase 4 closure
  audit required no code changes.
- Behavior added: provider telemetry and aggregate token counter KV write
  failures shed with a content-free `TELEMETRY_SHED` operator notice; protected
  stats returns `telemetryAvailable: false` with the same notice when telemetry
  KV is unavailable.
- Verification evidence: focused red-green telemetry/stats tests, adjacent
  privacy/API guardrails, full `npm.cmd test` (42 files, 195 tests),
  production audit with 0 high vulnerabilities, `git diff --check`, and the
  recorded `build:local` command all passed.
- Deployment evidence: GitHub Actions run `26881378900` succeeded, immutable
  URL `https://d29e72c2.tw-bot.pages.dev` returned `200`; the follow-up
  docs/Graphify checkpoint deploy `26881676419` from `99e1410` also succeeded
  at `https://ee867432.tw-bot.pages.dev`. Production health was `ok` with app
  version `0.0.1`, and bounded graph lookup for `telemetry` returned 12 nodes
  with `Cache-Control: no-store, private`.
- Local Graphify after the code slice: 863 nodes and 1422 edges from
  `b27ecffd`; latest production runtime graph reported 999 nodes and 1559
  edges.
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
- Next safe task: if the user says to proceed with the recommendation, start
  Phase 5A Client Deployment Kit as a documentation/runbook slice. If the user
  chooses a different strategic phase, follow that choice. Do not start a new
  product feature without that next-phase direction.

## Recovery Prompt

Use this prompt when handing work to another AI agent:

```text
Continue from C:\Users\admin\Desktop\techwriter-bot. Read docs\MASTER_EXECUTION_PLAN.md, docs\IMPLEMENTATION_STATUS.md, docs\AI_RECOVERY_TRAIL.md, docs\SELLABLE_READINESS_HANDOFF.md, and graphify-out\GRAPH_REPORT.md first. Continue only from docs\IMPLEMENTATION_STATUS.md Next Task. Use the recorded build verification command when behavior changes. Preserve GitHub backups after each coherent slice. Do not rebuild OAuth, Stripe, multi-tenancy, email, marketing pages, autonomous agents, Kubernetes, Redis, complex dashboards, or WebContainer/runtime package tooling.
```
