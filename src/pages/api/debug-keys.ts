import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  let env: any = {};
  try {
    env = (locals as any).runtime?.env || (locals as any).env || locals || {};
  } catch (e) {}

  const importEnv = (import.meta as any).env || {};
  const secretsToCheck = ['CEREBRAS_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY'];
  for (const key of secretsToCheck) {
    if (!env[key] && importEnv[key]) {
      env[key] = importEnv[key];
    }
  }

  const mask = (key: string | undefined | null) => {
    if (!key) return "MISSING";
    if (typeof key !== 'string') return "INVALID_TYPE";
    return key.slice(0, 4) + "..." + key.slice(-4);
  };

  const safeKeys = (obj: any) => {
    try {
      return obj ? Object.keys(obj) : [];
    } catch (e) {
      return ["ERROR_READING_KEYS"];
    }
  };

  return new Response(JSON.stringify({
    CEREBRAS: mask(env.CEREBRAS_API_KEY),
    GEMINI: mask(env.GEMINI_API_KEY),
    OPENROUTER: mask(env.OPENROUTER_API_KEY),
    NVIDIA: mask(env.NVIDIA_API_KEY),
    SUPABASE_URL: mask(env.SUPABASE_URL),
    TURNSTILE_SECRET: mask(env.TURNSTILE_SECRET_KEY),
    HAS_AI_BINDING: !!env.AI,
    HAS_SESSION_BINDING: !!env.SESSION,
    LOCALS_KEYS: safeKeys(locals),
    ENV_KEYS: safeKeys(env)
  }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
