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
4. `graphify-out/GRAPH_REPORT.md`

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

## Recovery Prompt

Use this prompt when handing work to another AI agent:

```text
Continue from C:\Users\admin\Desktop\techwriter-bot. Read docs\MASTER_EXECUTION_PLAN.md, docs\IMPLEMENTATION_STATUS.md, docs\AI_RECOVERY_TRAIL.md, and graphify-out\GRAPH_REPORT.md first. Continue only from docs\IMPLEMENTATION_STATUS.md Next Task. Use the recorded build verification command when behavior changes. Preserve GitHub backups after each coherent slice. Do not rebuild OAuth, Stripe, multi-tenancy, email, marketing pages, autonomous agents, Kubernetes, Redis, complex dashboards, or WebContainer/runtime package tooling.
```
