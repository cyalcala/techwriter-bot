import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('privacy-first content retention', () => {
  it('keeps uploaded document chunks in memory and clears them', async () => {
    const rag = await import('../lib/rag-db');

    await rag.storeVectors('session-private', [{ text: 'private content', vector: [1, 0] }]);
    expect((await rag.getStoredVectors('session-private'))[0]?.text).toBe('private content');

    await rag.clearSessionVectors('session-private');
    expect(await rag.getStoredVectors('session-private')).toEqual([]);
  });

  it('does not write user content into durable application storage', () => {
    expect(source('src/lib/session-persist.ts')).not.toContain('localStorage.setItem');
    expect(source('src/lib/cleanup.ts')).toContain("localStorage.removeItem('tw_conv')");
    expect(source('src/lib/rag-db.ts')).not.toContain('indexedDB.open');
    expect(source('src/pages/api/chat.ts')).not.toContain("from '../../lib/query-cache'");
    expect(source('src/pages/api/chat.ts')).not.toContain('searchRagKV');
    expect(source('src/pages/api/chat.ts')).not.toContain('idempotencyKey');
    expect(source('src/pages/api/chat.ts')).not.toContain('cached.body');
    expect(source('src/components/ChatIsland.svelte')).not.toContain('idempotencyKey');
    expect(source('src/pages/api/rag-store.ts')).not.toContain('.put(');
    expect(source('src/lib/query-cache.ts')).not.toContain('.put(');
    expect(source('src/lib/search.ts')).not.toContain('.put(');
    expect(source('src/lib/search.ts')).not.toContain('searchCache.set');
    expect(source('src/lib/kroki-renderer.ts')).not.toContain('.put(');
    expect(source('src/pages/api/render-artifact.ts')).toContain("'Cache-Control': 'no-store, private'");
  });

  it('does not log search terms in provider-error diagnostics', () => {
    expect(source('src/lib/search.ts')).not.toMatch(/query:\s*query/);
    expect(source('src/lib/search-reddit.ts')).not.toMatch(/query:\s*query/);
    expect(source('src/lib/search-enhanced.ts')).not.toMatch(/query:\s*query/);
  });

  it('keeps document tool source and findings out of durable application storage', () => {
    const island = source('src/components/ChatIsland.svelte');
    const panel = source('src/components/DocumentToolsPanel.svelte');
    const ragClient = source('src/lib/rag-client.ts');
    const graphTool = source('src/pages/api/tool-graph-lookup.ts');

    expect(island).toContain('toolDocument');
    expect(island).toContain('toolFindings');
    expect(island).not.toContain('localStorage.setItem');
    expect(panel).not.toContain('fetch(');
    expect(panel).not.toContain('localStorage');
    expect(ragClient).not.toContain('localStorage');
    expect(ragClient).not.toContain('indexedDB');
    expect(graphTool).not.toContain('.put(');
    expect(graphTool).not.toContain('console.');
  });

  it('offers an expandable accessible privacy notice with accurate wording', () => {
    const input = source('src/components/ChatInput.svelte');

    expect(input).toContain('aria-expanded={privacyOpen}');
    expect(input).toContain('id="privacy-notice"');
    expect(input).toContain("style:grid-template-rows={privacyOpen ? '1fr' : '0fr'}");
    expect(input).toContain('class="min-h-0 overflow-hidden"');
    expect(input).toContain('Private by default');
    expect(input).toContain('durable application storage');
    expect(input).toMatch(/no online service\s+can promise absolute security/);
  });

  it('offers open-session-only continuity during a live provider outage', () => {
    const island = source('src/components/ChatIsland.svelte');

    expect(island).toContain('createLiveOutageState');
    expect(island).toContain('Live AI unavailable.');
    expect(island).toContain('this open session only');
    expect(island).toContain('onclick={regenerate}');
  });

  it('keeps production integration secrets out of build artifacts', () => {
    const workflow = source('.github/workflows/deploy.yml');
    const buildStart = workflow.indexOf('      - name: Build');
    const buildEnd = workflow.indexOf('\n      - name:', buildStart + 1);
    const buildStep = workflow.slice(buildStart, buildEnd);
    const runtimeSecretsStart = workflow.indexOf('      - name: Configure runtime secrets before deployment');
    const deployStart = workflow.indexOf('      - name: Deploy to Cloudflare Pages');

    expect(workflow).not.toContain('Inject env vars into wrangler.json');
    expect(workflow).not.toContain('Create .env from secrets');
    expect(buildStep).not.toContain('GROQ_API_KEY');
    expect(buildStep).not.toContain('TURNSTILE_SECRET_KEY');
    expect(runtimeSecretsStart).toBeGreaterThan(buildStart);
    expect(runtimeSecretsStart).toBeLessThan(deployStart);
    expect(workflow).toContain("{ type: 'secret_text', value: v }");
    expect(workflow).not.toContain('console.log(d)');
    expect(workflow).toContain('process.exitCode = 1');
  });

  it('deploys the hardening branch through preview configuration with bounded operational publication', () => {
    const workflow = source('.github/workflows/deploy.yml');
    const graphify = source('scripts/graphify-ci.sh');
    const wrangler = source('wrangler.json');

    expect(workflow).toContain('codex/privacy-first-disclosure');
    expect(workflow).toContain("if: github.ref_name == 'main' || github.ref_name == 'codex/privacy-first-disclosure'");
    expect(workflow).toContain("DEPLOYMENT_ENV: ${{ github.ref_name == 'main' && 'production' || 'preview' }}");
    expect(workflow).toContain('deployment_configs: { [process.env.DEPLOYMENT_ENV]: { env_vars:');
    expect(workflow).not.toContain("PROJECT_NAME: { type: 'plain_text'");
    expect(wrangler).toContain('"PROJECT_NAME": "tw-bot"');
    expect(wrangler).toContain('"APP_VERSION": "0.0.1"');
    expect(workflow).toContain('Publish application version marker');
    expect(workflow).toContain('"tw-bot:app:version" "$APP_VERSION" --remote');
    expect(workflow).toContain('--branch ${{ github.ref_name }}');
    expect(graphify).toContain('--binding=SESSION "graph:latest" --path=graphify-out/graph.json.gz --remote');
    expect(graphify).toContain('--binding=SESSION "graph:version" --path=/tmp/gv.txt --remote');
  });

  it('runs deployment actions on supported Node 24 paths without redundant wrappers or uv setup', () => {
    const workflow = source('.github/workflows/deploy.yml');
    const graphify = source('scripts/graphify-ci.sh');

    expect(workflow).toContain('actions/checkout@v6');
    expect(workflow).toContain('actions/setup-node@v6');
    expect(workflow).toContain('actions/setup-python@v6');
    expect(workflow).not.toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24');
    expect(workflow).not.toContain('cloudflare/wrangler-action@');
    expect(workflow).toContain('run: npx wrangler pages deploy dist/client');
    expect(workflow).not.toContain('astral-sh/setup-uv');
    expect(workflow).not.toContain('uv tool install graphifyy');
    expect(graphify).toContain('python3 -m pip install graphifyy');
    expect(graphify).not.toContain('uv pip install');
  });
});
