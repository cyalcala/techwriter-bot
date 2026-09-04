# Archify integration guide

## What is installed

The repository vendors Archify v2.13.0 under `vendor/archify` with its MIT
license. The precise repository/tag/commit/tree and file hashes are locked in
[`PROVIDER_LOCK.json`](./PROVIDER_LOCK.json). No runtime package dependency is
added and no provider install script runs during application build or request
handling.

## Runtime decision

Archify's CLI and renderers use Node filesystem, path, process, and
child-process APIs. The application runs on Cloudflare Pages/Workers, so the
runtime renderer outcome is **PAUSE**. We deliberately ship static output:

1. Author one schema-v1 JSON file in `docs/diagrams/src`.
2. Run the pinned CLI from `scripts/archify.mjs` to validate and deliver it.
3. Strip remote asset/help links, inject a network-denying CSP, and attest to
   the final bytes in `docs/diagrams/receipts`.
4. Serve the page under `public/diagrams` only through a sandboxed iframe with
   `allow-scripts allow-downloads` and no `allow-same-origin`.

The user-visible `archify` artifact type accepts only a small JSON reference to
the five checked-in pages. It has no URL or path field and is validated before
the iframe is created.

## Commands

```sh
npm run archify:doctor
npm run archify:validate
npm run archify:deliver
npm run archify:check
npm run backup:archify
```

`archify:deliver` rewrites the generated output and receipts. Review both;
generated output should remain static, self-contained, and use the CSP recorded
in its receipt. `archify:check` validates every source/output/receipt pair and
runs Archify's final artifact checks.

`backup:archify` produces a SHA-addressed Git bundle and verification manifest
in the ignored `.archify-backups/` directory. It verifies the bundle, performs
a clean clone into a temporary directory, and runs `git fsck` before reporting
success. Run it after each committed checkpoint; CI independently uploads the
same source and generated-artifact evidence.

## Supported static references

| ID | Mode | Page |
| --- | --- | --- |
| `techwriter-architecture` | architecture | `/diagrams/techwriter-architecture.html` |
| `artifact-workflow` | workflow | `/diagrams/artifact-workflow.html` |
| `chat-request-sequence` | sequence | `/diagrams/chat-request-sequence.html` |
| `context-dataflow` | dataflow | `/diagrams/context-dataflow.html` |
| `provider-circuit-lifecycle` | lifecycle | `/diagrams/provider-circuit-lifecycle.html` |

## Update policy

Treat provider upgrades as a fresh review: obtain an exact tag/commit, record
license and hashes, inspect runtime compatibility, rerun all five diagram modes,
and update the ledger/ADR if the boundary changes. Never replace the vendor tree
from an unpinned or floating release.
