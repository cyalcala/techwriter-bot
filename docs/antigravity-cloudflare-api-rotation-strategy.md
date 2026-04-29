# Antigravity Cloudflare API Rotation Strategy

## Status
Ready for Antigravity continuation.

## Goal
Run the chat API through a smart provider fallback chain on Cloudflare, keeping Cerebras as the preferred provider while preserving reliability through Gemini, OpenRouter, and NVIDIA fallbacks.

Secrets must remain outside source control. Do not paste API keys into code, docs, logs, or commit messages.

## Provider Priority
Use this global provider family order:

1. Cerebras
2. Gemini
3. OpenRouter
4. NVIDIA

Current provider IDs in `src/lib/providers.ts`:

- `cerebras-llama`
- `gemini-flash`
- `openrouter-fast`
- `nvidia-llama-fast`
- `nvidia-minimax`
- `nvidia-deepseek`

Intent routing should follow the same family order:

- `draft`: Cerebras, Gemini, OpenRouter, NVIDIA editing model
- `edit`: Cerebras, Gemini, OpenRouter, NVIDIA editing model
- `outline`: Cerebras, Gemini, OpenRouter, NVIDIA editing model
- `research`: Cerebras, Gemini, OpenRouter, NVIDIA deep model
- `chat-fast`: Cerebras, Gemini, OpenRouter, NVIDIA fast model
- `deep-reason`: Cerebras, Gemini, OpenRouter, NVIDIA deep model

## Secret Names
Use exactly these environment names:

```text
CEREBRAS_API_KEY
GEMINI_API_KEY
OPENROUTER_API_KEY
NVIDIA_API_KEY
```

Local development can read these from `.env`. Cloudflare production must use Cloudflare secrets or dashboard environment variables.

Do not rely on committed fallback keys. Any hardcoded API keys should be removed.

## Cloudflare Setup
Antigravity should set the secrets in the Cloudflare Pages project or Worker environment that serves this Astro app.

Preferred paths:

- Cloudflare dashboard: project settings, environment variables/secrets.
- Wrangler CLI: use the current Wrangler syntax for Pages/Workers secrets and verify it against the installed Wrangler version.

Suggested verification after setting secrets:

```text
GET /api/debug-keys
```

Expected behavior:

- It returns masked values only.
- `CEREBRAS`, `GEMINI`, `OPENROUTER`, and `NVIDIA` should not be `MISSING`.
- It must never return full key values.

## Router Behavior
The router should continue to behave strategically:

- Try providers in the configured priority order.
- Fall back only on temporary failures:
  - 408
  - 409
  - 425
  - 429
  - 500
  - 502
  - 503
  - 504
  - network timeout
- Put temporarily failing providers on a short cooldown before retrying.
- Do not silently fall back on non-retryable failures:
  - missing key
  - auth failure
  - malformed request
  - unsupported model
- Return sanitized errors to the client.
- Log provider names and failure categories, not API keys or provider response bodies.

## Current Implementation Notes
The current relevant files are:

- `src/lib/providers.ts`: provider registry and intent preference order.
- `src/lib/zen-router.ts`: fallback classification, cooldown, timeout, and provider calls.
- `src/pages/api/chat.ts`: request sanitation, rate limiting, runtime env merge, router entrypoint.
- `src/pages/api/debug-keys.ts`: masked diagnostics for configured keys.

The current local environment already contains the expected key names in `.env`, but the values must not be copied into source.

## Local Build Issue
Codex could not run the normal build because this session is blocked from reading `C:\Users\admin`. The error occurs before Astro reaches application code:

```text
EPERM: operation not permitted, lstat 'C:\Users\admin'
```

This appears to be a local folder ownership/sandbox issue, likely because Antigravity owns the folder or permission context.

Antigravity should run verification from its own authorized context:

```text
npm run build
```

If Antigravity sees the same permission issue, move the repo to a neutral path such as `C:\dev\techwriter-bot` or grant the active user read/list access to the parent folder.

## Known Type Check Issue
A resolver-free TypeScript check was able to run and reached project type checking. It reported existing missing declarations for:

```text
src/pages/api/debug-ai.ts: Cannot find module 'cloudflare:workers'
src/pages/api/ingest.ts: Cannot find module 'cloudflare:workers'
```

Antigravity should decide whether to install/configure Cloudflare Workers types or add the correct ambient declaration for `cloudflare:workers`.

## Verification Plan
Antigravity should verify in this order:

1. Confirm `.env` or Cloudflare secrets include the four provider keys.
2. Run `npm run build`.
3. Run the app locally or in a Cloudflare preview.
4. Call `/api/debug-keys` and confirm masked key presence.
5. Send a normal chat request and confirm response header `x-provider` is usually `cerebras-llama`.
6. Temporarily disable or invalidate Cerebras in a safe test environment and confirm fallback to Gemini.
7. Repeat for Gemini to confirm fallback to OpenRouter.
8. Repeat for OpenRouter to confirm fallback to NVIDIA.
9. Confirm no full API key appears in logs, responses, browser console output, or build output.

## Deployment Strategy
Use a staged rollout:

1. Deploy to Cloudflare preview first.
2. Verify secret availability in preview.
3. Run a small set of chat prompts across intents:
   - `chat-fast`
   - `draft`
   - `edit`
   - `research`
   - `deep-reason`
4. Check provider headers and logs.
5. Promote to production only after fallback behavior is confirmed.

## Operational Guardrails
Keep these guardrails in place:

- Rotate keys from provider dashboards if a key was shared in chat or logs.
- Never commit `.env`.
- Keep `.env`, `.env.production`, and local override files ignored.
- Avoid returning raw provider error bodies to users.
- Keep a rate limit on `/api/chat`.
- Consider adding Cloudflare AI Gateway later for centralized observability, caching, and provider analytics.

## Acceptance Criteria
This work is complete when:

- Provider order is Cerebras, Gemini, OpenRouter, NVIDIA for all chat intents.
- Cloudflare has all four secrets configured.
- `/api/debug-keys` confirms masked key presence.
- A normal chat request succeeds.
- Temporary failure of the first provider falls through to the next provider.
- Auth/configuration failures do not get hidden by fallback.
- No full secret values exist in source, logs, or responses.
