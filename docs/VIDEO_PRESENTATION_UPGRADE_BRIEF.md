# Video + Presentation Generation Upgrade — Task Brief (2026-07-04)

Status (2026-07-05): **DECIDED — see `docs/VIDEO_PRESENTATION_STRATEGY.md`.**
**Video is PARKED** (deliberate user decision — do not resume without an
explicit user request; resume point is the "Remaining research" section
of `docs/VIDEO_PRESENTATION_RESEARCH_NOTES.md`). **Presentations are
being implemented** as a `deck` artifact type per the strategy doc's
approved v1 parameters. Research evidence:
`docs/VIDEO_PRESENTATION_RESEARCH_NOTES.md` (presenton + OpenMontage
deep-dives complete; 4 dimensions intentionally left unfinished when
video was parked).

## User Request (verbatim intent)

Integrate these into the existing techwriter-bot project:

- https://github.com/presenton/presenton — open-source AI presentation
  generator (self-hostable "Gamma alternative").
- https://github.com/calesthio/OpenMontage — open-source AI video
  montage/generation tooling.

Goal: **prompt a video or a presentation on demand** from the existing
chat app (today it only does technical writing, diagrams, docs tooling) —
"all for free and reasonable limits", i.e. **zero-cost software** that can
produce **production-grade videos and presentations**, via search, code,
integration, creativity, and maximization of existing free tiers.

Deliverables the user asked for, in order:

1. Deep research + analysis + study of the two repos above **and adjacent
   open-source alternatives**.
2. A **strategy document first**, then **design and architecture** for the
   upgrade.
3. Document everything in this repo (GitHub is the source of truth) and
   push — every step must be followable by any AI.

## Constraints from the existing project (read before designing)

- Current stack: Astro 6 (server output) + Svelte 5 + Tailwind v4 on
  **Cloudflare Pages** with Workers AI/KV bindings (`wrangler.json`), free
  tier. See `docs/IMPLEMENTATION_STATUS.md` and `README.md`.
- Cloudflare Pages Functions **cannot run headless Chromium, ffmpeg, or
  long CPU-bound renders** on the free tier — video rendering will need
  either (a) client-side rendering in the browser (e.g. WebCodecs,
  Remotion-player-style, canvas capture), (b) a free-tier external
  runner (e.g. GitHub Actions as a render farm, Hugging Face Spaces,
  Modal/Replicate free credits), or (c) pre-render pipelines. This is the
  central architecture question for the strategy doc.
- Presentations are much easier at zero cost: HTML-based decks
  (reveal.js, Slidev, Marp) or PPTX generation (PptxGenJS runs
  client-side; python-pptx needs a runtime) fit the existing
  chat→artifact pipeline (`src/lib/artifact-*.ts`,
  `ArtifactPanel.svelte`) naturally.
- Provider budget reality: the AI provider chain is currently degraded
  (see `docs/MOBILE_AUDIT_2026-07-04.md` Session 2 — 4 of 6 providers
  down). Fix/rotate keys before adding new AI workloads.
- Standing project rules (do not violate): no OAuth/Stripe/multi-tenancy/
  email/marketing pages/Kubernetes/Redis/complex dashboards/WebContainer
  runtime tooling. Keep the UI compact and internal-tool focused.

## Research checklist for the next session

- [ ] presenton: stack, license, minimum deployment footprint (it is a
      self-hosted Next.js/FastAPI-style app — can any part run on
      Cloudflare free tier, or does it need its own always-on host?),
      API surface, model requirements (which LLM/image providers, can it
      point at free providers/OpenRouter?).
- [ ] OpenMontage: stack, license, what it actually renders with
      (ffmpeg? Remotion? MoviePy?), whether generation can be split into
      "script/storyboard on Cloudflare + render elsewhere".
- [ ] Adjacent OSS to evaluate: Remotion (license caveat: company use),
      Revideo (MIT Remotion alternative), Motion Canvas, Slidev, Marp,
      reveal.js, PptxGenJS, Manim, MoviePy, short-video generators
      (e.g. MoneyPrinterTurbo, ShortGPT), TTS (Edge-TTS free, Kokoro,
      Piper), free image gen (Cloudflare Workers AI flux-schnell has a
      free allocation).
- [ ] Zero-cost hosting/render options: GitHub Actions minutes as a
      render farm (public repo = free unlimited-ish), Hugging Face
      Spaces (free CPU), Cloudflare Workers AI free daily neurons,
      browser-side rendering (zero server cost).
- [ ] Licensing check for every candidate (production/commercial use).

## Expected outputs

1. `docs/VIDEO_PRESENTATION_STRATEGY.md` — research findings, option
   scoring, chosen approach, free-tier limit math, risks.
2. `docs/VIDEO_PRESENTATION_ARCHITECTURE.md` — component design,
   integration points with the existing chat/artifact pipeline, phased
   roadmap (suggest: Phase A presentations first — lowest cost, highest
   fit; Phase B video).
3. Checkpoint updates in `docs/AI_RECOVERY_TRAIL.md` +
   `docs/IMPLEMENTATION_STATUS.md`, commits pushed to GitHub.

## Continue Prompt

```text
Start the video/presentation upgrade task for techwriter-bot from
docs/VIDEO_PRESENTATION_UPGRADE_BRIEF.md (repo:
https://github.com/cyalcala/techwriter-bot, local clone under
C:\Users\admin\Downloads\techwriter-bot). Do the research checklist in
that brief (presenton, OpenMontage, adjacent OSS, zero-cost hosting),
then write the strategy doc and architecture doc it specifies, then
commit and push. Do not implement code until the strategy doc exists.
Note the mobile audit in docs/MOBILE_AUDIT_2026-07-04.md may still be
in progress — it takes priority if unresolved.
```
