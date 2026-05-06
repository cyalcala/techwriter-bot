import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';

function loadEnv(locals: any): any {
  const env: any = {};
  try { if (cfGlobalEnv) Object.assign(env, cfGlobalEnv); } catch {}
  try { const r = (locals as any)?.runtime?.env; if (r) for (const [k, v] of Object.entries(r)) { if (v != null && !env[k]) env[k] = v; } } catch {}
  return env;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = loadEnv(locals);
  if (!env.AI) {
    return new Response(JSON.stringify({ error: 'AI binding not available' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body?.messages || !Array.isArray(body.messages)) {
      return new Response(JSON.stringify({ error: 'invalid' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const dialogue = body.messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => `${m.role}: ${m.content}`)
      .join('\n');

    if (dialogue.length < 100) {
      return new Response(JSON.stringify({ summary: dialogue.slice(0, 300) }), { headers: { 'Content-Type': 'application/json' } });
    }

    const result: any = await env.AI.run('@cf/meta/llama-3.2-1b-instruct', {
      messages: [
        { role: 'system', content: 'Summarize this conversation into 3-5 concise bullet points. Preserve all key facts, decisions, code snippets, and topics discussed. Be brief but complete.' },
        { role: 'user', content: dialogue.slice(0, 4000) },
      ],
      max_tokens: 200,
      temperature: 0.1,
    });

    const summary = result?.response || result?.choices?.[0]?.message?.content || dialogue.slice(0, 400);
    return new Response(JSON.stringify({ summary }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'summarization_failed', message: e.message?.slice(0, 200) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
