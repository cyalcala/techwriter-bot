import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { routeChat, getCircuitDiagnostics } from '../../lib/zen-router';

interface RateLimitEntry { count: number; resetTime: number; }
const rateLimits = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetTime) { rateLimits.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW }); return true; }
  if (entry.count >= MAX_REQUESTS_PER_WINDOW) return false;
  entry.count++; return true;
}

function sanitizeInput(input: any): any {
  if (typeof input === 'string') return input.slice(0, 8000).replace(/[\x00-\x1F\x7F]/g, '');
  if (Array.isArray(input)) return input.map(sanitizeInput);
  if (input && typeof input === 'object') {
    const sanitized: any = {};
    for (const key of Object.keys(input)) { if (['role', 'content', 'name'].includes(key)) sanitized[key] = sanitizeInput(input[key]); }
    return sanitized;
  }
  return input;
}

async function retrieveRagContext(env: any, sessionId: string, query: string): Promise<string | null> {
  if (!env.AI || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const embResult = await env.AI.run('@cf/baai/bge-small-en-v1.5', { text: [query] });
    const embedding = embResult?.data?.[0];
    if (!embedding) return null;

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase.rpc('match_notes', {
      query_embedding: embedding,
      match_threshold: 0.4,
      match_count: 3,
      p_session_id: sessionId,
    });

    if (error || !data?.length) return null;

    return data.map((r: any, i: number) => `[Doc Chunk ${i + 1}] ${r.content}`).join('\n\n');
  } catch (e) { return null; }
}

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({
    status: 'ok',
    circuits: getCircuitDiagnostics(),
    sessions: 'active',
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async (context) => {
  const { request, locals } = context;

  let env: any = {};
  try { if (cfGlobalEnv) env = { ...(cfGlobalEnv as any) }; } catch (e) {}
  try { const rEnv = (locals as any)?.runtime?.env; if (rEnv) for (const [k, v] of Object.entries(rEnv)) { if (v != null && !env[k]) env[k] = v; } } catch (e) {}
  if (typeof process !== 'undefined' && process.env) { for (const [k, v] of Object.entries(process.env)) { if (v && !env[k]) env[k] = v; } }

  const clientIP = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  if (!checkRateLimit(clientIP)) {
    return new Response(JSON.stringify({ error: 'RATE_LIMIT_EXCEEDED' }), { status: 429 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body?.messages || !Array.isArray(body.messages)) {
      return new Response(JSON.stringify({ error: 'INVALID_REQUEST' }), { status: 400 });
    }

    let messages = sanitizeInput(body.messages);
    const sessionId = String(body.sessionId || '');
    const hasRag = body.hasRag === true && sessionId;

    if (hasRag) {
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
      if (lastUserMsg) {
        const ragContext = await retrieveRagContext(env, sessionId, lastUserMsg.content);
        if (ragContext) {
          messages = [
            { role: 'system', content: `Use the following document excerpts as context. Answer based on the documents. If the documents don't contain relevant info, say so.\n\n${ragContext}` },
            ...messages,
          ];
        }
      }
    }

    return await routeChat(body.intent || 'chat-fast', messages, locals, env, sessionId);
  } catch (error: any) {
    return new Response(JSON.stringify({ error: 'INTERNAL_ERROR', details: error.message }), { status: 500 });
  }
};