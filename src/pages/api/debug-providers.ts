import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { ZEN_REGISTRY, getProvider } from '../../lib/providers';
import { getCircuitDiagnostics } from '../../lib/zen-router';

export const GET: APIRoute = async ({ locals }) => {
  let env: any = {};
  try { if (cfGlobalEnv) env = { ...(cfGlobalEnv as any) }; } catch (e) {}
  try { const r = (locals as any)?.runtime?.env; if (r) env = { ...env, ...r }; } catch (e) {}

  const results: any[] = [];

  for (const provider of ZEN_REGISTRY) {
    const result: any = {
      id: provider.id,
      role: provider.role,
      model: provider.model,
      freeTier: provider.freeTier,
      hasApiKey: false,
      status: 'unknown',
    };

    if (provider.name === 'cloudflare') {
      result.hasApiKey = !!env.AI;
    } else {
      const key = env[`${provider.name.toUpperCase()}_API_KEY`];
      result.hasApiKey = typeof key === 'string' && key.length > 8;
      if (result.hasApiKey) {
        result.keyPrefix = String(key).slice(0, 8) + '...';
      }
    }

    try {
      if (!result.hasApiKey) {
        result.status = 'no_key';
        results.push(result);
        continue;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      let endpoint: string;
      if (provider.name === 'cloudflare') {
        const ai = env.AI;
        if (!ai) throw new Error('No AI binding');
        const aiResult = await ai.run(provider.model as any, {
          messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
          max_tokens: 4,
        });
        result.status = 'ok';
        result.response = aiResult?.response || 'no response';
      } else {
        endpoint = provider.name === 'gemini'
          ? `${provider.endpoint}/openai/chat/completions`
          : `${provider.endpoint}/chat/completions`;

        const apiKey = String(env[`${provider.name.toUpperCase()}_API_KEY`]).trim();
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: 'user', content: 'Say "ok"' }],
            max_tokens: 4,
          }),
          signal: controller.signal,
        });

        if (res.ok) {
          const data = await res.json();
          result.status = 'ok';
          result.response = data?.choices?.[0]?.message?.content?.slice(0, 20) || 'no text';
        } else {
          result.status = `http_${res.status}`;
          result.error = (await res.text().catch(() => '')).slice(0, 100);
        }
      }

      clearTimeout(timeout);
    } catch (e: any) {
      result.status = 'error';
      result.error = e.message?.slice(0, 100);
    }

    results.push(result);
  }

  return new Response(JSON.stringify({
    providers: results,
    circuitBreakers: getCircuitDiagnostics(),
    summary: {
      ok: results.filter(r => r.status === 'ok').length,
      total: results.length,
      free: results.filter(r => r.freeTier).length,
    },
  }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};