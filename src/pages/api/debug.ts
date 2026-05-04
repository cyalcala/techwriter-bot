import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { readEnvKeys, checkEnvKeys } from '../../lib/env-reader';
import { getCircuitDiagnostics } from '../../lib/zen-router';
import { searchDuckDuckGo, searchWikipedia } from '../../lib/search';
import { searchReddit } from '../../lib/search-reddit';

export const GET: APIRoute = async ({ request, locals }) => {
  const env: any = {};
  try { if (cfGlobalEnv) Object.assign(env, cfGlobalEnv); } catch {}
  try { const r = (locals as any)?.runtime?.env; if (r) for (const [k, v] of Object.entries(r)) { if (v != null && !env[k]) env[k] = v; } } catch {}
  readEnvKeys(env);

  const providers = ['groq-fast', 'cerebras-llama', 'gemini-flash', 'nvidia-fast', 'openrouter-fast', 'cloudflare-llama'];
  const providerResults: Record<string, any> = {};
  const providerTests = providers.map(async (id) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`https://httpbin.org/get`, { signal: ctrl.signal });
      clearTimeout(t);
      providerResults[id] = { reachable: res.ok, status: res.status, latencyMs: 0 };
    } catch (e: any) {
      providerResults[id] = { reachable: false, error: e.message?.slice(0, 100) };
    }
  });

  const searchTests = [
    searchDuckDuckGo('test query').then(r => ({ ddg: { reachable: !!r, results: r ? 1 : 0 } })),
    searchWikipedia('test query').then(r => ({ wiki: { reachable: !!r, results: r ? 1 : 0 } })),
    searchReddit('test query').then(r => ({ reddit: { reachable: !!r, results: r ? 1 : 0 } })),
  ];

  const [searchResults] = await Promise.all([Promise.all(searchTests), Promise.all(providerTests)]);
  const searchStatus: Record<string, any> = {};
  for (const r of searchResults) Object.assign(searchStatus, r);

  const keys = checkEnvKeys(env);
  const keyCount = Object.values(keys).filter(Boolean).length;
  const circuits = getCircuitDiagnostics();
  const workingProviders = Object.entries(circuits).filter(([, v]: any) => v.requests > 0).map(([k]) => k);

  return new Response(JSON.stringify({
    env: { keys_loaded: keyCount, ai_binding: !!env.AI, kv_binding: !!env.SESSION },
    providers: providerResults,
    search: searchStatus,
    circuits,
    verdict: {
      ready: workingProviders.length > 0,
      best_provider: workingProviders[0] || 'none',
      search_working: Object.values(searchStatus).some((s: any) => s.reachable),
    },
    clientIP: request.headers.get('cf-connecting-ip') || 'unknown',
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
};
