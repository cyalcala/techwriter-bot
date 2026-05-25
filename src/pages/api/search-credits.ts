import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { createRequestId, jsonResponse } from '../../lib/api-response';
import { kvKey } from '../../lib/kv-prefix';

export const GET: APIRoute = async ({ request, locals }) => {
  const requestId = createRequestId();
  let env: any = {};
  try { if (cfGlobalEnv) env = { ...(cfGlobalEnv as any) }; } catch (e) {}
  try { const rEnv = (locals as any)?.runtime?.env; if (rEnv) for (const [k, v] of Object.entries(rEnv)) { if (v != null && !env[k]) env[k] = v; } } catch (e) {}
  if (typeof process !== 'undefined' && process.env) { for (const [k, v] of Object.entries(process.env)) { if (v && !env[k]) env[k] = v; } }

  const clientIP = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

  const devIPs = (env.DEV_IPS || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  const isDev = devIPs.includes(clientIP);

  if (isDev) {
    return jsonResponse({
      remaining: -1,
      unlimited: true,
      searchTier: 'enhanced',
      apiCredits: { used: 0, remaining: -1 },
    }, { requestId });
  }

  const creds = { used: 0, remaining: 3 };

  try {
    const today = new Date().toISOString().slice(0, 10);
    if (env.SESSION) {
      const key = kvKey(env, `search:enhanced:${clientIP}:${today}`);
      const raw = await env.SESSION.get(key);
      const used = parseInt(raw || '0', 10);
      creds.used = used;
      creds.remaining = Math.max(0, 3 - used);
    }

    let tier = 'curious';
    if (env.SESSION) {
      const repRaw = await env.SESSION.get(kvKey(env, `reputation:${clientIP}`));
      if (repRaw) {
        try {
          const rep = JSON.parse(repRaw);
          tier = rep.tier || 'curious';
          const limits = rep.tier
            ? (rep.tier === 'premium' || rep.tier === 'standard' || rep.tier === 'curious' ? 3 : 0)
            : 3;
          creds.remaining = Math.max(0, limits - creds.used);
        } catch {}
      }
    }
  } catch (e: any) {
    console.log(JSON.stringify({ event: 'credits_error', message: e.message?.slice(0, 100) }));
  }

  let budgetExhausted = false;
  try {
    if (env.SESSION) {
      const monthKey = new Date().toISOString().slice(0, 7);
      for (const p of ['tavily', 'exa']) {
        const key = kvKey(env, `search:enhanced:total:${p}:${monthKey}`);
        const raw = await env.SESSION.get(key);
        if (parseInt(raw || '0', 10) >= 1000) {
          budgetExhausted = true;
          break;
        }
      }
    }
  } catch {}

  return jsonResponse({
    remaining: creds.remaining,
    unlimited: false,
    searchTier: creds.remaining > 0 ? 'enhanced' : 'basic',
    apiCredits: creds,
    budgetExhausted,
  }, { requestId });
};
