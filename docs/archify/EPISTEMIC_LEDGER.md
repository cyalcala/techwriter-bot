# Archify epistemic ledger

| Claim | Status | Evidence | Operating consequence |
| --- | --- | --- | --- |
| The target already has an artifact parser, queue, renderer panel, and Cloudflare adapter. | VERIFIED | `src/lib/{stream-parser,artifact-queue,renderer-loader}.ts`, `src/components/ArtifactPanel.svelte`, `astro.config.mjs` | Integrate a small allowlisted artifact type instead of a parallel viewer. |
| Archify v2.13.0 is pinned at `2c1f8ac…`. | VERIFIED | `docs/archify/PROVIDER_LOCK.json`, vendored LICENSE/package/SKILL hashes | Never resolve `latest` or download at build time. |
| Archify can produce five static interactive HTML diagram modes. | VERIFIED | `vendor/archify/SKILL.md`, `vendor/archify/bin/archify.mjs`, generated receipts | Use checked-in source JSON and generated static output. |
| Archify is safe inside a Cloudflare request handler. | CONTRADICTED | `vendor/archify/bin/archify.mjs` and renderers import Node filesystem, process, and child-process APIs | PAUSE runtime renderer work; no `/api/render-archify` endpoint. |
| Generated output can be served without remote resources. | VERIFIED AFTER HARDENING | `scripts/archify.mjs` strips remote font links, injects CSP, and `archify:check` rejects remote URLs | Keep the sandbox and static CSP required. |
| A production deployment exists for this branch. | UNKNOWN | Deployment depends on repository credentials and configured Cloudflare environment | Verify only after CI/deployment telemetry reports success. |

The ledger is deliberately falsifiable: a new Archify release, source inspection,
or a failed artifact check must update the affected row before policy changes.
