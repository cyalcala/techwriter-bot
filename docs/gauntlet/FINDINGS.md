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
- Status: FIXED (UNIT-02, 2026-08-23). Deleted: `projects.txt`, `debug_final.json`, `debug_output.json`, `fuse-deploy.js`, `fix-config.js`, `setup-receptionist.js`, `sync-fixed.ps1`, `sync-sovereign.ps1`. Kept: `deploy-final.js` (referenced by `npm run deploy:pages`), `sync-secrets.ps1` (generic `-ProjectName` supersedes both fixed variants).

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
- Status: FIXED (UNIT-02, 2026-08-23). Historical banner added to `docs/SYSTEM_SAVEPOINT.md`.

## F-06 — Production health shows 4 of 6 providers probing unhealthy (observation)
- Severity: P3 (informational)
- Subsystem: provider credentials/deployment config + stale model IDs (`src/lib/providers.ts`)
- Evidence (baseline 2026-08-23): /api/health at tw-bot.pages.dev returned status ok, version match, but cerebras http_402 (payment/billing), groq http_404, gemini http_404 (model/probe mismatch), nvidia timeout. Only openrouter + nvidia active in that snapshot (2/6). Historical docs recorded 3-4/6 as normal variance; 2/6 was lower than any recorded baseline.
- Evidence (after fix, 2026-09-02T19:31Z): /api/health returns `status ok, 4/6 active, version 0.0.1 match` — cerebras http_402 (parked, billing), groq 200, **gemini http_429** (valid key, quota), nvidia 200, openrouter 200, cloudflare 200. Latencies: groq 418ms, nvidia 738ms, gemini 79ms (429), openrouter 525ms, cloudflare 298ms. Previous post-model-fix snapshot (pre-key-sync, 19:22Z) was `4/6 active, gemini http_400` — the 400 was an **invalid GEMINI_API_KEY**, not a model error (Gemini OpenAI-compat returns 400 for a bad key, not 401).
- User impact: reduced headroom before failover pressure; circuit breaker keeps service up while >=1 provider lives. After fix, headroom restored from 2/6 to 4/6 (5/6 when Gemini quota allows).
- Root cause:
  - **Groq** `llama-3.3-70b-versatile` removed 2026-06-17 (404) → `openai/gpt-oss-20b` (fast-tier migration target).
  - **Gemini** `gemini-2.0-flash` shut down 2026-06-01 (404) → `gemini-2.5-flash` (GA, live-probed OK 2026-09-03 via `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` with Bearer). `gemini-flash-latest` also probes OK locally but the alias is not stable on the OpenAI path in all accounts; `gemini-2.5-flash` is the pinned GA choice.
  - **Nvidia** `meta/llama-3.1-8b-instruct` permanently 410 Gone on `https://integrate.api.nvidia.com/v1` → `openai/gpt-oss-20b` (catalog GET 200, all meta/llama + nemotron IDs 410).
  - **Gemini key** in Cloudflare was stale (http_400 = bad key on this endpoint). Rotating `GEMINI_API_KEY` to the working Desktop key (`gemini777.txt`, prefix `AQ.A…`, len 53, lastWrite 2026-09-03) resolved 400→429.
  - **Cerebras** http_402 is billing (Payment Required) — intentionally parked per owner decision; no code change.
- Fix applied:
  - Code `src/lib/providers.ts` commits `d0d0fb8` (groq/nvidia/gemini model refresh, vitest 51/338 pass, astro build Complete) + `f23c316` (gemini `gemini-flash-latest` → `gemini-2.5-flash`, same gates), both deployed via GitHub Actions runs `33670361209` (52s) and `33670998995` (47s).
  - Secret rotation: `gh secret set GEMINI_API_KEY --repo cyalcala/techwriter-bot` from `~/Desktop/gemini777.txt` at 2026-09-02T19:27:50Z, redeployed via workflow_dispatch run `33673471880` (38s, graphify 44s). Health after key sync: `4/6 active, gemini 429` (valid, quota) vs `4/6 active, gemini 400` before.
  - Local probe verification (2026-09-03, exact provider-health body): `gemini-2.5-flash` OK, `gemini-flash-latest` OK, `gemini-2.5-flash-lite` OK, `gemini-2.0-flash` 404, `openai/gpt-oss-20b` OK on both Groq and Nvidia. Invalid Gemini key correctly returns 400 (not 401), explaining the 400.
- Python relevance: NONE.
- Status: FIXED (2026-09-03). Code/model IDs corrected and deployed; Gemini key rotated and now valid (429 = configured correctly, rate-limited). Cerebras remains 402 parked by design. Next health check when Gemini quota resets should show 5/6 active without further code change. Collateral: runbook `F-06_PROVIDER_HEALTH_RUNBOOK.md` already documents the 402/404/410 diagnostic table and probing steps.
