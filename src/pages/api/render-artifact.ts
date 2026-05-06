import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { renderViaKroki, KROKI_RENDERABLE } from '../../lib/kroki-renderer';

function loadEnv(locals: any): any {
  const env: any = {};
  try { if (cfGlobalEnv) Object.assign(env, cfGlobalEnv); } catch {}
  try { const r = (locals as any)?.runtime?.env; if (r) for (const [k, v] of Object.entries(r)) { if (v != null && !env[k]) env[k] = v; } } catch {}
  return env;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = loadEnv(locals);

  try {
    const body = await request.json().catch(() => null);
    if (!body?.type || !body?.code) {
      return new Response(JSON.stringify({ error: 'invalid', message: 'type and code required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const { type, code } = body;
    if (!KROKI_RENDERABLE.has(type)) {
      return new Response(JSON.stringify({ error: 'unsupported_type', message: `${type} is not server-renderable` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const result = await renderViaKroki(type, code, env.SESSION);
    if (result.svg) {
      return new Response(JSON.stringify({ svg: result.svg, cached: result.cached }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: result.error || 'render_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'server_error', message: e.message?.slice(0, 200) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
