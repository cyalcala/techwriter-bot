# Deck (Presentation) Mobile Fixes — 2026-07-12

Two user-reported deck-rendering defects on mobile, reproduced with the real
renderer and fixed. Reported while generating a "Duterte fanaticism"
presentation.

## Symptoms

1. **Empty slide = a big black box.** A slide ("Duterte's Social Media
   Presence") showed only a heading and a solid dark rounded rectangle where
   content should be.
2. **Content overflowed / "crossed out" the card.** On phones the slide
   heading was clipped at the top and the last bullets spilled *below* the card
   over the footer — content bled outside the rounded slide boundary. The
   two-column layout was cramped.

## Root causes (both reproduced via `renderDeckArtifact` at a 390 px viewport)

### 1. Black box ← empty `code` slide

The `code` layout renders a dark `<pre>` (`background:#292524`). Free-tier
models sometimes tag a non-code slide as `layout:"code"` with an empty (or
missing) `code` field, so the renderer drew an **empty dark box**. Reproduced
exactly (`output/deck-fix-2026-07-12/before-empty-code-black-box.png`).

### 2. Overflow ← rigid slide aspect ratio

Each slide was `aspect-ratio:16/9; min-height:230px; justify-content:center`
with **no overflow handling**. On a narrow phone that box is only ~228 px tall,
so any real amount of content (bullets, two columns) was vertically centered in
a too-short box and **spilled out of the top and bottom of the card**, over the
footer badges. Reproduced (`before-two-column-overflow.png`): the heading is
clipped and the last rows overrun the card.

## Fixes (`src/lib/renderer-loader.ts`)

- **Slide box grows to fit content.** Dropped the fixed `aspect-ratio:16/9`;
  the slide now uses `min-height:240px` and `height:auto` with generous
  bottom padding to clear the footer badges. Because the carousel is a flex
  row (`align-items:stretch`), every slide stretches to the tallest one, so
  they stay **uniform height** while never clipping content. Added
  `overflow-wrap:anywhere; word-break:break-word` so long tokens can't cause
  horizontal overflow.
- **Responsive two-column.** `grid-template-columns:1fr 1fr` →
  `repeat(auto-fit,minmax(150px,1fr))`, so the two columns **stack into one**
  on a narrow phone instead of squeezing into unreadable slivers.
- **No empty dark box.** The `code` layout now checks for an empty `code`
  field; when empty it degrades to the slide's `bullets` (or a `text`
  paragraph) if present, otherwise renders just the heading — never an empty
  dark `<pre>`.

## Verification

- **Real renderer at 390 px** (`output/deck-fix-2026-07-12/`):
  - `after-two-column-stacked.png` — heading fully visible, columns stacked,
    all bullets inside the card, footer clear, **0 px overflow** (measured
    `scrollHeight == clientHeight` on every slide, vs 245 vs 228 before).
  - `after-empty-code-heading-only.png` — the former black box now shows just
    the clean heading.
- **Unit:** `src/tests/deck-artifacts.test.ts` +4 tests — empty code slide
  emits no `#292524` box but keeps the heading; a mislabeled code slide with
  bullets degrades to those bullets; a real code slide still renders the dark
  box; the slide box no longer contains `aspect-ratio:16/9` and the
  two-column grid uses the responsive `auto-fit` template. Full suite
  **282/282**.

## Files changed

- `src/lib/renderer-loader.ts` — slide box sizing, responsive two-column,
  empty-code fallback.
- `src/tests/deck-artifacts.test.ts` — +4 deck-render regression tests.
