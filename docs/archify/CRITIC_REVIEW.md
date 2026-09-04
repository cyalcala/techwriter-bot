# Independent critic review

## Scope

Read-only review of the pinned provider boundary, static delivery pipeline,
artifact parser/iframe integration, receipts, and CI configuration.

## Finding and resolution

| Severity | Finding | Resolution | Status |
| --- | --- | --- | --- |
| Warning | A `frame-ancestors` directive in an HTML meta CSP is not enforced by browsers, so the initial generated-page policy could not enforce anti-framing. | Added the stricter `/diagrams/*` Cloudflare Pages response-header policy in `public/_headers`: it first detaches the site-wide values that Pages would otherwise append, then sets `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`, `connect-src 'none'`, and the static CSP. This permits the deliberate same-origin sandboxed iframe while preventing third-party framing. Added an automated assertion and regenerated all pages/receipts. | RESOLVED |

No ship-blocking defect was identified after the resolution. The static iframe
continues to omit `allow-same-origin`, and static artifact pages have no remote
resource attributes.
