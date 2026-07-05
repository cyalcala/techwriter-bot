# Video + Presentation Upgrade — Research Notes (Session 4, 2026-07-05)

Status (updated 2026-07-05): **VIDEO PARKED / PRESENTATIONS DECIDED.**
The user approved the strategy in `docs/VIDEO_PRESENTATION_STRATEGY.md`:
presentations ship as a `deck` artifact type; video is parked
deliberately (do not resume without an explicit user request — the
"Remaining research" section below is the resume point, and the
tts-imagegen + zero-cost-render dimensions decide video feasibility).
This file remains the research evidence base.

## Where this task stands

- The mobile audit that previously took priority is **resolved** (see
  `docs/MOBILE_AUDIT_2026-07-04.md` Session 3 — 4/6 providers healthy,
  fixes deployed). This task is now the active one.
- Research was run as a 6-dimension fan-out with adversarial verification.
  **2 of 6 dimensions completed** (presenton, OpenMontage — full findings
  below, primary-source confidence, but the adversarial verify pass did
  not run on them). **4 dimensions remain** (see "Remaining research"),
  plus verification and a completeness pass.
- **No strategy doc, no architecture doc, and no code exist yet.** The
  brief's rule stands: research → `docs/VIDEO_PRESENTATION_STRATEGY.md` →
  `docs/VIDEO_PRESENTATION_ARCHITECTURE.md` → only then code.

## Completed research — Dimension 1: presenton

(github.com/presenton/presenton — AI presentation generator, "Gamma
alternative". All claims below were read from primary sources on
2026-07-04.)

**Verdict: do NOT run or call presenton; PORT its template pattern.**

- **What it is:** a self-hosted Next.js + Python FastAPI app behind nginx,
  shipped as one Docker container (or Electron app). The runtime image
  bundles headless Chromium (Puppeteer), ImageMagick, Tesseract, baked-in
  HuggingFace/FastEmbed model weights, spaCy, sharp native addons, and a
  compiled PPTX-converter binary. Repo ~1.1 GB.
  (https://github.com/presenton/presenton/blob/main/Dockerfile)
- **Cloudflare fit: none.** Needs Chromium, Python, native binaries,
  persistent disk, 1–2 min synchronous generation. Official deploys
  target Railway/DigitalOcean (paid). Free-host workarounds (HF Docker
  Space) are de facto always-on servers our constraints exclude.
- **License:** main repo **Apache-2.0** (LICENSE verified verbatim;
  NOTICE file must be preserved in derivatives). **CRITICAL CAVEAT:** the
  PPTX/PDF export runtime is downloaded at build time from
  `presenton/presenton-export`, a repo with **no source and no LICENSE**
  — unlicensed closed binaries, not legally reusable. Do not plan around
  their export path. (https://github.com/presenton/presenton-export)
- **API (self-hosted v1):** `POST /api/v1/ppt/presentation/generate`
  (HTTP Basic auth) — body: content, slides_markdown, tone, n_slides
  (default 8), template, export_as=pptx|pdf; synchronous ~1–2 min;
  returns file path. v3 APIs (granular editing) are cloud-only.
- **Model support:** natively OpenRouter, Cerebras, Gemini, + any
  OpenAI-compatible custom base URL (covers Groq). Image generation fully
  optional (`DISABLE_IMAGE_GENERATION=true`) or free stock photos
  (Pexels/Pixabay providers built in).
- **Health:** 8.9k stars, near-daily commits, last push 2026-07-04,
  commercial cloud funding development. Minor: self-hosted UI ships
  Mixpanel telemetry.
- **THE PORTABLE ASSET (Apache-2.0):** each slide layout =
  HTML/Tailwind component + Zod schema whose field descriptions and
  defaults (including `__image_prompt__`/`__icon_query__` fields) drive
  the LLM to emit validated per-slide JSON; a deck = ordered array of
  `{layout, data}`. Templates live in
  `servers/nextjs/app/presentation-templates/` (themes: general, modern,
  standard, swift, neo-*, pitch-deck, Code, Education, ProductOverview,
  Report). This pattern ports directly to Svelte 5 + Tailwind in our
  client-side artifact pipeline, with **PptxGenJS (MIT, runs fully in
  the browser)** replacing their closed export binary.
- **Open questions carried forward:** presenton.ai cloud free tier
  (unverified); PptxGenJS fidelity vs their native converter for complex
  layouts; whether Groq's OpenAI endpoint handles their JSON-mode calls.

## Completed research — Dimension 2: OpenMontage

(github.com/calesthio/OpenMontage — "agent-first" AI video production
framework. All claims read from primary sources on 2026-07-04.)

**Verdict: design reference ONLY. Do not embed (AGPL); do not adopt its
default renderer blindly (Remotion license trap).**

- **What it is:** NOT a script-to-video model or SaaS. An AI coding
  assistant (Claude Code, Cursor…) orchestrates 12 pipelines (animated
  explainer, documentary montage, cinematic trailer, talking head, clip
  factory, dubbing…) by reading YAML pipeline manifests + Markdown
  "director skills" and calling ~52 local Python tools. Fixed stage flow:
  research → proposal → script → scene_plan → assets → edit → compose,
  with enforced human approval gates. "There is no code orchestrator.
  Your AI coding assistant IS the orchestrator." No headless API/server
  mode by design.
- **Stack:** Python 3.10+ (pydantic/pyyaml/jsonschema/Pillow…), Node 18+
  (>=22 for HyperFrames), FFmpeg. Render engines: **Remotion 4.0.x**
  (default; React + headless Chromium), **HyperFrames** (HTML/GSAP,
  Apache-2.0, maintained by HeyGen — github.com/heygen-com/hyperframes),
  FFmpeg for assembly. WhisperX captions; CLIP/BLIP-2 footage retrieval;
  Piper TTS for free narration. GPU optional (only for local video/image
  gen models). The zero-API-key path (Piper + stock/archival footage +
  Remotion/FFmpeg) runs on CPU and produces real videos; README demos
  cost $0.02–$1.33 each.
- **Licenses (all verified from primary sources):**
  - OpenMontage: **AGPL-3.0** — embedding any of its code in
    techwriter-bot's served app would relicense the combined work AGPL.
    Re-implementing the pipeline/schema *design* from scratch is fine.
  - Remotion: **source-available, NOT OSI** — free only for individuals,
    ≤3-employee for-profits, and non-profits; larger companies need a
    paid remotion.pro license. Fine for the user's solo agency *today*;
    a scaling trap tomorrow. (https://www.remotion.dev/docs/license)
  - HyperFrames: **Apache-2.0** — the safe fork/embed choice among its
    renderers (verify GSAP plugin licensing separately).
  - Piper TTS: MIT (per-voice model dataset licenses vary — check the
    chosen voice). FFmpeg: LGPL/GPL — subprocess use doesn't contaminate.
- **Cloudflare fit: none** for direct adoption (filesystem, subprocesses,
  Chromium, interactive approval loop). **But the split it validates is
  the key fact:** stage outputs are structured JSON artifacts (15 JSON
  Schemas), and `remotion-composer/` is a standalone Node project
  rendered via `npx remotion render`. Remotion officially supports
  GitHub Actions rendering. So: LLM stages (script/scene-plan JSON) on
  Cloudflare free providers → dispatch to GitHub Actions → render with
  Remotion or HyperFrames + FFmpeg on the free runner → publish mp4 to
  R2/release asset. (Cloudflare Containers would also run Remotion but
  are a PAID feature — excluded.)
- **Free-asset map worth reusing:** Pexels/Pixabay/Unsplash (free API
  keys), Archive.org/NASA/Wikimedia (keyless), Piper TTS (local, free),
  Google TTS free tier (1M chars/month), ElevenLabs free (10K
  chars/month). Pay-per-use video-gen (Kling/Veo via fal.ai etc.) has NO
  free tier — cinematic AI-generated footage is out of zero-cost scope.
- **Quality-gate ideas worth re-authoring (not copying — AGPL):**
  slideshow-risk scoring, delivery-promise verification, pre-compose
  validation gates, post-render self-review (ffprobe + frame sampling +
  audio levels), budget caps per action.
- **Health:** 32.9k stars but only 3 months old; single dominant
  maintainer (~80% of commits) — high bus factor. Beware lookalike
  repos/mirrors ("Open-Montage" org, SourceForge) — canonical is
  `calesthio/OpenMontage`.
- **GitHub Actions budget note (unverified — MUST be re-verified):**
  public repos get free standard-runner minutes; a 60–90s Remotion CPU
  render fits in single-digit minutes. **The ToS question — whether
  user-triggered renders for an external app violate GitHub's Actions
  usage policy — was NOT settled and is a load-bearing open question.**

## Preliminary strategy direction (NOT final — pending remaining research)

Discussed with the user in-session; treat as the working hypothesis the
strategy doc should confirm or refute:

1. **Phase A — presentations (high confidence, ship first).** New `deck`
   artifact type in the existing chat→artifact pipeline. Port presenton's
   schema-driven pattern: 5–8 hand-crafted Svelte/Tailwind slide layouts
   + JSON schemas whose field descriptions steer the LLM; deck = ordered
   `{layout, data}` array streamed as an artifact; client-side render in
   ArtifactPanel; export via PptxGenJS (MIT, browser-side) + print-to-PDF.
   Zero new infrastructure, zero cost, no license issues. Existing
   `artifact-repair.ts` covers malformed-JSON repair.
2. **Phase B — video (feasible, scoped).** Slide-video hybrid rendered
   FULLY IN-BROWSER: canvas-render deck scenes, WebCodecs encode +
   MIT muxer (mp4-muxer/webm-muxer), free TTS narration. Honest limits:
   tab stays open during render; explainer/walkthrough quality, not
   cinematic. TTS pick pends the tts-imagegen research dimension
   (candidates: Kokoro in-browser via transformers.js/WebGPU, Workers AI
   TTS if in current catalog, Edge-TTS ToS-risky, SpeechSynthesis
   robotic).
3. **Secondary option, NOT default — GitHub Actions render farm** for
   real Remotion/HyperFrames renders. Blocked on: the unresolved GitHub
   ToS question, artifact-retrieval auth complexity (likely R2 upload
   from runner), and the project rule against standing infrastructure.
   Position it as a documented power-user/self-hosted escape hatch if
   the ToS reading is favorable.
4. **Non-goal:** server-rendered cinematic/AI-footage video (paid GPU
   models, ffmpeg hosting, AGPL/Remotion license exposure).

## Remaining research (4 of 6 dimensions — re-run before writing the strategy doc)

The halted workflow's remaining dimensions, summarized (full prompts can
be reconstructed from these):

1. **presentation-oss:** evaluate reveal.js, Slidev, Marp, PptxGenJS (+
   2026 newcomers) for license, FULLY-client-side render viability (CDN:
   cdnjs/jsdelivr/unpkg — the CSP in `src/lib/security-headers.ts` allows
   those; esm.sh is NOT in the middleware CSP), LLM-friendliness of
   source format, out-of-box theming quality vs the "production-grade"
   bar. Rank top 2 combos.
2. **video-oss:** Remotion (license!), Revideo (MIT? maintained in
   2026?), Motion Canvas, MoviePy, Manim, MoneyPrinterTurbo, ShortGPT;
   plus browser-native: WebCodecs maturity 2026, MediaRecorder canvas
   capture, mp4-muxer/webm-muxer libs. Rank top 2 for (a) in-browser and
   (b) Actions-rendered video.
3. **tts-imagegen:** Edge-TTS 2026 status/ToS risk, Kokoro
   (in-browser via transformers.js/onnx? Workers AI?), Piper, browser
   SpeechSynthesis, Workers AI TTS models in the CURRENT catalog
   (post-2026-05-30 purge — Aura? MeloTTS?); image gen: Workers AI image
   models + free neuron allocation NUMBERS, Gemini free-tier image gen,
   Pollinations.ai reliability/ToS. Recommend one TTS + one image path
   per pipeline (browser / Actions).
4. **zero-cost-render:** GitHub Actions free-minute numbers + per-job
   limits + **the ToS/fair-use language for render-backend use (quote
   it)** + repository_dispatch trigger and file-return paths (R2 from
   runner vs release asset); Cloudflare adjacents with 2026 numbers (R2
   free tier, Workers CPU limits, Workers AI free neurons/day, Browser
   Rendering API free allocation — could it PDF/screenshot decks?); HF
   Spaces free CPU reality; in-browser render feasibility numbers for
   1–3 min 1080p. Rank top 2 strategies with free-tier math
   (decks/videos per day).

Then: adversarially verify the license and free-tier claims of ALL SIX
dimensions against primary sources (LICENSE files, official pricing
pages), fill gaps, and only then write
`docs/VIDEO_PRESENTATION_STRATEGY.md` (option scoring, chosen approach,
free-tier math, risks) and `docs/VIDEO_PRESENTATION_ARCHITECTURE.md`
(component design, integration points, phased roadmap: Phase A
presentations first, Phase B video).

## Codebase integration points (mapped this session — verified in source)

For the future architecture doc; all verified against current `main`:

- `src/lib/path-router.ts` — `GEN_ARTIFACT_TRIGGER` /
  `QUICK_ARTIFACT_HINT` regexes decide `needsArtifact`; add
  presentation/deck/slides/video keywords here.
- `src/lib/prompts.ts` — `ARTIFACT_COMPACT` teaches the model the
  `<artifact type="X" title="...">` convention (artifact tag first, raw
  content only); a deck type needs its schema/prompting layer added here.
- `src/lib/stream-parser.ts` — parses artifact tags and fenced blocks to
  `ArtifactType`; add `deck` (and later `video-plan`) + aliases.
- `src/lib/artifact-types.ts` — `SUPPORTED_ARTIFACT_TYPES`,
  `PREVIEWABLE_ARTIFACT_TYPES`, `TYPE_ALIASES` registries.
- `src/lib/renderer-loader.ts` — lazy CDN loader (cdnjs/jsdelivr/unpkg
  allowed by CSP); PptxGenJS would load here on demand.
- `src/components/ArtifactPanel.svelte` — renderer switch; add a `deck`
  case rendering slide components.
- `src/components/ArtifactOverlay.svelte` / `ArtifactSplitView.svelte` /
  `ArtifactStandalone.svelte` — existing mobile/desktop artifact display
  (mobile artifact view replaces chat view; safe-area + pinch-zoom
  already handled).
- `src/lib/artifact-repair.ts`, `artifact-queue.ts`,
  `artifact-lifecycle.ts` — repair/queueing machinery a deck type
  inherits for free.
- `src/lib/session-transfer.ts` — `ARTIFACT_TYPES` set must include new
  types for session export/import.
- Provider note: artifact requests use `forceSticky` session-locked
  providers (`src/pages/api/chat.ts` ~line 241); provider chain is
  healthy again (4/6) as of 2026-07-04.

## Handoff instructions for the next AI

1. Re-run the 4 remaining research dimensions above (web research with
   primary sources; every claim needs a source URL and a confidence
   level), adversarially verify license/free-tier claims across all 6,
   then write the strategy doc, then the architecture doc, then stop for
   user review before any code.
2. GitHub is the source of truth — commit and push docs as you go;
   update the checkpoints in `docs/AI_RECOVERY_TRAIL.md` and
   `docs/IMPLEMENTATION_STATUS.md` per their existing format.
3. Standing constraints in `docs/VIDEO_PRESENTATION_UPGRADE_BRIEF.md`
   still apply (zero cost, no always-on servers, no Chromium/ffmpeg on
   Pages, keep UI compact, no forbidden infrastructure).
4. Environment notes: local `astro dev` is known-blocked in this sandbox
   (do not re-debug); production smoke pattern is
   `scripts/mobile-repro.mjs`; run git only from inside the repo clone
   (a stray git repo exists at `C:\`).
