import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { apiError, createRequestId, jsonResponse } from '../../lib/api-response';

function loadEnv(locals: any): any {
  const env: any = {};
  try { if (cfGlobalEnv) Object.assign(env, cfGlobalEnv); } catch {}
  try { const r = (locals as any)?.runtime?.env; if (r) for (const [k, v] of Object.entries(r)) { if (v != null && !env[k]) env[k] = v; } } catch {}
  return env;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = createRequestId();
  const env = loadEnv(locals);
  if (!env.AI) {
    return apiError({ requestId, status: 503, code: 'AI_BINDING_MISSING', message: 'AI binding not available.', retryable: true });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body?.messages || !Array.isArray(body.messages)) {
      return apiError({ requestId, status: 400, code: 'INVALID_REQUEST', message: 'Expected messages array.' });
    }

    const dialogue = body.messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => `${m.role}: ${m.content}`)
      .join('\n');

    if (dialogue.length < 100) {
      return jsonResponse({ summary: dialogue.slice(0, 300) }, { requestId });
    }

    const mode = body.mode || 'summary';
    const systemPrompt = mode === 'topics'
      ? 'Extract exactly 5-10 key topics, concepts, terms, and entities from this document. Output as a comma-separated list. Be specific: proper nouns, technical terms, domain concepts. No sentences, just the list.'
      : 'Summarize this conversation into 3-5 concise bullet points. Preserve all key facts, decisions, code snippets, and topics discussed. Be brief but complete.';

    const result: any = await env.AI.run('@cf/meta/llama-3.2-1b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: dialogue.slice(0, 4000) },
      ],
      max_tokens: 200,
      temperature: 0.1,
    });

    const summary = result?.response || result?.choices?.[0]?.message?.content || dialogue.slice(0, 400);
    return jsonResponse({ summary }, { requestId });
  } catch (e: any) {
    return apiError({
      requestId,
      status: 500,
      code: 'SUMMARIZATION_FAILED',
      message: e.message?.slice(0, 200) || 'Summarization failed.',
      retryable: true,
    });
  }
};
