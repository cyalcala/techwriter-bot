# Findings Ledger — 2026-08-23 Gauntlet

Statuses: OPEN / IN_PROGRESS / terminal (KEEP, REVISE, REVERT, FIXED, DELETED, BLOCKED, ESCALATE, DEFER).

## F-01 — RAG retrieval quality has no measurable evidence
- Severity: P2
- Subsystem: RAG (`src/lib/rag-client.ts`, `embed-pipeline.ts`, `sim-search.ts`)
- Evidence: `npm grep`/test inventory shows citation-metadata and degradation tests only; no corpus, no Recall@K/MRR/hit-rate anywhere. Gauntlet completion criterion "RAG quality has measurable evidence" is unmet. Product top-k=3, cosine ≥ 0.3, chunk 700/120 overlap are untested against realistic documents.
- User impact: chunker/parameter regressions (chunk size, overlap, top-k) would ship silently; writers get worse grounded answers with no signal.
- Root cause: evaluation never built; RAG work focused on correctness/citations.
- Current behavior: parameters are intuition-tuned. Desired: repeatable offline eval with metrics over labeled fixtures, run in CI.
- Recommended intervention: Python Lane A eval harness (mandate §34–35, §51). Python computes TF-IDF retrieval metrics over chunks produced by the **actual TypeScript chunker** (no logic duplication); validates the chunk contract (line/heading citation metadata).
- Smallest fix: `scripts/dump-rag-chunks.mjs` (Node type-stripping import of real `chunkDocument`) → `python/` stdlib-only evaluator → pytest + JSON/markdown report.
- Python relevance: LOCAL TOOL / CI TOOL. Dependencies: NONE (stdlib only).
- Test: `uv run pytest python/tests` + `npm.cmd test` (contract dump covered indirectly; TS suite unchanged).
- Test: `uv run pytest python/tests -q` (9 tests) + evaluator exit codes + `npm.cmd test` (51 files, 338 tests, unchanged).
- Status: FIXED (UNIT-01, 2026-08-23). Baseline: recall@3 0.9 / MRR 1.0 / hit@3 1.0 with floors 0.7/0.85/0.8; chunk contract enforced; heading off-by-one vs `headingForLine()` caught during calibration and aligned to TS ground truth. Evidence: `output/python/rag-eval-report.json`.

## F-02 — Root-level debris committed to the repository
- Severity: P3
- Subsystem: repo hygiene
- Evidence (all git-tracked):
  - `projects.txt` — UTF-16LE wrangler console capture (progress bars), binary junk.
  - `debug_final.json`, `debug_output.json` — 0-byte debug artifacts.
  - `fuse-deploy.js` — legacy manual Pages bundle assembler ("Universal Fusion Protocol"), superseded by `deploy-final.js`.
  - `fix-config.js` — one-off config patcher, unreferenced.
  - `setup-receptionist.js` — unrelated-project one-off, unreferenced.
  - `sync-fixed.ps1`, `sync-sovereign.ps1` — hard-coded-target near-duplicates of `sync-secrets.ps1` (which takes `-ProjectName` and supersedes both).
- User impact: noise misleads future agents/maintainers; graphify indexes junk.
- Root cause: ad-hoc debugging sessions committed without cleanup.
- Recommended intervention: DELETE debris. `deploy-final.js` (referenced by `npm run deploy:pages`) and `sync-secrets.ps1` (generic) stay.
- Python relevance: NONE.
- Test: `npm.cmd test` + `npm.cmd run build` still green after deletion; `git grep` confirms no references.
- Status: OPEN (UNIT-02)

## F-03 — graphify CI installs unpinned pip package each run
- Severity: P3
- Subsystem: CI (`scripts/graphify-ci.sh`)
- Evidence: `python3 -m pip install graphifyy -q` with no version pin, no lockfile; supply-chain and reproducibility risk; script swallows all extraction failures (`|| echo ... continuing`), so a broken graph silently ships stale KV data.
- User impact: low today (CI-only); a compromised/broken upstream could poison the runtime code graph or silently freeze it.
- Recommended intervention: pin the package version and fail loudly on extraction failure while keeping deploy alive. Defer unless CI shows instability.
- Python relevance: CI TOOL.
- Status: OPEN (DEFER candidate)

## F-04 — Vite chunk warnings for deck/doc schemas
- Severity: P3
- Subsystem: build (`deck-schema.ts`, `doc-schema.ts`, `artifact-export.ts`)
- Evidence: build output warns these modules are both statically and dynamically imported, so dynamic chunking is defeated.
- User impact: marginal bundle size; non-failing, known.
- Recommended intervention: DEFER — not worth churn now.
- Status: DEFER

## F-05 — Documentation drift: SYSTEM_SAVEPOINT.md is stale
- Severity: P3
- Subsystem: docs
- Evidence: savepoint references commit `b2ac2c0` and "12/12 tests"; reality is 51 files / 338 tests at `0433879`. IMPLEMENTATION_STATUS.md and AI_RECOVERY_TRAIL.md are current.
- User impact: an agent reading only the savepoint gets wrong baselines.
- Recommended intervention: KEEP + DOCUMENT — mark savepoint as historical, point to IMPLEMENTATION_STATUS.md.
- Status: OPEN (fold into UNIT-02 docs pass)
