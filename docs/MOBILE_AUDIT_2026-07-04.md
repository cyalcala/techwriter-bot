# Mobile Audit — 2026-07-04

## Objective

User report: `https://tw-bot.pages.dev/` "does not work on mobile." This
document is the handoff record for the audit/debug pass requested on
2026-07-04. It follows the existing project convention in
`docs/AI_RECOVERY_TRAIL.md`: GitHub is the source of truth, not chat history.

Read this file together with `docs/AI_RECOVERY_TRAIL.md` and
`docs/IMPLEMENTATION_STATUS.md` (see their "Next Task" / "Continue Prompt"
sections, which now point back here).

## Session Setup

- Repo cloned fresh to `C:\Users\admin\Downloads\techwriter-bot` from
  `https://github.com/cyalcala/techwriter-bot.git` at commit `5ded853`
  (`fix: resolve mobile AI availability, turnstile payloads, and kroki test`,
  2026-06-20).
- `npm install` completed successfully (Node v22.13.1).
- No `.env` was created — no AI/search/Turnstile provider keys are configured
  in this sandbox. Backend chat responses cannot be exercised locally; this
  pass is scoped to layout/rendering/interaction bugs reproducible without
  live provider keys.
- Note for future agents: an unrelated stray `git` repository exists rooted at
  `C:\` on this machine (`git -C techwriter-bot rev-parse --show-toplevel`
  would return `C:/` if run from outside this clone). The techwriter-bot
  clone has its own nested `.git` and is unaffected, but do not run git
  commands from `C:\Users\admin\Downloads` itself without `cd`-ing into
  `techwriter-bot` first, or they will target the wrong repo.

## Method

1. Dispatched a read-only research pass over `docs/SYSTEM_SAVEPOINT.md`,
   `docs/IMPLEMENTATION_STATUS.md`, `docs/AI_RECOVERY_TRAIL.md`,
   `docs/MASTER_EXECUTION_PLAN.md`, `docs/RESILIENCE_PLAN.md`, `CHANGELOG.md`,
   plus the mobile-related component/CSS/test source, to establish what prior
   agents already fixed and verified.
2. Attempted live reproduction two ways:
   - Chrome extension (`claude-in-chrome`) — **not connected** in this
     session ("Claude in Chrome is not connected"). Not yet retried to
     completion.
   - Local dev server (`astro dev` via the Cloudflare adapter) at a mobile
     viewport using the Claude Code preview tool — **blocked**, see below.
3. Queried the project's existing `graphify-out/graph.json` for prior
   recorded "local preview" and mobile issues.

## Confirmed Finding: Local Dev Server Hang (environment, not app code)

`npm run dev` (`astro dev`) starts, prints the Wrangler/Miniflare warning:

```
[WARNING] AI bindings always access remote resources, and so may incur usage
charges even in local dev. To suppress this warning, set `remote: true` for
the binding definition in your configuration file.
```

...and then never actually binds port 4321. `curl http://localhost:4321/`
returns `ERR_CONNECTION_REFUSED` / hangs indefinitely; `preview_screenshot`
and `preview_resize` both time out waiting on the tab.

This matches a **pre-existing, already-documented** caveat, not a new
regression: `docs/IMPLEMENTATION_STATUS.md` "Next Task" already says:

> If local browser smoke remains blocked by the Cloudflare local preview
> issue, record that caveat and rely on build plus production smoke after
> deployment.

Prior accepted mobile verification (`docs/IMPLEMENTATION_STATUS.md`, Phase 4
closure) was done by running **real Playwright CLI against the production
URL** at a 390x844 viewport, not against local dev. That is the path to use
for reproduction going forward — see "Next Steps" below.

Do not spend further time trying to make `astro dev` bind locally in this
sandbox unless the AI binding can be stubbed/mocked or `remote` config
resolved; it has now failed for at least two separate agent sessions
(this one, and the earlier EPERM/Antigravity session recorded in
`docs/antigravity-cloudflare-api-rotation-strategy.md`).

## Static Analysis Findings (read-only, not yet verified live)

From reading `src/styles/global.css`, `src/components/ChatIsland.svelte`,
`ChatInput.svelte`, `ArtifactPanel.svelte`, `ArtifactSplitView.svelte`,
`ArtifactOverlay.svelte`, `ArtifactStandalone.svelte`, and
`src/tests/mobile-artifacts.test.ts`:

**Looks correct:**
- Viewport height uses `h-dvh` (dynamic viewport height), not legacy `100vh`
  — correctly handles mobile browser chrome show/hide.
- `<meta name="viewport" content="width=device-width, initial-scale=1.0,
  maximum-scale=5.0, user-scalable=yes">` is present and reasonable
  (`src/pages/index.astro:35`).
- `ArtifactOverlay.svelte` implements fixed-position modal, scroll-lock
  (saves/restores `overflow`/`overscrollBehavior`), pointer-event-based swipe
  dismiss, and pointer-event-based pinch zoom (1x–3x clamp), all consistent
  with `src/tests/mobile-artifacts.test.ts`.
- Diagram-width mobile fixes from commit history (`1eec50d`, `ba64c9e`,
  `4062f97`, `684ee74`) look intact in current source.

**Gaps / candidate root causes, in priority order:**

1. **`src/tests/mobile-artifacts.test.ts` is static source-pattern
   verification only** (regex/string checks that the code contains certain
   patterns), not a real rendered-browser interaction test. A live mobile
   regression (e.g. a runtime JS error, a CSS specificity fight with Tailwind
   v4, a real touch-event quirk) would not be caught by this suite. This is
   the single biggest reason a real "broken on mobile" report could coexist
   with "all tests green."
2. **Mobile detection is imperative and narrow**
   (`ChatIsland.svelte`: `isMobile = window.innerWidth < 768`, set on
   `onMount` and on `window.resize` only). No `orientationchange` listener,
   no `matchMedia` listener. A phone rotated after load, or a browser that
   fires viewport changes without a plain `resize` event (some in-app
   browsers, PWAs, foldables), could leave `isMobile` stale and break the
   scroll-lock / overlay behavior that depends on it.
3. **Chat input textarea has no explicit max-height/rows constraint** — on a
   small screen, a long pasted message could grow the textarea and push the
   send button or message history out of the visible viewport, since there's
   no cap forcing it to scroll internally instead of growing.
4. **Swipe-dismiss max offset (180px) and header touch target do not appear
   to account for `env(safe-area-inset-*)`** — on notched/Dynamic-Island
   devices in particular, this is a plausible source of "the overlay is hard
   to use / feels broken" complaints, though it wouldn't cause a hard
   failure.
5. **CSP is unusually strict for a chat app that loads third-party renderer
   scripts client-side**: `public/_headers` sets
   `Cross-Origin-Embedder-Policy: credentialless` +
   `Cross-Origin-Opener-Policy: same-origin`, alongside `script-src` allowing
   `esm.sh`, `unpkg.com`, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`,
   `webcontainer.io`. COEP/COOP enforcement and cross-origin resource timing
   can differ meaningfully between mobile Safari/Chrome and their desktop
   counterparts, especially on older iOS versions. This is a plausible
   candidate for a mobile-only failure (e.g. mermaid/kroki renderer assets
   silently failing to load only on mobile) but is **unconfirmed** — needs a
   real mobile console/network trace against production to check for CSP
   violation reports.
6. Minor/cosmetic: `src/components/ArtifactPanel.svelte` has duplicate
   `case` handling for a few artifact types (code cleanliness only, not
   believed to cause the mobile bug).

None of the above is confirmed as *the* cause yet — they are ranked
candidates pending a real mobile reproduction.

## What Was NOT Yet Done

- No code changes have been made yet. This pass was research + attempted
  reproduction only.
- Have not yet captured real mobile console errors, network failures, or a
  screenshot from either the Chrome extension or a Playwright run against
  `https://tw-bot.pages.dev/`.
- Have not confirmed which specific behavior is broken from the user's
  point of view (blank page? layout overflow? unresponsive input? diagrams
  not rendering? AI responses not returning on mobile specifically?). The
  user's report was "does not work," without further detail.

## Next Steps (for whichever agent/session picks this up)

1. **Get a real reproduction first — do not guess-fix.** Two viable paths,
   in order of preference:
   - Retry the `claude-in-chrome` MCP tools (`tabs_context_mcp` →
     `navigate` to `https://tw-bot.pages.dev/` → `resize_window` to a phone
     size, e.g. 390x844 → `read_console_messages` with `onlyErrors: true` →
     `read_network_requests` filtered to `failed` → screenshot). This was
     not connected at the time of this audit; it may simply need a retry or
     the user re-opening/signing in to the extension.
   - Or ask the user directly what "does not work" means on their device
     (blank screen? can't type? can't send? diagrams broken? which
     browser/OS?) — this is the fastest way to cut the candidate list above
     down to one item.
2. Once reproduced, check the browser console/network tab specifically for
   CSP violation reports (`Content-Security-Policy` violations show up as
   console errors, not silent) to confirm/rule out candidate #5 above.
3. Fix the confirmed root cause with the smallest possible change. Re-run
   `npm test` (vitest) and, since local dev is blocked in this sandbox, rely
   on the production-smoke pattern already established in
   `docs/IMPLEMENTATION_STATUS.md` after deploying.
4. Update `docs/IMPLEMENTATION_STATUS.md` "Latest Checkpoint" and
   `docs/AI_RECOVERY_TRAIL.md` "Latest Checkpoint" with the commit hash,
   verification evidence, and GitHub Actions run id, per their existing
   format — do not just leave the record in this file.
5. Commit and push; the `deploy.yml` workflow deploys on push to `main`
   automatically.

## Continue Prompt

```text
Continue the mobile audit for techwriter-bot from
docs/MOBILE_AUDIT_2026-07-04.md. Read docs/AI_RECOVERY_TRAIL.md and
docs/IMPLEMENTATION_STATUS.md "Next Task" first for the project's standing
rules. The local Cloudflare/astro dev server hangs on startup in this
sandbox (known issue, not a regression) — do not waste time re-debugging
that; instead reproduce against the live production URL
https://tw-bot.pages.dev/ via a real mobile-viewport browser (claude-in-chrome
MCP tools, or ask the user for device/browser details and exact symptoms).
Candidate root causes are ranked in the "Static Analysis Findings" section
above — confirm one with real console/network evidence before writing a fix.
No code changes have been made yet as of this file's writing.
```
