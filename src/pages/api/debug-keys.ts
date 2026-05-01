import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const authKey = ((locals as any)?.runtime?.env?.DEBUG_AUTH_KEY)
    || ((locals as any)?.env?.DEBUG_AUTH_KEY)
    || (typeof process !== 'undefined' && process.env?.DEBUG_AUTH_KEY);

  if (!authKey) {
    return new Response(JSON.stringify({ error: 'debug_endpoint_disabled' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const url = new URL(request.url);
  const suppliedKey = url.searchParams.get('key');
  if (!suppliedKey || suppliedKey !== authKey) {
    return new Response(JSON.stringify({ error: 'auth_required' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const mask = (key: any) => {
    try {
      if (!key) return 'MISSING';
      if (typeof key !== 'string') return 'INVALID_TYPE';
      return key.slice(0, 2) + '...' + key.slice(-2);
    } catch (e) { return 'ERROR'; }
  };

  const mergedEnv: any = {};
  const knownKeys = ['CEREBRAS_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'GROQ_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TURNSTILE_SECRET_KEY', 'AI', 'SESSION'];

  const sources = [
    (locals as any)?.runtime?.env,
    (locals as any)?.cfContext?.env,
    (locals as any)?.env,
  ];

  for (const src of sources) {
    try {
      if (!src) continue;
      for (const k of knownKeys) {
        if (!mergedEnv[k] && src[k]) mergedEnv[k] = src[k];
      }
    } catch (e) {}
  }

  for (const k of knownKeys) {
    if (!mergedEnv[k] && (locals as any)[k]) mergedEnv[k] = (locals as any)[k];
  }

  return new Response(JSON.stringify({
    CEREBRAS: mask(mergedEnv.CEREBRAS_API_KEY),
    GEMINI: mask(mergedEnv.GEMINI_API_KEY),
    OPENROUTER: mask(mergedEnv.OPENROUTER_API_KEY),
    NVIDIA: mask(mergedEnv.NVIDIA_API_KEY),
    GROQ: mask(mergedEnv.GROQ_API_KEY),
    HAS_AI: !!mergedEnv.AI,
    HAS_SESSION: !!mergedEnv.SESSION,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
};