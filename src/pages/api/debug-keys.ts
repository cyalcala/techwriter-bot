import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {

  const mask = (key: any) => {
    try {
      if (!key) return "MISSING";
      if (typeof key !== 'string') return "INVALID_TYPE";
      return key.slice(0, 4) + "..." + key.slice(-4);
    } catch (e) { return "ERROR"; }
  };

  const mergedEnv: any = {};
  const knownKeys = ['CEREBRAS_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TURNSTILE_SECRET_KEY', 'AI', 'SESSION'];

  const sources = [
    (locals as any)?.runtime?.env,
    (locals as any)?.cfContext?.env,
    (locals as any)?.env
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
    DEPLOY_TIME: "2026-04-29 11:52 PM",
    CEREBRAS: mask(mergedEnv.CEREBRAS_API_KEY),
    GEMINI: mask(mergedEnv.GEMINI_API_KEY),
    HAS_AI: !!mergedEnv.AI,
    HAS_SESSION: !!mergedEnv.SESSION,
    LOCALS_KEYS: Object.keys(locals)
  }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};