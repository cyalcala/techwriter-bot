import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env || (locals as any).env || locals || {};
  
  const mask = (key: string | undefined) => {
    if (!key) return "MISSING";
    return key.slice(0, 4) + "..." + key.slice(-4);
  };

  return new Response(JSON.stringify({
    CEREBRAS: mask(env.CEREBRAS_API_KEY),
    NVIDIA: mask(env.NVIDIA_API_KEY),
    SUPABASE_URL: mask(env.SUPABASE_URL),
    HAS_AI_BINDING: !!env.AI,
    HAS_SESSION_BINDING: !!env.SESSION,
    LOCALS_KEYS: Object.keys(locals),
    ENV_KEYS: Object.keys(env)
  }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
