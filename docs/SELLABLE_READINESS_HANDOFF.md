# Sellable Readiness Handoff

Date: 2026-06-04

This handoff summarizes where Techwriter Bot stands after the Phase 4 closure
acceptance. It is written for the user, future AI agents, and future maintainers
who need to understand what is ready to sell, what remains intentionally out of
scope, and what strategic phase should come next.

## Current Completion

- Approved Phase 1 through Phase 4 roadmap: 100% closure-verified and accepted.
- Phase 5A Client Deployment Kit: complete enough for pilots.
- Phase 5B Bounded Documentation Tool Pack: 100% closure-accepted for planned
  scope.
- Paid pilot readiness for a per-client Cloudflare deployment: about 94%.
- Broad tooling-agent vision: bounded human-controlled tool pack delivered;
  further expansion remains a next strategic phase, not a hidden requirement
  for the current sellable baseline.

The 94% paid-pilot estimate means the product is ready to demonstrate and sell
as a client-owned internal technical-writing engine, with explicit setup and
support expectations. The remaining 6% is not missing core product behavior;
it is mostly screenshot capture, client-specific onboarding, and a real-client
credential pilot.

## What Is Sellable Now

Techwriter Bot is now sellable as a privacy-first, per-client AI writing and
documentation tooling engine for technical-writing teams.

The strongest sellable capabilities are:

- Per-client deployment model on Cloudflare Pages/Workers/KV, designed for
  near-zero ongoing infrastructure cost.
- Privacy-first active-session boundaries: chat content, uploaded source text,
  generated answers, search-result content, and rendered artifact content are
  not intentionally retained in durable application storage.
- Multi-provider AI routing, sanitized health checks, circuit/failover behavior,
  app-version checks, and content-free operational telemetry.
- Bounded Documentation Tooling Agent foundation:
  - `Review Document` for deterministic structural and terminology checks on
    active uploaded source.
  - API reference consistency, release-notes draft, and OpenAPI operation
    summary checks in the same explicit review path.
  - `Find Code References` for user-invoked, read-only, bounded `src/` graph
    lookup.
  - Documentation coverage mapping and bounded code-area explanation from
    private graph references.
- Document RAG with filename, heading, and line metadata plus deterministic
  no-context handling when retrieval is weak or unavailable.
- Active-session Knowledge Base controls for multiple documents, document
  deletion, and user-invoked re-embedding.
- Artifact generation and recovery paths with parser hardening, renderer error
  boundaries, Kroki/server-render coverage, gallery controls, selected artifact
  regeneration, source/SVG/PNG downloads, and mobile overlay gestures.
- Conversation workflow for active-session history, JSON export/import,
  Markdown export, single-response export, Slack-format copy, and explicit
  webhook export.
- Client transparency footer and protected operational stats endpoint for
  content-free provider/token/latency visibility.
- White-label app chrome by environment variables: `APP_TITLE`,
  `APP_LOGO_URL`, `PRIMARY_COLOR`, and `FOOTER_TEXT`.
- Sample-data onboarding that lets a fresh deployment demonstrate value without
  requiring client data.
- Graceful degradation for KV telemetry pressure, embedding outage, live-search
  outage, Kroki/renderer failures, and page refresh/navigation.

## What It Is Not

The current product is intentionally not:

- A multi-tenant SaaS platform.
- An OAuth or Stripe product.
- An email system.
- A marketing website.
- An autonomous or background agent.
- A Kubernetes, Redis, or complex dashboard system.
- A WebContainer or arbitrary browser package runtime.
- A durable chat/document/content retention platform.

These exclusions are strengths for the current business model. They keep the
product deployable per client, understandable to buyers, cheaper to operate,
and safer for privacy-sensitive technical-writing workflows.

## Tooling-Agent Status

The product is already more than a chat app. It is a bounded tool agent in the
human-controlled sense:

- The user can invoke document review with glossary, API reference,
  release-notes, and OpenAPI operation checks.
- The user can invoke code-reference lookup, documentation coverage mapping,
  and bounded code-area explanation.
- The user can invoke Knowledge Base operations.
- The user can repair, regenerate, copy, and export artifacts.
- The user can export responses and conversations into downstream workflows.

It is not an autonomous agent. It does not wake up, crawl repositories, mutate
systems, run arbitrary packages, or take background actions. That boundary is
deliberate and should remain unless the product strategy changes in writing.

## Employability Impact

For the user as a technical writer, this project is strong portfolio evidence.
It shows the ability to:

- Translate technical-writing pain points into a working AI product.
- Own privacy and retention boundaries instead of treating them as vague
  promises.
- Build documentation workflows around source references, citations, artifacts,
  review tools, and export formats.
- Collaborate with engineering systems: Cloudflare, Svelte/Astro, tests,
  deployment automation, graph-based code understanding, and production smoke
  evidence.
- Speak credibly as a technical writer who can also design AI-enabled docs
  operations.

The most employable positioning is not "I used AI to write docs." It is:
"I designed and shipped a privacy-first documentation tooling engine that helps
technical-writing teams review documents, work with code context, produce
artifacts, and preserve human control."

## Recommended Next Strategic Phase

Phase 5A and Phase 5B are now complete enough for pilots. The next strategic
phase is Phase 5C unless real client credentials are available first.
The initial Phase 5C collateral packet is now recorded in
`docs/PORTFOLIO_BUYER_NARRATIVE.md`.
It is also production-accepted: docs commit `9a7ac29` deployed in GitHub
Actions run `26979426208`, immutable URL
`https://be36a3cd.tw-bot.pages.dev`; production app/health smoke passed and
Graphify CI reported 1112 nodes and 1677 edges.

### Phase 5A: Client Deployment Kit

Goal: make the current product easier to sell, install, verify, and support
without adding risky product scope.

Suggested deliverables:

- Client deployment checklist.
- Environment variable setup guide.
- Cloudflare Pages acceptance runbook.
- Production smoke script or manual QA checklist.
- Client demo script using sample data.
- Troubleshooting guide for provider keys, KV, health checks, graph lookup, and
  renderer failures.
- Support handoff explaining what is stored, what is not stored, and how active
  session export/import works.

Why first: this converts the already-built product into something repeatable for
real client pilots.

### Phase 5B: Bounded Documentation Tool Pack

Goal: deepen the tool-agent value while preserving user control.

Candidate user-invoked tools:

- API reference consistency checker.
- Release-notes draft reviewer.
- Terminology/glossary compliance checker.
- OpenAPI change-summary helper.
- Documentation coverage map from bounded graph references.
- "Explain this code area for docs" lookup that returns constrained source
  references instead of free-form repository crawling.

Rules:

- Keep every tool user-invoked.
- Keep source text in active page memory unless the user explicitly exports it.
- Do not add autonomous execution, background monitoring, arbitrary runtime
  packages, WebContainer, auth, billing, or multi-tenancy.

### Phase 5C: Portfolio And Buyer Narrative

Goal: turn the project into user-facing career and sales proof.

Suggested deliverables:

- Portfolio case study.
- Recruiter/client summary.
- Demo script.
- Screenshots checklist.
- Short technical architecture narrative.
- "Before and after" workflow story for technical-writing teams.

This can be done as documentation and external collateral. It does not require a
new in-app marketing page.

## Next Safe Task

Capture the screenshot checklist from `docs/PORTFOLIO_BUYER_NARRATIVE.md`, or
run a real-client deployment when credentials are available. Do not add an
in-app marketing page.
