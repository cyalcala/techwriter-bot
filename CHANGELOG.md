# Changelog

All notable changes to this project are documented in this file.

## [2.1.0] - 2026-05-11 — One-Shot Artifact Rendering Engine Overhaul

### Overview
This release eliminates all artifact rendering cascades, locks providers during diagram generation for one-shot reliability, hardens all 12 renderer types with proper timeouts, and removes unnecessary double-renders.

### Problem Statement (Pre-Fix)
1. **Not one-shot**: Diagram requests caused the AI to switch providers mid-generation, causing lag and inconsistent output.
2. **Mermaid→Kroki double-render cascade**: Client-side Mermaid would try to render, fail, then Kroki would be triggered — even for syntax errors that Kroki would also fail on.
3. **Provider switching lag**: When `groq-fast` circuit-broke, the router switched to `gemini-flash` mid-conversation, causing the "switching provider" lag.
4. **Renderer timeouts too long**: Mermaid (8s), KaTeX (10s), Markmap (10s) — all allowed hanging renders to block the UI.
5. **Kroki triggered unnecessarily**: Kroki was called for ALL diagram types including mermaid, vega, and flowchart — even though mermaid and flowchart have client-side renderers.

### Changes

#### `src/lib/zen-router.ts`
- **Provider lock for artifacts**: When `forceSticky=true` (artifact requests), the session-locked provider is tried exclusively — no cycling through fallback providers.
- **Circuit bypass for locked provider**: The session-locked provider bypasses circuit-open checks for artifact requests.
- **Faster timeout for fast path**: Increased from 12s to 15s for better reliability.
- **maxTokensOverride support**: Allows 2048 tokens for artifact requests even on the `fast` chat path.

#### `src/pages/api/chat.ts`
- **Artifact path**: Sets `effectivePath='fast'` for minimal latency, but passes `maxTokensOverride=2048` so diagrams have enough output space.
- **Session affinity preserved**: No longer overrides pool with a hardcoded list for artifact requests — keeps the session-locked provider as priority.
- **forceSticky**: Ensures the provider stays locked for the entire artifact generation.

#### `src/lib/renderer-loader.ts`
- **Mermaid timeout**: Reduced from 8s → 5s. Fails fast, shows error, no cascade.
- **KaTeX timeout**: Reduced from 10s → 5s.
- **Markmap timeout**: Reduced from 10s → 8s.
- **All server-side renders** (D2, Graphviz, PlantUML, Vega): Already had 15s timeouts with proper error display. Confirmed working.

#### `src/components/ChatIsland.svelte`
- **Kroki server-only**: Only calls Kroki for types with NO client-side renderer — `d2`, `graphviz`, `plantuml`.
- **Client-only types**: `mermaid`, `vega`, `flowchart` render entirely client-side. No Kroki call, no cascade.
- **One-shot server fetch**: Single attempt with 15s timeout. On error, stores the error on the entry — no auto-retry, no AI prompt injection.
- **Single AbortController**: Cleanly abortable request.

#### `src/lib/kroki-renderer.ts`
- **Reduced timeout**: 12s → 10s for faster fail feedback.
- **Proper retry logic**: 1 retry with 2s delay for 5xx/network errors only. 4xx errors return immediately (permanent failures).

#### `src/lib/prompts.ts`
- **Strengthened ARTIFACT_COMPACT**: Added rules against asking which format to use, mandate to output artifact immediately as the first response, output ONLY the artifact tag.

#### `src/pages/api/render-artifact.ts`
- **Cache-Control headers**: Successful Kroki renders are cached at the edge (86400s if cached, 3600s if fresh).

### All 12 Artifact Types — Stability Status

| Type | Client Renderer | Server (Kroki) | Status |
|------|----------------|----------------|--------|
| `code` | Prism.js | N/A | ✅ Stable |
| `html` | iframe sandbox | N/A | ✅ Stable |
| `svg` | Direct DOM | N/A | ✅ Stable |
| `mermaid` | Mermaid.js (5s timeout) | N/A — client only | ✅ One-shot |
| `react` | Babel + React UMD | N/A | ✅ Stable |
| `katex` | KaTeX (5s timeout) | N/A | ✅ Stable |
| `markmap` | markmap-autoloader (8s timeout) | N/A | ✅ Stable |
| `d2` | N/A | Kroki (10s timeout + retry) | ✅ One-shot |
| `vega` | vega-embed | Kroki fallback | ✅ Client-first |
| `graphviz` | N/A | Kroki (10s timeout + retry) | ✅ One-shot |
| `plantuml` | N/A | Kroki (10s timeout + retry) | ✅ One-shot |
| `flowchart` | Flowchart.js (client) | Kroki fallback | ✅ Client-first |
| `webcontainer` | WebContainer API | N/A | ✅ Stable |

### Deployment
- **Build**: Passes `npm run build` with zero errors
- **Tests**: All 12 critical tests pass (`vitest run src/tests/critical.test.ts`)
- **GitHub Actions**: Deploys automatically on push to `main` via `Deploy to Cloudflare Pages` workflow
- **Live**: https://tw-bot.pages.dev

---

## [2.0.0] - 2026-05-10 — Intelligent Artifact Auto-Correction Fallback
(Previous release — see git history)

## [1.x] - Earlier releases
(See git log for full history)