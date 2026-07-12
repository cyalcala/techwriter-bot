# Mobile Diagram Fixes — 2026-07-12

Two user-reported, reproduced-and-fixed defects in the diagram pipeline.

## Symptoms (mobile)

1. **Edge labels rendered "crossed out"** — the connecting line drew straight
   through the label text.
2. **Persistent `Error 400` from the Kroki server render** —
   `SyntaxError: Parse error … Expecting 'SEMI','NEWLINE','EOF','AMP',
   'START_LINK','LINK','LINK_ID', got 'NODE_STRING'`, shown as "Mermaid
   renderer unavailable".

## Root causes (both reproduced)

### 1. Crossed-out labels ← a regression I introduced

The security slice (commit `293bfe4`, 2026-07-11) set mermaid
`htmlLabels:false` so client mermaid would emit pure SVG that DOMPurify could
sanitize strictly. Side effect: with `htmlLabels:false` mermaid renders label
text as bare `<text>` **without the background rectangle** that HTML labels
carry — so edge lines pass through the text and it looks struck through.
Confirmed by rendering the same diagram both ways at a 390 px viewport
(`output/diagram-fix-2026-07-12/`).

**Fix:** reverted to mermaid's default HTML labels (removed the `htmlLabels`
override in `renderMermaidArtifact`, `src/lib/renderer-loader.ts`). The
resulting `<foreignObject>` output is already handled safely by
`sanitizeSvg`'s foreignObject branch (the hardened regex scrubber that
preserves labels while stripping scripts / handlers / encoded-`javascript:`
URLs — see `docs/E2E_AUDIT_2026-07-11.md` slice 2). No security regression.

### 2. Kroki 400 ← line-broken edge statements from the model

Free-tier models sometimes wrap a labeled edge onto two lines:

```
AST -->|optimizes|
OptimizedAST[Optimized AST]
```

Mermaid and Kroki both require `AST -->|optimizes| OptimizedAST[Optimized AST]`
on a single line; the split form is a hard parse error. Because the **client**
mermaid render fails on the same source, it falls back to the Kroki server
render, which returns the 400 the user saw. Reproduced exactly against
`kroki.io/mermaid/svg` (a one-line version returns 200; the split version
400s).

**Fix:** `joinDanglingEdges` in `src/lib/diagram-source-normalizer.ts`, called
from `normalizeMermaidSource` (so it runs on every mermaid render — client and
Kroki, at artifact creation and at render time). It joins a line that ends with
a dangling link operator (optionally `+|label|`) to the following target line,
and pulls up a line that begins with a link operator onto its source.
Structural lines (`subgraph`/`end`/`style`/`classDef`/`class`/`click`/
`direction`/`%%` comments/`---` frontmatter) are never merged, and a node token
is required before the arrow so dash-runs in comments/labels/frontmatter are
not mistaken for edges.

## Verification

- **Unit:** `src/tests/diagram-source-normalizer.test.ts` — joins the exact
  user pattern, leaves valid one-line/multi-node/chained edges untouched, and
  never merges structural/frontmatter/comment lines. Full suite **278/278**.
- **Real browser (390 px mobile):** the user's exact line-broken diagram now
  renders cleanly with readable, non-crossed-out labels; the original
  (unrepaired) source throws the reproduced parse error.
  `output/diagram-fix-2026-07-12/userdiag-rendered-after-fix.png`.
- **Adversarial ground truth vs Kroki** (`adversarial-join-kroki-results.txt`):
  16 valid diagram types (flowchart arrow variants, chained/multi-node edges,
  sequence, class, state, ER, gantt, pie, special-char & dash labels,
  frontmatter, dash-ending comments) all stay `200` after the transform
  (**zero false positives**); 4 line-broken variants all go `400 → 200`.

## Files changed

- `src/lib/renderer-loader.ts` — revert `htmlLabels:false`.
- `src/lib/diagram-source-normalizer.ts` — add `joinDanglingEdges`.
- `src/tests/diagram-source-normalizer.test.ts` — +4 regression tests.
