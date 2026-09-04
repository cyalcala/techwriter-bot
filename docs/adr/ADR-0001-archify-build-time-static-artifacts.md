# ADR-0001: Use Archify only at build time

## Status

Accepted (2026-09-05).

## Context

The application runs on Cloudflare Pages/Workers. Archify v2.13.0 is a Node CLI:
its CLI and renderers use filesystem, path, process, and child-process APIs.
That is incompatible with a request-time Workers implementation.

## Decision

Vendor the exact reviewed release, validate JSON IR in CI/local Node, and commit
the resulting static HTML. The app may render only an allowlisted reference to a
checked-in page through a sandboxed iframe without `allow-same-origin`. The
delivery wrapper removes remote font links and adds a network-denying CSP.

## Consequences

There is no dynamic Archify API endpoint and no arbitrary diagram URL support.
New diagrams require a reviewed JSON source, receipt, output, and CI check.
This intentionally trades ad-hoc runtime generation for a portable, auditable,
edge-compatible static experience.
