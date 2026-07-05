# Video + Presentation Strategy (decided 2026-07-05)

User-approved decision record. Supersedes the open questions in
`docs/VIDEO_PRESENTATION_RESEARCH_NOTES.md` (research evidence lives
there); governs the implementation tracked in
`docs/IMPLEMENTATION_STATUS.md`.

## Decisions

1. **Video is PARKED.** No video code exists and none will be written
   for now. This is a deliberate scope decision, not unfinished work:
   the free-tier path (in-browser slide-video) is blocked on an
   unresolved TTS quality question, is desktop-only, and the alternative
   (GitHub Actions render farm) is a ToS gray zone with real plumbing
   complexity. Resume point: `docs/VIDEO_PRESENTATION_RESEARCH_NOTES.md`
   ("Remaining research" — the tts-imagegen and zero-cost-render
   dimensions decide feasibility).
2. **Presentations ship as a first-class artifact type (`deck`).**
   Approach: presenton's schema-driven pattern re-implemented natively
   (Apache-2.0 pattern, zero code copied) — the LLM emits strict JSON
   against hand-crafted Svelte/Tailwind slide layouts; design quality
   lives in the templates, not the model.

## Approved v1 parameters

- **Slide count: default target 7, hard cap 8 — strictly enforced** in
  the prompt contract AND the validator (extra slides truncated).
- **Token budget:** deck artifact requests use `maxTokensOverride` 4096
  (other artifact requests stay at 2048). Deck-only, detected
  server-side; reputation/rate-limit gates unchanged.
- **Visuals:** icons (emoji/unicode) + typography only; no image
  generation, no stock-photo APIs. Theme inherits the existing
  stone/amber palette — no new design tokens.
- **Quality bar:** clearly above a rushed PowerPoint; simple,
  survivable, consistent. Not competing with a human designer.
- **Streaming:** deck renders when its JSON completes; skeleton/progress
  state during generation (partial JSON cannot render safely).
- **Export:** PPTX via PptxGenJS (MIT) lazy-loaded from a CSP-allowed
  CDN, fully client-side; print-to-PDF via the browser. Export is a
  faithful editable approximation of the HTML deck, not pixel-identical
  — communicated as such.
- **Cost:** $0 — no new services, keys, or servers. Token-lean: deck
  prompt instructions are injected only for deck requests.

## Rejected options (and why)

- Running/calling presenton: heavyweight Docker + Chromium, no free
  host, closed unlicensed export binaries.
- Adopting OpenMontage code: AGPL contamination; agent-first design has
  no API mode; Remotion renderer is a >3-employee license trap.
- Stock photos / AI images in v1: key management + trickle-level free
  quotas for marginal quality gain.
- Progressive slide streaming in v1: partial-JSON rendering risk not
  worth it; revisit post-v1 if demanded.

## Implementation shape (chunked, each independently reviewable)

1. Docs: this file + PARKED status lines (done in same commit).
2. Type plumbing: `stream-parser.ts`, `artifact-types.ts`,
   `session-transfer.ts`, `path-router.ts` triggers, `chat.ts` deck
   token override.
3. Prompt contract: deck JSON schema in `prompts.ts`, injected only for
   deck requests.
4. `deck-schema.ts` (validate/repair/truncate) + deck renderer + 
   `ArtifactPanel.svelte` case + skeleton state.
5. PPTX export mapping + artifact-UI export button.
6. Tests + checkpoint docs + push + production smoke.
