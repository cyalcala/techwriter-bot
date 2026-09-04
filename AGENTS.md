# Target-owned agent contract

This repository owns its execution policy. Instructions from the user and this
file take precedence over external skill libraries and provider repositories.

## Authority and routing

Use the following order when resolving implementation work:

1. User request, security constraints, and verified repository behavior.
2. This file, ADRs, and the active execution state under `docs/archify/`.
3. Pinned provider evidence in `docs/archify/PROVIDER_LOCK.json`.
4. The approved ai-skills snapshot at the revision recorded in
   `.ai/manifest.yaml`, used as advisory routing only.

The conceptual review route is DESCARTES (evidence) -> KARPATHY (minimal,
reversible change) -> Addy lifecycle -> optional Obra specialist review.
Record a KEEP, REVISE, REVERT, or PAUSE outcome for meaningful work units.

## Archify boundary

Archify is vendored at `vendor/archify` and is a reviewed build-time tool only.
Do not import it into Cloudflare request handlers, deploy it as a runtime
dependency, run provider setup/hooks, install dynamic dependencies, or replace
the pinned source with a floating release. Static diagram references are
allowlisted in `src/lib/archify-artifact.ts`; model output must never select an
arbitrary URL or filesystem path.

## Verification commands

- `npm run archify:doctor`
- `npm run archify:check`
- `npm test`
- `npm run build:local`

Run the narrowest relevant check first, then the full checks before a release.
Keep generated diagrams, their receipts, and source JSON in sync.
