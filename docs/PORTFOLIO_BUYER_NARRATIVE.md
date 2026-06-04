# Portfolio And Buyer Narrative

Date: 2026-06-05
Status: Phase 5C initial collateral packet; screenshot checklist captured

This document turns the accepted Techwriter Bot product into a portfolio,
buyer, and recruiter narrative. It is external collateral only. It does not
create an in-app marketing page, SaaS platform, auth flow, billing system,
email system, autonomous agent, WebContainer runtime, complex dashboard, or
multi-tenant product.

## Positioning Summary

Techwriter Bot is a privacy-first documentation tooling engine for technical
writing teams. It combines AI chat, active-session document context, diagram
artifacts, source/code graph references, deterministic document review checks,
and export workflows in a client-owned Cloudflare deployment.

The cleanest positioning:

> I designed and shipped a privacy-first documentation tooling engine that
> helps technical-writing teams review documents, work with code context,
> produce artifacts, and preserve human control.

## Portfolio Case Study

### Project

Techwriter Bot: a client-owned AI writing and documentation tooling engine for
technical-writing teams.

### Problem

Technical writers often need to:

- understand unfamiliar product and API context quickly,
- review draft documentation against terminology, structure, API references,
  release-note requirements, and source-code reality,
- generate diagrams and artifacts without getting trapped in broken renderer
  loops,
- export work into the formats teams already use,
- use AI without turning client content into durable application storage.

Generic AI chat tools help with drafts, but they often miss the technical
writing workflow: citations, source references, document review, artifact
rendering, privacy boundaries, repeatable deployment, and production evidence.

### Constraints

- Solo developer.
- Cloudflare Pages/Workers/KV deployment model.
- Per-client isolated deployment instead of a multi-tenant SaaS.
- Near-zero ongoing infrastructure cost target.
- No OAuth, Stripe, email, Kubernetes, Redis, complex dashboards, autonomous
  background agents, or arbitrary browser package runtime tooling.
- Chat, uploaded document content, generated answers, search-result content,
  and rendered artifact content are not intentionally retained in durable
  application storage.

### What Was Built

Core product capabilities:

- AI chat with multi-provider routing, health checks, circuit/failover
  behavior, and app-version visibility.
- Active-session document RAG with filename, heading, and line citation
  metadata.
- Explicit JSON session export/import plus Markdown, Slack-format, and webhook
  export paths.
- Artifact generation and recovery with renderer error boundaries,
  source/SVG/PNG downloads, selected artifact regeneration, and mobile overlay
  handling.
- White-label app chrome through environment variables.
- Sample-data onboarding for demos without requiring client data.
- Phase 5A client deployment kit with setup, acceptance, demo, and support
  boundaries.
- Phase 5B bounded Documentation Tool Pack:
  - glossary compliance checker,
  - API reference consistency checker,
  - release-notes draft reviewer,
  - OpenAPI operation summary,
  - documentation coverage map from bounded graph references,
  - bounded code-area explanation from constrained source references.

### Why It Matters

The product is not only a chat app. It is a human-controlled tool agent for
documentation work. The user chooses when to run review, graph lookup, coverage
mapping, code-area explanation, Knowledge Base operations, artifact repair, and
exports. The system does not wake up, crawl repositories, mutate systems, run
arbitrary packages, or act in the background.

This makes the product easier to explain to privacy-sensitive documentation
teams: it gives writers more leverage without pretending that AI should own the
workflow.

### Evidence

Accepted implementation evidence:

- Phase 1 through Phase 4 are closure-verified and accepted.
- Phase 5A Client Deployment Kit is complete enough for pilots.
- Phase 5B Bounded Documentation Tool Pack is 100% closure-accepted for the
  planned scope.
- Latest production acceptance uses Cloudflare Pages production deployment
  `https://tw-bot.pages.dev`.
- Latest closure deploy evidence:
  - commit `a34f990`,
  - GitHub Actions run `26951419712`,
  - immutable URL `https://08e0cb57.tw-bot.pages.dev`,
  - runtime graph 1080 nodes and 1646 edges.
- Closure verification:
  - focused bounded-tool tests: 7 files, 46 tests,
  - full test suite: 43 files, 208 tests,
  - production audit: 0 high vulnerabilities,
  - recorded `build:local` gate passed with known non-failing warnings,
  - production graph smoke passed for all Phase 5B tool symbols,
  - real-browser Playwright CLI smoke confirmed the `Explain code area` flow.

## Buyer One-Pager

### Who It Is For

Technical-writing teams, developer experience teams, API documentation teams,
and documentation agencies that need a client-owned AI workspace for drafting,
reviewing, diagramming, and source-aware documentation workflows.

### Offer

A privacy-first AI documentation workspace deployed into the client's own
Cloudflare account, configured with the client's provider keys, brand voice,
and optional white-label app chrome.

### Buyer Pain

- Writers lose time switching between AI chat, docs, code, diagrams, and export
  tools.
- Generic AI output is hard to verify against actual product/source context.
- Documentation reviews often miss terminology drift, API reference
  inconsistencies, release-note gaps, and missing source coverage.
- Many AI tools blur content retention boundaries.
- Teams want AI leverage without committing to a multi-tenant SaaS or complex
  platform rollout.

### Product Promise

Techwriter Bot gives teams a bounded AI documentation engine that keeps humans
in control:

- chat when you want help drafting or explaining,
- upload documents for active-session context,
- review drafts deterministically,
- look up code/source references,
- map coverage against known source terms,
- explain a bounded code area for documentation,
- generate and recover artifacts,
- export work into team workflows.

### What The Client Owns

- Cloudflare project.
- Provider keys.
- Optional search keys.
- Client-specific `SYSTEM_PROMPT` and `PERSONA_NAME`.
- Brand title, logo URL, primary color, and footer text.
- Deployment evidence and acceptance checklist.

### What The App Does Not Do

- Does not provide OAuth or Stripe.
- Does not provide multi-tenancy.
- Does not send email.
- Does not run autonomous background agents.
- Does not run Kubernetes, Redis, or complex admin dashboards.
- Does not use WebContainer or arbitrary browser package execution.
- Does not intentionally retain chat, uploaded document content, generated
  answers, search-result content, or rendered artifact content in durable
  application storage.

## Recruiter And Client Summary

Short version:

> Built and shipped a privacy-first AI documentation tooling engine on
> Cloudflare Pages/Workers with Svelte/Astro. The product supports AI writing,
> active-session document RAG with citations, diagram/artifact workflows,
> source graph lookup, deterministic document review tools, export workflows,
> white-label configuration, and a client deployment kit.

Resume-friendly bullets:

- Designed a privacy-first AI documentation workspace for technical-writing
  teams using Astro, Svelte 5, Cloudflare Pages/Workers/KV, and multi-provider
  AI routing.
- Implemented active-session document context with filename, heading, and line
  citations while avoiding durable application storage of uploaded content.
- Built a bounded Documentation Tool Pack covering glossary compliance, API
  reference consistency, release-note review, OpenAPI operation summary,
  documentation coverage mapping, and code-area explanation.
- Added production deployment, health/version checks, Graphify knowledge graph
  publishing, GitHub Actions deployment evidence, and recovery docs for future
  AI/human maintainers.
- Created client deployment and acceptance runbooks for per-client Cloudflare
  pilots.

Interview talk track:

> The interesting part was not just adding AI chat. The hard part was designing
> useful boundaries: what should be deterministic, what should be user-invoked,
> what should never be stored durably, and what evidence a future maintainer
> needs. I treated the product like a documentation operations engine, not a
> generic chatbot.

## Before And After Workflow Story

### Before

A writer receives a product change, an API draft, and a release-note outline.
They ask a generic AI tool for help, then manually check terminology, inspect
API paths, look for code references, rebuild diagrams, copy content into
Markdown, and hope the tool did not invent source facts. If the team is
privacy-sensitive, every step also raises questions about where content went.

### After

The writer opens the client-owned Techwriter Bot deployment, loads sample or
client-provided docs into the active session, asks for a draft or explanation,
runs `Review Document`, applies glossary/API/release-note/OpenAPI checks, maps
documentation coverage, looks up or explains code areas from bounded graph
references, generates diagrams/artifacts, exports Markdown or a JSON session,
and keeps control over what is saved.

The workflow stays human-led. AI helps the writer move faster; it does not
silently crawl, rewrite, deploy, or retain client content.

## Demo Script

Use this for a 7 to 10 minute buyer or portfolio demo.

1. Open the production or client deployment.
2. Point out the privacy notice and active-session refresh/export boundary.
3. Click `Try sample data`.
4. Ask: `Summarize the sample API and release documentation workflow.`
5. Open `Tools`.
6. In `Review Document`, show the glossary area and run review on the loaded
   sample document.
7. Switch to `Find Code References`.
8. Run a bounded reference lookup for a known term, such as `sampleData` or
   `createCodeAreaExplanation`.
9. If a document is loaded, click `Map coverage`.
10. Type `createCodeAreaExplanation` and click `Explain code area`.
11. Ask for a small architecture diagram or workflow artifact.
12. Show artifact source and export controls.
13. Export the conversation as Markdown.
14. Close by explaining that client deployments use their own Cloudflare
    project and provider keys.

## Screenshot Checklist

Capture these screenshots for the portfolio or buyer deck. Do not add them as
an in-app marketing page.

Captured set: see `docs/PORTFOLIO_SCREENSHOT_MANIFEST.md`. Images are stored
under `output/playwright/phase-5c-portfolio/`.

Required screenshots:

- App shell with `Technical Writer`, privacy notice, and `Try sample data`.
- Empty session suggested prompts.
- Sample data loaded into the active session.
- Tools panel with `Review Document` selected.
- Glossary rules textarea.
- Document review findings or `No findings`.
- Tools panel with `Find Code References` selected.
- Bounded graph lookup result.
- Documentation coverage map result.
- `Explain code area` result for `createCodeAreaExplanation`.
- Artifact split view with a diagram rendered.
- Artifact source/export controls.
- Session export/import controls.
- `/api/health` response evidence with sanitized provider availability.
- GitHub Actions successful deployment run.

Optional screenshots:

- Mobile artifact overlay.
- White-label configuration example.
- Production graph lookup smoke output.
- `CLIENT_DEPLOYMENT_KIT.md` runbook excerpt.
- `AI_RECOVERY_TRAIL.md` recovery loop excerpt.

## Architecture Narrative

The architecture is deliberately boring where buyer trust matters:

- Cloudflare Pages hosts the app.
- Astro serves the application shell and server routes.
- Svelte 5 powers the chat, artifact, and document tool UI.
- Cloudflare KV stores content-free operational markers such as version,
  provider health, rate-limit state, and runtime graph payloads.
- AI provider routing is fault-tolerant and observable without exposing raw
  secrets or user content in public health responses.
- Uploaded source text and document tool findings remain in active page memory.
- Graph lookups return bounded source references and private no-store
  responses.
- Export is explicit and user-invoked.

The most important architecture decision is restraint. The product is useful
because it does not try to become a broad autonomous platform. It focuses on
repeatable, explicit documentation workflows that technical writers can trust.

## Objection Handling

### Is this just another chatbot?

No. Chat is one surface. The differentiator is the bounded documentation tool
pack: deterministic review checks, source graph lookup, coverage mapping,
code-area explanation, artifact workflows, and deployment evidence.

### Does it store client content?

The app is private by default. It does not intentionally retain chat,
uploaded document content, generated answers, search-result content, or
rendered artifact content in durable application storage. Some content is
processed by configured AI/search/rendering providers to fulfill user requests,
under those providers' terms.

### Why not build a multi-tenant SaaS?

The current strategy is per-client deployment. That keeps ownership, cost,
configuration, and privacy boundaries easier to explain for pilots.

### Why no autonomous agents?

Technical writers need control and reviewability. Bounded user-invoked tools
are more credible for documentation teams than silent background automation.

### What is left before paid pilots?

Core product behavior is not the blocker. Remaining work is external portfolio
assembly, client-specific onboarding, and a real-client credential pilot.

## Portfolio Page Outline

Use this outline in an external portfolio, LinkedIn feature section, or PDF.

1. Headline: Privacy-first AI documentation tooling engine.
2. One-sentence value prop.
3. Problem: technical writers need AI help they can verify and control.
4. Product walkthrough:
   - chat,
   - active-session documents,
   - document review,
   - code/source graph tools,
   - artifacts,
   - export.
5. Architecture and privacy boundary.
6. Evidence:
   - tests,
   - deploy runs,
   - production smoke,
   - graph counts,
   - recovery trail.
7. What this demonstrates about the builder:
   - technical writing judgment,
   - product thinking,
   - engineering collaboration,
   - AI workflow design,
   - deployment and verification discipline.
8. Call to action:
   - pilot deployment,
   - portfolio conversation,
   - technical-writing AI operations consulting.

## Next Collateral Steps

- Assemble the captured screenshot set into an external PDF or portfolio page.
- Build a short external PDF or portfolio page from this content.
- Prepare a 60-second spoken demo script.
- Prepare a 5-minute technical walkthrough.
- Run a real-client deployment when credentials are available.
