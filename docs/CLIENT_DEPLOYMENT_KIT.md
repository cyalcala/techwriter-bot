# Client Deployment Kit

Date: 2026-06-03

This kit is the Phase 5A runbook for turning the accepted Techwriter Bot product
into a repeatable client-owned deployment. It is intentionally documentation
first: no OAuth, Stripe, multi-tenancy, email, marketing pages, autonomous
agents, Redis, Kubernetes, complex dashboards, or WebContainer/runtime package
tooling.

## Deployment Goal

Deploy one isolated Techwriter Bot instance into one client's Cloudflare
account, with that client controlling its own Cloudflare project, provider
credentials, optional search keys, and brand voice.

The current app is ready for paid pilots as a per-client internal tool. The
remaining deployment work is about repeatability and evidence:

- Configure environment values.
- Deploy to Cloudflare Pages.
- Confirm provider health.
- Confirm the app shell, sample data, document tools, graph lookup, artifact
  rendering, export/import, and privacy notices.
- Record the exact run evidence in the handoff docs.

## Read First

Before a deployment pass, read:

1. `docs/MASTER_EXECUTION_PLAN.md`
2. `docs/IMPLEMENTATION_STATUS.md`
3. `docs/AI_RECOVERY_TRAIL.md`
4. `docs/SELLABLE_READINESS_HANDOFF.md`
5. `docs/PORTFOLIO_BUYER_NARRATIVE.md`
6. `graphify-out/GRAPH_REPORT.md`

## Deployment Paths

### Path A: Existing GitHub Actions Deployment

Use this for the current production project only.

The current workflow is `.github/workflows/deploy.yml`. It:

- Runs on pushes to `main` and `codex/privacy-first-disclosure`.
- Builds the production bundle with Node 22.
- Configures runtime secret env vars in Cloudflare before deployment.
- Writes `tw-bot:app:version` to the `SESSION` KV binding.
- Deploys `dist/client` to the hardcoded Cloudflare Pages project `tw-bot`.
- Runs a Graphify CI job that publishes the runtime graph when credentials
  allow it.

Important: this workflow is intentionally tied to the current `tw-bot` Pages
project. For a new client-owned deployment, either use Path B first or update
the workflow project name, API path, app-version KV prefix, and Cloudflare
project settings in that client's fork.

### Path B: Per-Client Shell Deployment

Use this for a new client-owned Cloudflare account or a first client pilot.

The `deploy.sh` script:

- Loads `.env` if present.
- Uses `PROJECT_NAME` as the Cloudflare Pages project name.
- Creates or updates a `SESSION` KV namespace binding.
- Validates configured provider API keys with one-token pings.
- Writes `APP_VERSION` to prefixed KV.
- Builds the Astro app.
- Copies the worker bundle/chunks into the Pages output.
- Runs `wrangler pages deploy`.

This is the more flexible path for per-client deployments because it reads the
client project name and settings from `.env`.

## Client Configuration Checklist

Start from `.env.template`. Never commit a filled `.env` file.

Required deployment identity:

- `PROJECT_NAME`: Cloudflare Pages project name and durable KV prefix.
- `APP_VERSION`: app/schema version, currently `0.0.1`.
- `CLOUDFLARE_ACCOUNT_ID`: client's Cloudflare account id.
- `CLOUDFLARE_API_TOKEN`: Cloudflare token with Pages/KV permissions.

Required AI provider posture:

- Configure at least one external provider key before `deploy.sh`:
  - `GROQ_API_KEY`
  - `CEREBRAS_API_KEY`
  - `GEMINI_API_KEY`
  - `NVIDIA_API_KEY`
  - `OPENROUTER_API_KEY`
- Cloudflare Workers AI is configured through the `AI` binding in
  `wrangler.json`, but external provider keys are still needed for the current
  `deploy.sh` validation gate.

Recommended client voice and branding:

- `SYSTEM_PROMPT`: client writing policy, markdown and multiline supported.
- `PERSONA_NAME`: assistant name shown in header and greeting.
- `APP_TITLE`: optional app title override.
- `APP_LOGO_URL`: optional logo URL; invalid values fall back safely.
- `PRIMARY_COLOR`: optional hex color; invalid values fall back safely.
- `FOOTER_TEXT`: optional footer copy.

Optional search and protection:

- `TAVILY_API_KEY`: enhanced search provider.
- `EXA_API_KEY`: enhanced search provider.
- `TURNSTILE_SECRET_KEY`: recommended for production abuse protection.
- `DEV_IPS`: comma-separated development IP allowlist, default
  `127.0.0.1,::1`.
- `STATS_PASSWORD`: enables protected `/api/stats` with content-free
  operational aggregates only.

Safety limits:

- `RATE_LIMIT_PER_MINUTE`, default `30`.
- `RATE_LIMIT_PER_DAY`, default `500`.
- `CHAT_MAX_CHARS`, default `4000`.
- `MAX_REQUEST_BODY_BYTES`, default `5242880`.
- `HEALTH_PING_TIMEOUT_MS`, default `5000`.

Controlled acceptance harness:

- `PROVIDER_FAULT_INJECTION_TOKEN` should normally stay blank.
- Set it only during bounded provider-failover acceptance testing.
- Remove it or rotate it after the acceptance window.

## Per-Client Setup Steps

1. Clone or fork the repository for the client.
2. Install Node 22 or newer.
3. Run `npm ci`.
4. Copy `.env.template` to `.env`.
5. Fill `PROJECT_NAME`, Cloudflare account values, provider keys, client voice,
   and branding.
6. Confirm `wrangler.json` is appropriate for the client:
   - `name` should match the target Pages project if using Wrangler config.
   - `vars.PROJECT_NAME` should match the client prefix when not overridden by
     runtime env.
   - `kv_namespaces[0].binding` must remain `SESSION`.
   - `ai.binding` must remain `AI` when Workers AI is used.
7. Run local verification.
8. Run `bash deploy.sh`.
9. Capture the deployed URL.
10. Run production acceptance checks.
11. Record evidence in `docs/IMPLEMENTATION_STATUS.md` and
    `docs/AI_RECOVERY_TRAIL.md`.
12. Commit and push the docs checkpoint to GitHub.

## Local Verification

For docs-only deployment-kit changes, `git diff --check` is enough.

For behavior changes, use the recorded Windows build gate from
`docs/IMPLEMENTATION_STATUS.md`:

```powershell
subst T: C:\Users\admin\Desktop\techwriter-bot
Set-Location -LiteralPath 'T:\'
$env:NODE_OPTIONS='--preserve-symlinks --preserve-symlinks-main'
$env:CLOUDFLARE_REMOTE_BINDINGS='false'
npm.cmd run build:local
```

Recommended full local gate before a client deployment:

```powershell
git status --short --branch
npm.cmd test
npm.cmd audit --omit=dev --audit-level=high
git diff --check
```

Known acceptable warnings:

- Node `punycode` deprecation warning during build.
- Cloudflare local AI-binding warning when remote bindings are disabled.
- CRLF conversion warnings from Git on Windows, as long as `git diff --check`
  reports no whitespace errors.

## Production Acceptance Runbook

Set the production base URL:

```powershell
$base = 'https://CLIENT_PROJECT.pages.dev'
```

App shell:

```powershell
$page = Invoke-WebRequest "$base/" -UseBasicParsing
$page.StatusCode
$page.Content.Contains('Try sample data')
$page.Content.Contains('Export session before leaving')
$page.Content.Contains('Private by default')
```

Expected:

- Status `200`.
- `Try sample data` is present.
- Active-session refresh/navigation notice is present.
- Privacy notice is present.

Health endpoint:

```powershell
$health = Invoke-RestMethod "$base/api/health"
$health.status
$health.appVersion.expected
$health.appVersion.stored
$health.appVersion.mismatch
$health.providers.active
```

Expected:

- `status` is `ok`.
- App version expected/stored values match.
- Version mismatch is false.
- At least one provider is active.
- Response exposes sanitized availability only, not raw secrets or provider
  error details.

Bounded graph lookup:

```powershell
$lookupBody = @{ term = 'sampleData' } | ConvertTo-Json
$lookup = Invoke-RestMethod -Method Post "$base/api/tool-graph-lookup" -ContentType 'application/json' -Body $lookupBody
$lookup.available
$lookup.nodeCount
```

Expected:

- `available` is true when the runtime graph is published.
- `nodeCount` is greater than 0 for known terms such as `sampleData`,
  `whiteLabel`, `graceful degradation`, or `mobile artifact`.
- Response is private and no-store.

Artifact renderer smoke:

```powershell
$renderBody = @{
  type = 'graphviz'
  code = 'digraph G { A -> B }'
} | ConvertTo-Json
$render = Invoke-RestMethod -Method Post "$base/api/render-artifact" -ContentType 'application/json' -Body $renderBody
$render.svg.Contains('<svg')
```

Expected:

- Valid graph returns SVG.
- Render responses remain `Cache-Control: no-store, private`.

Manual browser checks:

- Open the app.
- Click `Try sample data`.
- Ask a sample documentation question.
- Upload a small Markdown file and run `Review Document`.
- Run `Find Code References` for a bounded term.
- Generate or paste a diagram artifact and confirm the panel can show source,
  retry renderer, and export source/SVG/PNG where applicable.
- Export a JSON session, refresh the page, import it, and confirm messages,
  artifacts, and document metadata restore while source text remains
  metadata-only until re-uploaded.
- On mobile viewport, open an artifact overlay, confirm body scroll lock,
  pinch zoom, and swipe-down dismissal.

## Client Demo Script

Use this sequence for a sales or pilot demo:

1. Open the branded app.
2. Point out the privacy notice and active-session export/import boundary.
3. Click `Try sample data`.
4. Ask: "Summarize the sample API and release documentation workflow."
5. Run `Review Document` on the loaded sample docs.
6. Run `Find Code References` for a known product term.
7. Ask for a small diagram or workflow artifact.
8. Show artifact source/export controls.
9. Export the chat as Markdown.
10. Explain that production client data stays in the active session unless the
    user explicitly exports a file.

## Troubleshooting Map

Provider health is not ok:

- Check at least one provider key is configured.
- Check provider account quota and key validity.
- Check `HEALTH_PING_TIMEOUT_MS` if providers are slow.
- Confirm Cloudflare runtime secrets were configured before deployment.

App version mismatch:

- Confirm `APP_VERSION` matches `package.json` and deployment env.
- Rerun deployment to write the current version marker.
- Follow privacy-safe cleanup guidance in `/api/health`; preserve only
  non-content operational state.

Graph lookup unavailable:

- Confirm the Graphify CI job published the runtime graph.
- Confirm `SESSION` KV is bound.
- Use `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` as the
  local tracked fallback for investigation.

Artifact renderer failure:

- Confirm Kroki is reachable for server-renderable diagram types.
- Valid syntax should return SVG.
- Permanent syntax errors should show inline guidance and not retry forever.
- The user can view code, fix source, and retry.

Sample data missing:

- Confirm the app shell includes `Try sample data`.
- Confirm no client-specific app customization hid the empty-chat area.

Stats unavailable:

- Confirm `STATS_PASSWORD` is configured.
- Send either `Authorization: Bearer <value>` or `x-stats-password`.
- Remember that stats are content-free operational aggregates only.

## Support Boundary To Explain To Clients

Say this plainly:

- The app is private by default, but no online service is magic.
- Chat, documents, generated answers, search-result content, and rendered
  artifacts are not intentionally stored in durable application storage.
- The open browser session holds active content while the page is open.
- Refreshing or navigating away ends that active session unless the user exports
  a JSON backup first.
- Export/import is user-invoked and contains messages, artifacts, and document
  metadata, not uploaded source text or vectors.
- Provider, search, Cloudflare, and renderer services may process content as
  needed to provide the requested feature under their own terms.
- Limited non-content operational metadata may persist for reliability, health,
  rate limits, versioning, and abuse protection.

## Evidence To Record After Each Client Deployment

Add a docs checkpoint with:

- Client project name or anonymized client label.
- Commit hash deployed.
- Deployment path used: GitHub Actions or `deploy.sh`.
- GitHub Actions run id and immutable URL when available.
- Production alias URL.
- `/api/health` status, active provider count, app-version status, and request
  id.
- App shell smoke result.
- Bounded graph lookup result.
- Artifact renderer smoke result.
- Manual demo/browser checks completed.
- Any caveats and next safe task.

## Self-Client Dry Run Evidence

Completed on 2026-06-03 after the first Phase 5A kit checkpoint
`64d43e5` (`docs: add client deployment kit`).

GitHub Actions:

- Run `26883926741` completed successfully for `main`.
- Immutable Cloudflare Pages URL:
  `https://2482adc7.tw-bot.pages.dev`.
- Graphify CI uploaded the runtime graph to KV.

Production alias smoke:

- Base URL: `https://tw-bot.pages.dev`.
- App shell returned `200`.
- Page contained `Technical Writer`, `Try sample data`, the active-session
  export-before-leaving notice, and the privacy notice.
- `/api/health` returned `ok`, generated at `2026-06-03T12:13:21.835Z`.
- Provider status: 4 active providers out of 6 configured providers.
- App version: expected `0.0.1`, stored `0.0.1`, mismatch `false`.
- Bounded graph lookup for `sampleData` returned `200`,
  `Cache-Control: no-store, private`, `available: true`, and 2 nodes.
- Graphviz render smoke returned `200`, `Cache-Control: no-store, private`,
  and SVG content.

Immutable URL smoke:

- Base URL: `https://2482adc7.tw-bot.pages.dev`.
- App shell returned `200`.
- Page contained `Technical Writer`, `Try sample data`, the active-session
  export-before-leaving notice, and the privacy notice.
- `/api/health` returned `ok` with 4 active providers out of 6.
- App version: expected `0.0.1`, stored `0.0.1`, mismatch `false`.

## Next Safe Task

Use this kit for the first real client-style Cloudflare deployment when a client
account is available. Until then, continue with:

- Capturing the Phase 5C screenshot checklist from
  `docs/PORTFOLIO_BUYER_NARRATIVE.md`.
- A real client deployment using Path B once client credentials are available.
