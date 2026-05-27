# Documentation Tooling Agent Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first human-controlled documentation tooling workflow: review an uploaded in-session document with deterministic checks, then offer bounded read-only project reference lookup.

**Architecture:** Keep tool execution explicit and narrow. A pure TypeScript document-review module operates on text retained only in live Svelte state after a user upload. A compact tools panel invokes that module and displays findings without adding them to chat automatically. A later graph lookup route wraps the existing graph index behind input/output bounds and no writes.

**Tech Stack:** Astro, Svelte 5, TypeScript, Vitest, Cloudflare Pages Functions and existing Graphify-backed graph query utilities.

---

## Boundaries

- No WebContainer, browser runtime, arbitrary command execution, file mutation, package installation, or autonomous tool chaining.
- No durable storage of uploaded source text, review findings, or graph lookup input/results.
- No OAuth, Stripe, multi-tenancy, email, marketing pages, Kubernetes, Redis, or complex dashboards.
- A user action must start every tool operation; tool results remain separate from chat unless the user chooses to use them.

## Task 1: Deterministic Document Review Engine

**Files:**
- Create: `src/lib/document-review.ts`
- Create: `src/tests/document-review.test.ts`

- [ ] Write failing tests for clean content, skipped heading levels, unclosed code fences, empty Markdown destinations, duplicate headings, and session-supplied terminology.

```ts
import { describe, expect, it } from 'vitest';
import { reviewDocument } from '../lib/document-review';

describe('reviewDocument', () => {
  it('returns no findings for a structurally clean document', () => {
    expect(reviewDocument('# Title\n\n## Setup\n\n[Docs](https://example.com)')).toEqual([]);
  });

  it('reports deterministic structure findings with source lines', () => {
    const findings = reviewDocument('# Title\n\n### Too deep\n\n## Repeated\n\n## Repeated\n\n[Missing]()');
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'heading-level-skip', line: 3 }),
      expect.objectContaining({ rule: 'duplicate-heading', line: 7 }),
      expect.objectContaining({ rule: 'empty-link', line: 9 }),
    ]));
  });

  it('reports an unclosed fenced code block', () => {
    expect(reviewDocument('# Title\n\n```ts\nconst open = true;')).toContainEqual(
      expect.objectContaining({ rule: 'unclosed-code-fence', line: 3 }),
    );
  });

  it('uses terminology preferences supplied for this review only', () => {
    const findings = reviewDocument('The whitelist is configured.', [
      { avoid: 'whitelist', prefer: 'allowlist' },
    ]);
    expect(findings).toContainEqual(
      expect.objectContaining({ rule: 'terminology', line: 1 }),
    );
  });
});
```

- [ ] Run the focused test to prove RED.

Run: `npx.cmd vitest run src/tests/document-review.test.ts`

Expected: FAIL because `../lib/document-review` does not exist.

- [ ] Implement a pure review function with stable result types and no I/O.

```ts
export type DocumentFindingRule =
  | 'heading-level-skip'
  | 'unclosed-code-fence'
  | 'empty-link'
  | 'duplicate-heading'
  | 'terminology';

export interface TerminologyRule {
  avoid: string;
  prefer: string;
}

export interface DocumentFinding {
  rule: DocumentFindingRule;
  severity: 'warning' | 'error';
  line: number;
  message: string;
}

export function reviewDocument(content: string, terminology: TerminologyRule[] = []): DocumentFinding[] {
  // Normalize lines, scan outside fenced blocks, track headings and empty links,
  // report an open fence, and apply only caller-supplied terminology rules.
}
```

- [ ] Run focused tests to prove GREEN.

Run: `npx.cmd vitest run src/tests/document-review.test.ts`

Expected: PASS.

- [ ] Commit the pure engine checkpoint.

```bash
git add src/lib/document-review.ts src/tests/document-review.test.ts
git commit -m "feat: add deterministic document review engine"
git push origin codex/privacy-first-disclosure
```

## Task 2: Active-Session Source Handoff And Explicit Review UI

**Files:**
- Modify: `src/lib/rag-client.ts`
- Create: `src/components/DocumentToolsPanel.svelte`
- Modify: `src/components/ChatIsland.svelte`
- Modify: `src/tests/privacy-first.test.ts`
- Create: `src/tests/document-tools-ui.test.ts`

- [ ] Add failing contract tests showing that review requires an explicit action, uploaded document text is held only in component state, and it is removed by all existing session-clearing paths.

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const island = readFileSync('src/components/ChatIsland.svelte', 'utf8');
const rag = readFileSync('src/lib/rag-client.ts', 'utf8');

describe('document tool UI boundaries', () => {
  it('holds review source only in active component state', () => {
    expect(island).toContain('toolDocument');
    expect(rag).toContain('sourceText');
    expect(rag).not.toContain('localStorage');
    expect(rag).not.toContain('SESSION.put');
  });

  it('runs review only through an explicit control and clears tool state', () => {
    expect(island).toContain('reviewDocument(');
    expect(island).toContain('runDocumentReview');
    expect(island.match(/toolDocument = null/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] Return source text from a successful upload without adding durable writes.

```ts
export interface UploadResult {
  success: boolean;
  sourceText?: string;
  // retain existing result fields
}

// In handleFileUpload, after successful validation/processing:
return { success: true, sourceText: text, /* existing fields */ };
```

- [ ] Add in-memory tool state and lifecycle clearing to `ChatIsland.svelte`.

```ts
let toolDocument = $state<{ name: string; text: string } | null>(null);
let toolFindings = $state<DocumentFinding[]>([]);
let toolsOpen = $state(false);

function runDocumentReview() {
  toolFindings = toolDocument ? reviewDocument(toolDocument.text) : [];
}

function clearDocumentToolState() {
  toolDocument = null;
  toolFindings = [];
  toolsOpen = false;
}
```

Set `toolDocument` only after a successful upload. Call `clearDocumentToolState()` from `removeFile`, `newChat`, and `clearChat`.

- [ ] Build `DocumentToolsPanel.svelte` as a compact tool surface: a `Review Document` control, the loaded filename, empty/disabled state until upload, and scan-friendly findings with line labels. Do not insert findings into messages automatically.

- [ ] Run focused tests and the privacy regression suite.

Run: `npx.cmd vitest run src/tests/document-review.test.ts src/tests/document-tools-ui.test.ts src/tests/privacy-first.test.ts`

Expected: PASS.

- [ ] Verify the interaction in a browser when the local Astro server becomes available: upload Markdown, click `Review Document`, confirm findings display, remove document, confirm findings disappear.

- [ ] Commit the explicit review workflow checkpoint.

```bash
git add src/lib/rag-client.ts src/components/DocumentToolsPanel.svelte src/components/ChatIsland.svelte src/tests/privacy-first.test.ts src/tests/document-tools-ui.test.ts
git commit -m "feat: add in-session document review tool"
git push origin codex/privacy-first-disclosure
```

## Task 3: Bounded Read-Only Graph Lookup

**Files:**
- Read first: `graphify-out/GRAPH_REPORT.md`
- Read first: `src/lib/graph-query.ts`
- Create: `src/lib/tool-graph-lookup.ts`
- Create: `src/pages/api/tool-graph-lookup.ts`
- Modify: `src/components/DocumentToolsPanel.svelte`
- Modify: `src/components/ChatIsland.svelte`
- Create: `src/tests/tool-graph-lookup.test.ts`
- Modify: `src/tests/api-routes-consistency.test.ts`

- [ ] Add failing tests for empty/oversized input rejection, graph unavailable behavior, bounded response output, and absence of content persistence.

```ts
describe('tool graph lookup contract', () => {
  it('rejects blank and oversized terms before graph querying');
  it('returns no more than the configured output budget');
  it('uses no content writes or raw diagnostic output');
});
```

- [ ] Implement a small wrapper with a fixed contract and bounds.

```ts
export interface ToolGraphLookupResult {
  available: boolean;
  context: string;
  nodeCount: number;
}

export function validateLookupTerm(term: string): string {
  const normalized = term.trim();
  if (!normalized || normalized.length > 200) throw new Error('INVALID_LOOKUP_TERM');
  return normalized;
}

export function boundLookupResult(result: GraphContext): ToolGraphLookupResult {
  return {
    available: result.available,
    context: result.context.slice(0, 4000),
    nodeCount: Math.min(result.nodeCount, 20),
  };
}
```

- [ ] Add a POST-only API endpoint that validates a query, calls existing read-only graph query utilities, returns standardized errors, and performs no `KV.put`, logging of query contents, or server-side caching of user input.

- [ ] Add `Find Code References` as the second explicitly triggered panel mode. Results render read-only and remain in component memory only.

- [ ] Run focused tests and API consistency tests.

Run: `npx.cmd vitest run src/tests/tool-graph-lookup.test.ts src/tests/api-routes-consistency.test.ts src/tests/privacy-first.test.ts`

Expected: PASS.

- [ ] Commit the bounded graph lookup checkpoint.

```bash
git add src/lib/tool-graph-lookup.ts src/pages/api/tool-graph-lookup.ts src/components/DocumentToolsPanel.svelte src/components/ChatIsland.svelte src/tests/tool-graph-lookup.test.ts src/tests/api-routes-consistency.test.ts
git commit -m "feat: add bounded graph reference lookup"
git push origin codex/privacy-first-disclosure
```

## Task 4: Verification, Documentation, And Deployment Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/MASTER_EXECUTION_PLAN.md`
- Modify: `docs/IMPLEMENTATION_STATUS.md`

- [ ] Document the delivered user-controlled tooling behavior, privacy constraints, verification evidence, GitHub checkpoint hashes, and the remaining live deployment acceptance gate.

- [ ] Run all tests.

Run: `npm.cmd test`

Expected: PASS.

- [ ] Audit production source for disallowed durable content/tool-result storage and public diagnostics leakage.

```powershell
$privacy = rg -n "localStorage\.setItem|indexedDB\.open|rag:\$\{|qcache:|cached\.body|idempotencyKey|searchCache\.set|toolDocument|toolFindings" src -g "!tests"
$diagnostics = rg -n "keys_loaded|Object\.keys\(env\)|Keys missing|String\(error\.message\)|error:\s*String\(error" src\pages\api src\components src\lib -g "!tests"
```

Expected: Any `toolDocument` or `toolFindings` matches exist only in live component state; no durable content writes and no exposed diagnostics.

- [ ] Run the recorded build verification command.

```powershell
subst T: C:\Users\admin\Desktop\techwriter-bot
Set-Location -LiteralPath 'T:\'
$env:NODE_OPTIONS='--preserve-symlinks --preserve-symlinks-main'
$env:CLOUDFLARE_REMOTE_BINDINGS='false'
npm.cmd run build:local
```

Expected: PASS, with any existing nonblocking Wrangler/Node warnings recorded accurately.

- [ ] If an authenticated deployment path is available, deploy the hardened branch through that authorized path and repeat public endpoint acceptance checks for `/api/health`, `/api/chat`, `/api/debug`, and `/api/debug-ai`. If it remains unavailable, retain deployment acceptance as explicit outstanding work.

- [ ] Commit and push documentation/verification evidence.

```bash
git add README.md docs/MASTER_EXECUTION_PLAN.md docs/IMPLEMENTATION_STATUS.md
git commit -m "docs: record documentation tooling verification"
git push origin codex/privacy-first-disclosure
```
