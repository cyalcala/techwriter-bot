# Document Ingestion + Artifact System — Strategy (2026-07-05)

Status: **Phase 1 SHIPPED + verified in production (2026-07-05).**
Phases 2–3 pending. The user asked for: ingest PDF and other major
document formats (reasonable, feasible size), then "spit back" a
downloadable artifact in PDF and other major formats, with a
**Claude-style artifact experience**. Phase 1 (ingest versatility) is
done — see the roadmap below and the Session 7 checkpoint in
`docs/AI_RECOVERY_TRAIL.md`. Approved sizing: **~300KB / ~500 chunks**
with a partial-index notice.

All library facts below were verified against primary sources on
2026-07-05 (license + client-side + CDN/CSP fit) — not assumed.

## Goal (three-part loop)

1. **Ingest** major documents — PDF, DOCX, plus today's text formats —
   fully client-side, at a reasonable/feasible size.
2. **Produce** a rich artifact from that content (report/document or
   deck), rendered live like a Claude artifact.
3. **Download** the artifact in PDF and other major formats.

## Hard constraints (unchanged from project rules)

- **$0** — no new services, keys, or servers; free-tier only.
- **Client-side** — Cloudflare Pages Functions cannot run Chromium,
  ffmpeg, or heavy CPU. All parsing/generation runs in the browser.
- **Privacy-first preserved** — document text is extracted in-browser;
  only chunk text goes to `/api/embed` (already the case). Vectors stay
  session-only in memory.
- **No palette/design-token changes** — visual work is layout/hierarchy
  only, on the existing stone/amber palette.
- **CSP** — libs must load from CSP-allowed CDNs (cdnjs/jsdelivr/unpkg)
  and respect `worker-src 'self' blob:`.

## Verified building blocks (all permissive, all client-side)

| Purpose | Library | License | Notes |
|---|---|---|---|
| PDF → text (ingest) | **pdf.js** (Mozilla) | Apache-2.0 | `getTextContent()` per page. Worker auto-reroutes to a `blob:` from host origin (`createCDNWrapper`) → fits our `worker-src 'self' blob:`. |
| DOCX → text/HTML (ingest) | **mammoth.js** | BSD-2-Clause | `mammoth.browser.min.js`, `extractRawText`/`convertToHtml`. jsdelivr v1.12 / cdnjs. |
| → PDF (download) | **jsPDF** | MIT | Already the plan for deck→PDF; reuses the `deck-pptx.ts` layout-mapping approach (vector text, small, selectable). |
| → DOCX (download) | **docx** (dolanmiu) | MIT | `Packer.toBlob()` in browser; actively maintained 2026. |
| → PPTX (download) | **PptxGenJS** | MIT | Already shipped for decks (`deck-pptx.ts`). |

Sources: pdf.js https://github.com/mozilla/pdf.js (Apache-2.0) + CSP
worker note https://github.com/mozilla/pdf.js/issues/9676 ; mammoth
https://github.com/mwilliamson/mammoth.js (BSD-2-Clause) ; docx
https://github.com/dolanmiu/docx/blob/master/LICENSE (MIT) ; jsPDF MIT ;
PptxGenJS MIT.

## Current RAG state (honest baseline — from reading the code)

The pipeline works for a narrow case but is NOT "flawless/versatile" yet
(`src/lib/embed-pipeline.ts`, `rag-client.ts`, `ChatIsland.svelte`
upload path):

- **Text-only:** `validateDocument` allows `.txt/.md/.json/.csv`, 5MB.
  No PDF/DOCX — the #1 gap.
- **Silent truncation:** `chunkText` caps at 100 chunks × 500 chars
  ≈ first 40KB. Larger docs are accepted then mostly ignored.
- **Naive chunking:** fixed 500-char windows split mid-sentence/word;
  no paragraph/heading awareness → weaker retrieval.
- **Degrade, not fail over:** on `/api/embed` 429/503 it marks chunks
  skipped + `degraded=true`; no local embedding fallback in the pipeline
  as written (older docs claim one — not present in code).
- **Inconsistency:** the file picker `accept` lists `.yaml/.yml` but
  `validateDocument`'s allowlist does not → YAML uploads get rejected.
- **Session-only** vectors (privacy feature; no persistence).

## Design

### A. Ingest (make RAG versatile)

1. **Add client-side parsers**, lazy-loaded on demand:
   - PDF → `extractPdfText(file)` via pdf.js (concatenate page text).
   - DOCX → `extractDocxText(file)` via mammoth `extractRawText`.
   - Keep text/md/json/csv as-is; fix the `.yaml/.yml` allowlist gap.
   - Extend `validateDocument` allowlist + the picker `accept`.
   Parsers live in a new `src/lib/document-parsers.ts`; `handleFileUpload`
   calls the right parser to get plain text, then the existing chunk →
   embed path is unchanged.
2. **Smarter chunking:** split on blank lines/headings first, then pack
   to ~600–800 chars with ~120 overlap so semantic units stay intact.
   Replaces the blind character window.
3. **Reasonable/feasible size:** raise the effective coverage cap from
   ~40KB to a defined budget (proposal: up to ~500 chunks ≈ ~300KB of
   text embedded) and, when a document exceeds it, **say so in the UI**
   ("indexed first N of M sections") rather than silently truncating.
   The cap protects the free Workers AI embedding quota and browser
   memory — that is the honest boundary of "feasible."
4. **Resilience:** keep batching+retry; surface a clear "embedding
   degraded" state. Optional Phase-later: a WASM/WebGPU Transformers.js
   `bge-small` fallback (heavy model download — deferred, flagged).

### B. Output artifact + Claude-style experience

1. **New `document` artifact type** (a rich structured report), alongside
   the existing `deck`. The model emits a structured document (headings,
   paragraphs, lists, tables, code) as an artifact; it renders live in
   the artifact panel. Registered through the same chain deck used
   (`stream-parser`, `artifact-types`, renderer, `session-transfer`).
2. **Download menu per artifact** (client-side, lazy-loaded):
   - `document` → **PDF** (jsPDF), **DOCX** (docx), Markdown/HTML.
   - `deck` → **PDF** (jsPDF) + PPTX (already) .
   - Replaces the single download button with a small format menu.
3. **Claude-style artifact UX** (frontend only, existing components):
   - A cleaner dedicated artifact panel with a title bar + Preview/Source
     tabs + the download-format menu.
   - `deck`: a slide viewer — one slide at a time, prev/next, counter,
     and a grid/overview toggle (instead of the current vertical stack).
   - `document`: a paginated/scrollable rich preview.
   - Desktop split-view and mobile overlay behavior preserved.

### Architecture fit

- Ingestion: parser step slots in front of the unchanged chunk→embed
  path; nothing server-side changes (privacy preserved).
- Output: `document` type reuses the deck plumbing pattern end-to-end;
  exporters are lazy `import()`ed modules (`deck-pdf.ts`, `doc-pdf.ts`,
  `doc-docx.ts`) mirroring `deck-pptx.ts`.
- All third-party libs lazy-loaded via `loadExternalScript` from
  CSP-allowed CDNs — zero bundle-size cost until used.

## Phased roadmap (each phase independently shippable + verifiable)

- **Phase 1 — Ingest versatility. ✅ DONE (2026-07-05, commit 3efac97).**
  PDF (pdf.js) + DOCX (mammoth) client-side parsers, fixed `.yaml` gap,
  paragraph-aware chunking, cap raised 100→500 with a partial-index
  notice, embed capacity raised to match. **Verified in production**
  (`scripts/rag-doc-smoke.mjs`): a real Chrome-printed PDF and a real
  DOCX were each uploaded, indexed, and answered with `[Doc: …, line n]`
  citations — zero console/page errors. Evidence:
  `output/playwright/rag-doc-v1/`.
- **Phase 2 — Downloads.** deck→PDF; new `document` artifact type with
  PDF + DOCX export. Outcome: "get a downloadable PDF/Word artifact."
- **Phase 3 — Claude-style artifact UX.** Dedicated viewer (slide nav
  for decks, rich preview for documents) + download-format menu.

Suggested order matches the user's loop (ingest → artifact → download);
Phase 1 is the highest-value gap (real document ingestion).

## Open decisions (for the user before/within implementation)

1. **Feasible size cap** — is "~300KB / ~500 chunks embedded, with a
   clear 'partial index' notice beyond that" acceptable, or is a
   different ceiling preferred? (Higher = more Workers AI neuron burn.)
2. **DOCX/legacy:** support `.doc` (old binary Word)? Recommend **no** —
   mammoth handles `.docx` only; `.doc` needs heavier tooling. PDF +
   DOCX + text covers "major documents."
3. **XLSX/PPTX ingestion:** in scope now, or defer? Recommend defer;
   focus PDF/DOCX first.
4. **Document artifact export priority:** PDF first, DOCX next? (Both are
   feasible; PDF is the more universal download.)

## Non-goals (explicit)

- Server-side rendering/OCR of scanned PDFs (image-only PDFs yield no
  text without OCR — flag to user; OCR is out of the free/client scope).
- Persisting vectors across sessions (privacy-first is deliberate).
- `.doc` binary Word, and video (already parked).
