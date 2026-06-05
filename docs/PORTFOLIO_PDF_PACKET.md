# Techwriter Bot Portfolio Packet

Date: 2026-06-05
Status: Phase 5C external portfolio/PDF source assembled

This packet is the source copy for an external portfolio page, PDF, or buyer
deck. It is collateral only. It does not add an in-app marketing page, SaaS
platform, auth flow, billing system, email system, autonomous agent,
WebContainer runtime, complex dashboard, or multi-tenant product.

Generated/assembled assets:

- Printable HTML: `output/portfolio/techwriter-bot-portfolio-packet.html`
- PDF output target: `output/portfolio/techwriter-bot-portfolio-packet.pdf`
- Screenshot source set: `output/playwright/phase-5c-portfolio/`
- Screenshot manifest: `docs/PORTFOLIO_SCREENSHOT_MANIFEST.md`

## Cover

Title: Techwriter Bot

Subtitle: Privacy-first AI documentation tooling engine for technical-writing
teams.

Positioning statement:

> I designed and shipped a privacy-first documentation tooling engine that
> helps technical-writing teams review documents, work with code context,
> produce artifacts, and preserve human control.

Status:

- Phase 1 through Phase 4 roadmap: 100% closure-verified and accepted.
- Phase 5A Client Deployment Kit: complete enough for pilots.
- Phase 5B Bounded Documentation Tool Pack: 100% accepted for planned scope.
- Paid-pilot readiness: about 97%.
- Remaining work: client-specific onboarding and a real-client credential
  pilot.

## Case Study Summary

Technical writers need AI help that can be verified. They need to move between
drafts, source context, API references, release notes, diagrams, exports, and
deployment evidence without losing control of private content.

Techwriter Bot solves that by combining:

- AI chat with provider health and failover.
- Active-session document context with filename, heading, and line citations.
- Deterministic document review tools.
- Bounded source/code graph lookup.
- Documentation coverage mapping and code-area explanation.
- Artifact generation, recovery, and source/SVG/PNG export.
- Explicit session and Markdown export.
- Client-owned Cloudflare deployment.

The product is intentionally not an autonomous agent. Every tool is
user-invoked. It does not wake up, crawl repositories, mutate systems, run
arbitrary packages, or silently store client content.

## Screenshot Storyboard

Use the screenshot sequence below in a portfolio page or PDF.

1. App shell and active-session boundary:
   `output/playwright/phase-5c-portfolio/01-app-shell-empty-session.png`
2. Expanded privacy notice:
   `output/playwright/phase-5c-portfolio/13-privacy-notice-expanded-empty-session.png`
3. Sample data loaded:
   `output/playwright/phase-5c-portfolio/02-sample-data-loaded.png`
4. Review Document tool:
   `output/playwright/phase-5c-portfolio/03-tools-review-document.png`
5. Glossary rules:
   `output/playwright/phase-5c-portfolio/04-glossary-rules-textarea.png`
6. Review result:
   `output/playwright/phase-5c-portfolio/05-document-review-no-findings.png`
7. Bounded graph lookup:
   `output/playwright/phase-5c-portfolio/06-bounded-graph-lookup-result.png`
8. Documentation coverage map:
   `output/playwright/phase-5c-portfolio/07-documentation-coverage-map.png`
9. Code-area explanation:
   `output/playwright/phase-5c-portfolio/08-code-area-explanation-result.png`
10. Rendered artifact:
    `output/playwright/phase-5c-portfolio/09-artifact-split-view-rendered-diagram.png`
11. Artifact source/export controls:
    `output/playwright/phase-5c-portfolio/10-artifact-source-export-controls.png`
12. Health endpoint evidence:
    `output/playwright/phase-5c-portfolio/11-health-response-evidence.png`
13. GitHub Actions deployment evidence:
    `output/playwright/phase-5c-portfolio/12-github-actions-success-run.png`

## Portfolio Page Copy

### Headline

Privacy-first AI documentation tooling engine.

### Subhead

Built for technical-writing teams that need AI help they can verify, control,
deploy, and explain to privacy-sensitive clients.

### Body

Techwriter Bot is a client-owned AI documentation workspace built on
Cloudflare Pages/Workers, Astro, Svelte 5, and Cloudflare KV. It supports AI
writing, active-session document context, deterministic document review,
source graph lookup, documentation coverage mapping, diagram/artifact
workflows, export paths, and per-client deployment evidence.

The design choice that matters most is restraint. The system helps writers
move faster, but every tool is explicit and human-controlled. Chat messages,
uploaded document content, generated answers, search-result content, and
rendered artifact content are not intentionally retained in durable application
storage.

### What This Demonstrates

- Technical writing workflow judgment.
- AI product thinking for documentation teams.
- Practical engineering collaboration across Cloudflare, Astro, Svelte,
  GitHub Actions, tests, and production smoke verification.
- Privacy and retention boundary design.
- Ability to turn a working product into deployment, buyer, and maintenance
  documentation.

## Buyer One-Pager Copy

### Buyer Problem

Documentation teams are under pressure to use AI, but generic chat tools are
hard to verify against actual product/source context. They also raise content
retention questions and rarely match the review, artifact, and export workflows
technical writers need.

### Offer

A privacy-first AI documentation workspace deployed into the client's own
Cloudflare account, configured with the client's provider keys, brand voice,
and optional white-label app chrome.

### Core Capabilities

- Draft and explain technical content through AI chat.
- Load documents into active-session context with citations.
- Review drafts for terminology, structure, API reference consistency,
  release-note gaps, and OpenAPI operation summaries.
- Look up bounded source references from the project graph.
- Map documentation coverage and explain a constrained code area.
- Generate, repair, and export diagrams/artifacts.
- Export sessions and Markdown explicitly.
- Verify deployment health, provider availability, graph publishing, and app
  version status.

### Client Ownership

The client owns the Cloudflare project, provider keys, optional search keys,
brand voice, and deployment evidence. The current strategy is per-client
deployment, not a multi-tenant SaaS.

## 60-Second Demo Script

Techwriter Bot is a privacy-first AI documentation tooling engine for
technical-writing teams. It is not just a chatbot. In this demo, I start with
sample documentation, show the active-session privacy boundary, run document
review with glossary and API/release/OpenAPI checks, use bounded graph lookup
to connect docs to source context, map documentation coverage, explain a code
area, generate a workflow diagram, and export the result. The important design
choice is that every tool is user-invoked and reviewable. The product gives a
technical writer leverage without turning client content into durable
application storage or pretending an autonomous agent should own the workflow.

## Five-Minute Walkthrough

1. Open the app and point out the active-session refresh/export boundary.
2. Open the privacy notice and explain the retention model.
3. Click `Try sample data`.
4. Open `Tools` and run `Review Document`.
5. Add a glossary rule and show the deterministic review result.
6. Switch to `Find Code References`.
7. Run `createCodeAreaExplanation` lookup.
8. Click `Map coverage`.
9. Click `Explain code area`.
10. Ask for a small Mermaid workflow artifact.
11. Show rendered preview, source, and export controls.
12. Show `/api/health` and GitHub Actions evidence.
13. Close by explaining the per-client Cloudflare deployment model.

## Recruiter Summary

Built and shipped a privacy-first AI documentation tooling engine on
Cloudflare Pages/Workers with Astro and Svelte 5. The product supports AI
writing, active-session document RAG with citations, deterministic
documentation review tools, bounded source graph lookup, documentation
coverage mapping, code-area explanation, diagram/artifact workflows, export
features, white-label configuration, GitHub Actions deployment, and production
smoke evidence.

## Resume Bullets

- Designed a privacy-first AI documentation workspace for technical-writing
  teams using Astro, Svelte 5, Cloudflare Pages/Workers/KV, and multi-provider
  AI routing.
- Implemented active-session document context with filename, heading, and line
  citations while avoiding durable application storage of uploaded content.
- Built a bounded Documentation Tool Pack covering glossary compliance, API
  reference consistency, release-note review, OpenAPI operation summary,
  documentation coverage mapping, and code-area explanation.
- Added deployment, health/version checks, Graphify knowledge graph publishing,
  GitHub Actions evidence, and recovery docs for future AI/human maintainers.
- Created client deployment, acceptance, and portfolio collateral for
  per-client Cloudflare pilots.

## Evidence Block

- Production alias: `https://tw-bot.pages.dev`
- Screenshot evidence: `docs/PORTFOLIO_SCREENSHOT_MANIFEST.md`
- Latest screenshot evidence commit: `e11309e`
- Latest accepted CI run for screenshot evidence: `26981068018`
- Immutable URL: `https://5d5d86a0.tw-bot.pages.dev`
- Graphify CI: 1117 nodes and 1681 edges
- Production smoke: app `200`, health `ok`, 4 active providers out of 6,
  matching app version `0.0.1`

## What Remains

The current product is strong enough for portfolio presentation and paid-pilot
conversation. Remaining readiness work is:

- client-specific onboarding,
- a real-client credential deployment pilot,
- optional external PDF/page polish for a specific portfolio format.
