import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { createRequestId, jsonResponse } from '../../lib/api-response';
import { readEnvKeys, checkEnvKeys } from '../../lib/env-reader';
import { getCircuitDiagnostics } from '../../lib/zen-router';
import { searchDuckDuckGo, searchWikipedia } from '../../lib/search';
import { searchReddit } from '../../lib/search-reddit';
import { ZEN_REGISTRY } from '../../lib/providers';

async function pingProvider(id: string, env: any): Promise<{ reachable: boolean; status: number; latencyMs: number; error?: string }> {
  const provider = ZEN_REGISTRY.find(p => p.id === id);
  if (!provider) return { reachable: false, status: 0, latencyMs: 0, error: 'unknown provider' };

  const key = env[`${provider.name.toUpperCase()}_API_KEY`];
  if (!key && provider.name !== 'cloudflare') return { reachable: false, status: 0, latencyMs: 0, error: 'no api key' };

  const start = Date.now();
  try {
    if (provider.name === 'cloudflare') {
      const ai = env.AI;
      if (!ai) return { reachable: false, status: 0, latencyMs: 0, error: 'no AI binding' };
      try {
        await ai.run(provider.model as any, { messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false });
        return { reachable: true, status: 200, latencyMs: Date.now() - start };
      } catch (e: any) {
        return { reachable: true, status: 200, latencyMs: Date.now() - start, error: 'model loaded' };
      }
    }

    const endpoint = provider.name === 'gemini'
      ? `${provider.endpoint}/openai/chat/completions`
      : `${provider.endpoint}/chat/completions`;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false }),
      signal: ctrl.signal,
    });
    clearTimeout(t);

    const latency = Date.now() - start;
    const body = await res.text().catch(() => '');
    return {
      reachable: true,
      status: res.status,
      latencyMs: latency,
      error: res.status >= 400 ? body.slice(0, 200) : undefined,
    };
  } catch (e: any) {
    return { reachable: false, status: 0, latencyMs: Date.now() - start, error: e.message?.slice(0, 100) };
  }
}

export const GET: APIRoute = async ({ request, locals }) => {
  const requestId = createRequestId();
  const env: any = {};
  try { if (cfGlobalEnv) Object.assign(env, cfGlobalEnv); } catch {}
  try { const r = (locals as any)?.runtime?.env; if (r) for (const [k, v] of Object.entries(r)) { if (v != null && !env[k]) env[k] = v; } } catch {}
  readEnvKeys(env);

  const providerIds = ['groq-fast', 'gemini-flash', 'cerebras-llama', 'nvidia-fast', 'openrouter-fast', 'cloudflare-llama'];
  const providerResults: Record<string, any> = {};
  const providerTests = providerIds.map(async (id) => {
    providerResults[id] = await pingProvider(id, env);
  });

  const testQuery = 'artificial intelligence';
  const searchTests = [
    searchDuckDuckGo(testQuery).then(r => ({ ddg: { reachable: !!r, results: r ? 1 : 0 } })),
    searchWikipedia(testQuery).then(r => ({ wiki: { reachable: !!r, results: r ? 1 : 0 } })),
    searchReddit(testQuery).then(r => ({ reddit: { reachable: !!r, results: r ? 1 : 0 } })),
  ];

  const [searchResults] = await Promise.all([Promise.all(searchTests), Promise.all(providerTests)]);
  const searchStatus: Record<string, any> = {};
  for (const r of searchResults) Object.assign(searchStatus, r);

  const keys = checkEnvKeys(env);
  const circuits = getCircuitDiagnostics();
  const workingProviders = Object.entries(providerResults).filter(([, v]: any) => v.reachable && v.status < 400).map(([k]) => k);

  return jsonResponse({
    env: { keys_loaded: Object.values(keys).filter(Boolean).length, ai_binding: !!env.AI, kv_binding: !!env.SESSION },
    providers: providerResults,
    search: searchStatus,
    circuits,
    verdict: {
      ready: workingProviders.length > 0,
      best_provider: workingProviders[0] || 'none',
      providers_ok: workingProviders,
      search_working: Object.values(searchStatus).some((s: any) => s.reachable),
    },
    clientIP: request.headers.get('cf-connecting-ip') || 'unknown',
  }, { requestId });
};
