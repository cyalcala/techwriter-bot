# Python Tooling — Policy and Opportunity Matrix

## Why Python exists here

The repository already runs Python in CI (`scripts/graphify-ci.sh` → tree-sitter AST →
`graph.json` → KV). Python's established role is **deterministic analysis that
TypeScript should not duplicate**: graph extraction, retrieval evaluation,
document analysis, benchmarks.

## Execution lanes

| Lane | Where | Status |
|---|---|---|
| A — Local/CI tooling | `python/` package, run by `uv`, stdlib-only runtime | ACTIVE (UNIT-01: RAG eval) |
| B — Build-time artifacts for TS to consume | `scripts/dump-rag-chunks.ts` (real TS chunker → JSON) → Python analysis → `output/python/*.json\|md` | ACTIVE (UNIT-01) |
| C — Cloudflare Python Worker | Not used. No evidence justifies runtime Python; TypeScript serves all runtime needs. Do not migrate working endpoints. | CLOSED unless evidence emerges |

## Rules

1. Stdlib first. Every new dependency needs the §15 justification block. Current runtime dependency count: **0** (pytest is dev-only).
2. Python never becomes a second backend. No duplicated chunking/routing/validation logic:
   the RAG evaluator consumes chunks produced by the **real** TypeScript `chunkDocument()`
   via the dump script (cross-language contract, mandate §51).
3. No `eval`/`exec`; no untrusted-code execution; bounded file reads only.
4. Artifacts are portable JSON/markdown under `output/python/`; they are evidence,
   not sources of truth.

## RAG evaluation (UNIT-01)

```powershell
# From repo root. 1) Dump chunks using the real TypeScript chunker:
node_modules\.bin\esbuild.cmd scripts/dump-rag-chunks.ts --bundle --format=esm `
  --platform=node --outfile=.tmp-rag-eval/dump.mjs
node .tmp-rag-eval/dump.mjs

# 2) Unit tests, then evaluation with regression floors:
uv run pytest python/tests -q   # or: cd python; uv run pytest tests -q
cd python
uv run python -m techwriter.rag_eval `
  --chunks ../output/python/rag-chunks.json `
  --out ../output/python/rag-eval-report.json `
  --report ../output/python/rag-eval-report.md `
  --min-recall 0.7 --min-mrr 0.85 --min-hit-rate 0.8
```

Exit codes: `0` pass · `2` chunk-contract failure · `3` metric floor miss.

### Baseline (2026-08-23, corpus `release-notes-corpus.json`, 4 chunks / 5 queries)

| Metric | Observed | Floor |
|---|---|---|
| recall_at_3 | 0.9 | 0.7 |
| mrr | 1.0 | 0.85 |
| hit_rate_at_3 | 1.0 | 0.8 |

Floors are regression detectors calibrated just below observed values — they are
not quality targets. recall@3 = 0.9 comes from one boundary query ("when are
drafts due") whose evidence sentence sits at a paragraph cut; MRR = 1.0 shows
the correct chunk still ranks first. Real product retrieval uses
bge-small-en-v1.5 embeddings; TF-IDF here is a structural proxy that catches
chunker/citation regressions (line drift, lost evidence, truncation), not
semantic similarity changes.

### Contract checks enforced per chunk

- citation line pair (`startLine`,`endLine`) reproducible from the source text
- monotonic chunk starts; valid line ranges; non-empty text
- `heading` equals nearest ATX heading at-or-above the chunk start (matches
  `headingForLine()` semantics — this check caught a real off-by-one during
  calibration)
- `truncated` flag consistent with the 500-chunk cap

## Opportunity matrix

| Opportunity | Lane | Verdict | Reasoning |
|---|---|---|---|
| RAG retrieval eval harness | A+B | **ADOPTED** (UNIT-01) | Completion requires measurable RAG evidence; none existed. Deterministic, offline, zero prod risk. |
| Code-graph analysis (centrality/cycles/orphans) over `graphify-out/graph.json` | A | Adopt later | Needs a consumer decision (docs entry points, review hotspots) before building. |
| Documentation gap analysis (symbols vs docs) | B | Defer | Phase 5B "Map coverage" covers this interactively; batch version needs doc-inventory conventions first. |
| Diagram reasoning (graph model → IR → DOT/Mermaid) | A/B | Defer | Kroki pipeline + repair already strong; revisit only if evals surface accuracy gaps. |
| Research dedup/contradiction engine | A | Defer | Search volume doesn't yet justify it; revisit with real Live-mode usage data. |
| Runtime Python Worker (Lane C) | C | Reject now | No capability gap Pyodide solves better than existing TS/Workers AI path. |
