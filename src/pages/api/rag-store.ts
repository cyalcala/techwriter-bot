import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request, locals }) => {
  const env: any = {};
  try { if (cfGlobalEnv) Object.assign(env, cfGlobalEnv); } catch {}
  try { const r = (locals as any)?.runtime?.env; if (r) for (const [k, v] of Object.entries(r)) { if (v != null && !env[k]) env[k] = v; } } catch {}

  if (!env.SESSION) {
    return new Response(JSON.stringify({ error: 'KV not available' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body?.sessionId || !body?.chunks || !Array.isArray(body.chunks)) {
      return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const { sessionId, chunks } = body;
    const vectors: { text: string; vector: number[]; timestamp: number }[] = [];

    for (const chunk of chunks) {
      if (typeof chunk.text !== 'string' || !Array.isArray(chunk.vector)) continue;
      if (chunk.text.length > 2000) continue;
      vectors.push({
        text: chunk.text.slice(0, 2000),
        vector: chunk.vector.slice(0, 384),
        timestamp: Date.now(),
      });
    }

    if (vectors.length === 0) {
      return new Response(JSON.stringify({ error: 'no_valid_chunks' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const key = `rag:${sessionId}`;
    await env.SESSION.put(key, JSON.stringify(vectors), { expirationTtl: 86400 });

    return new Response(JSON.stringify({ stored: vectors.length }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'server_error', message: e.message?.slice(0, 200) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
