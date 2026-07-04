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

## Confirmed Symptom (from user, 2026-07-04)

The user reports that on mobile, sending a chat message returns a "no AI
available" style response — the app tells the user no AI is available and
the tool cannot be used on mobile. This is a live, user-confirmed repro
detail (not yet independently verified by an agent against production).

This is a strong lead: the tip commit on `main`, `5ded853`
("fix: resolve mobile AI availability, turnstile payloads, and kroki test",
2026-06-20), already targeted this exact symptom — "mobile AI availability"
and "turnstile payloads" — meaning either that fix was incomplete, or a
regression reintroduced it. The likely code paths to check first, next
session:

- `src/lib/zen-router.ts` — returns `AI_PROVIDERS_UNAVAILABLE` /
  `"All AI providers are currently unavailable. Please try again in a
  moment."` (`unavailableResponse()`, around line 238) when every provider
  in the fallback chain fails or is skipped. This is the most likely source
  of the literal message the user is seeing.
- `src/lib/turnstile.ts` and wherever the client invokes the Turnstile
  widget/token — if Turnstile verification is a prerequisite gate before
  the chat route will call any provider, a mobile-specific Turnstile
  failure (widget not loading, token not generated, token rejected) could
  present to the user as "no AI available" even though the real cause is a
  blocked/failed challenge, not actual provider outage.
- **`public/_headers` CSP looks suspicious for Turnstile specifically**:
  `script-src` and `frame-src` in the current CSP do **not** list
  `https://challenges.cloudflare.com` (only `connect-src` does). Turnstile
  normally needs to load a script and/or render a challenge iframe from
  `challenges.cloudflare.com`. If the client-side widget relies on script/
  iframe loading (rather than a fully server-side check), this CSP gap
  could silently block Turnstile — worth checking whether this manifests
  only on mobile (e.g. a stricter or differently-timed CSP enforcement, or
  a code path that only requires Turnstile under certain conditions such as
  IP reputation scoring in `src/lib/reputation.ts` that could disproportionately
  affect mobile carrier IPs) or everywhere equally (in which case it isn't
  mobile-specific and the real cause is elsewhere).
- `src/lib/session-continuity.ts` (`AI_PROVIDERS_UNAVAILABLE` handling) and
  the `liveOutage` / "Live AI unavailable" banner in `ChatIsland.svelte`
  (~line 1403) are the client-side rendering of this failure state — useful
  to confirm which exact code path/message the user is hitting.

Not yet traced end-to-end — this is the top-priority next step, above the
general layout/CSS candidates listed earlier in this document.

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

---

## Session 2 (2026-07-04, afternoon) — Real Mobile Reproduction + Provider Health Evidence

A second session got a **real browser reproduction working** and captured
production evidence that strongly corroborates the "Confirmed Symptom"
section above (the "no AI available" message). Still **no app code
changes** — the user asked for a checkpoint before the fix session.

### Reproduction method (working, reusable)

- `claude-in-chrome` MCP was still not connected (second session in a row).
- **Working fallback discovered:** a prior session left `playwright-core`
  in the npx cache at
  `C:\Users\admin\AppData\Local\npm-cache\_npx\31e32ef8478fbf80\node_modules\playwright-core`
  and it launches the **system Chrome** via `channel: 'chrome'` headless —
  no Playwright browser download needed. If that cache path is gone, run
  `npm i playwright-core` anywhere and keep `channel: 'chrome'`.
- The exact repro harness is committed at **`scripts/mobile-repro.mjs`**
  (iPhone-class emulation: 390x844, DPR 3, touch, iOS UA; captures console
  errors, page errors, failed requests, 4xx/5xx responses, screenshots,
  hydration + horizontal-overflow checks). Run:
  `node scripts/mobile-repro.mjs` (edit the absolute playwright-core path
  at the top if the cache moved).
- A second, **not-yet-run** pass is committed at
  **`scripts/mobile-repro2.mjs`** (Android profile 360x740; diagram
  request → artifact chip → overlay → Tools panel). The user interrupted
  before it ran. **Run this first thing next session.**

### Result: the core mobile flow WORKS in emulated mobile Chrome

Evidence committed under `output/playwright/mobile-audit-2026-07-04/`:

- `m1-initial.png` — clean first paint at 390x844; layout correct.
- `m2-typed.png` / `m3-after-send.png` — message typed, sent, and a real
  AI reply rendered end-to-end.
- `mobile-repro-results.json` — **zero console errors, zero page errors,
  zero failed network requests, zero 4xx/5xx responses**; astro-island
  hydrated (`ssr` attribute removed, input enabled); **no horizontal
  overflow** (`bodyScrollWidth 390 == innerWidth 390`).

So the failure is NOT load/hydrate/layout/send in a Chromium mobile
profile. This demotes the layout/CSS/COEP candidates (#1, #2, #5 in the
Session 1 ranking) and strengthens the provider-availability lead.

### KEY EVIDENCE: 4 of 6 AI providers are DOWN on production

`GET https://tw-bot.pages.dev/api/health` at 2026-07-04 ~05:05 UTC
(snapshot committed at
`output/playwright/mobile-audit-2026-07-04/health-snapshot-2026-07-04.json`):

| provider | status | meaning |
|---|---|---|
| cerebras-llama | **403** | key invalid/revoked/blocked |
| groq-fast | **403** | key invalid/revoked/blocked |
| gemini-flash | **429** | quota exhausted (retryable) |
| cloudflare-llama | **null** | Workers AI binding call failing outright |
| nvidia-fast | 200 OK | alive |
| openrouter-fast | 200 OK | alive |

The successful test reply visibly went through the **Failover** path first
(UI badges: groq-fast → cerebras-llama → gemini-flash, all 01:03 PM)
before a live provider answered. With only 2 of 6 providers healthy, any
transient failure or rate-limit of nvidia + openrouter =
`AI_PROVIDERS_UNAVAILABLE` from `zen-router.ts` = exactly the
user-confirmed "no AI available" symptom. Mobile networks (carrier IPs,
higher latency, reputation scoring in `src/lib/reputation.ts`) may make
this more frequent on the user's phone, but the root outage is
device-independent.

This makes the provider outage the **#1 confirmed-evidence root cause**.
The 403s are key problems (user action: rotate/replace Cerebras and Groq
keys, check Gemini quota); the `cloudflare-llama` null-status failure is
code/config side (`src/lib/providers.ts`, `wrangler.json` `ai` binding)
and should be debugged next session. The Turnstile-CSP lead in the
"Confirmed Symptom" section above remains worth checking as a possible
*additional* mobile-specific gate, but note the served (middleware) CSP
comes from `src/lib/security-headers.ts`, not `public/_headers` — and
neither lists `challenges.cloudflare.com` in `script-src`.

### Secondary lead: iOS Safari auto-zoom on the chat input (not yet fixed)

The chat input renders at **15px** font (`text-[15px]`, visible in the
SSR HTML and `ChatInput.svelte`). iOS Safari auto-zooms the page when
focusing any input with font-size < 16px, and with
`maximum-scale=5.0, user-scalable=yes` in the viewport meta that zoom is
allowed and sticks — leaving a fixed-height `h-dvh overflow-hidden` chat
shell partially off-screen. A classic "broken on iPhone" symptom that
Chromium emulation cannot reproduce. Low-risk fix: 16px input font on
mobile (e.g. `text-base md:text-[15px]`). Not applied yet.

### What remains for the fix session (priority order)

1. Run `node scripts/mobile-repro2.mjs` (diagram/artifact-overlay/Tools
   pass at 360x740); file results next to the existing evidence.
2. Debug and fix the `cloudflare-llama` (Workers AI binding) failure —
   this is the only fully-in-code provider and it should never 403/expire.
3. Ask the user to rotate the Cerebras + Groq API keys and check the
   Gemini quota; re-run `/api/health` to confirm recovery.
4. Trace the Turnstile gate (see "Confirmed Symptom" section): whether a
   blocked `challenges.cloudflare.com` script/iframe can present as
   "no AI available" on mobile, given the CSP in
   `src/lib/security-headers.ts` omits it from `script-src`/`frame-src`.
5. Apply the 16px input-font fix for iOS auto-zoom.
6. Session-1 refinements still open: `matchMedia`/`orientationchange`
   mobile detection, textarea max-height cap, safe-area insets, duplicate
   `case` cleanup in `ArtifactPanel.svelte`.
7. `npm test`, push to `main` (deploy.yml auto-deploys), production smoke
   via `scripts/mobile-repro.mjs`, then update the checkpoints in
   `docs/AI_RECOVERY_TRAIL.md` and `docs/IMPLEMENTATION_STATUS.md`.

## Continue Prompt (updated after Session 2)

```text
Continue the mobile audit for techwriter-bot from
docs/MOBILE_AUDIT_2026-07-04.md — read "Confirmed Symptom" and the
"Session 2" section; they supersede the Session 1 candidate ranking.
Reproduction now works via scripts/mobile-repro.mjs (playwright-core +
system Chrome; local astro dev remains blocked — do not re-debug it). The
core mobile UI flow is confirmed working in emulated Chrome; the
evidence-backed root cause of "no AI available on mobile" is the provider
outage (4 of 6 providers down — see
output/playwright/mobile-audit-2026-07-04/health-snapshot-2026-07-04.json).
Work the numbered list in "What remains for the fix session". A separate
new task (video/presentation generation upgrade) is briefed in
docs/VIDEO_PRESENTATION_UPGRADE_BRIEF.md.
```
