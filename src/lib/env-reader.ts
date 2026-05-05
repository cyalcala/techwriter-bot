export function readEnvKeys(baseEnv: Record<string, any>): void {
  const set = (k: string, v: string | undefined) => { if (v && !baseEnv[k]) baseEnv[k] = v; };
  set('GROQ_API_KEY', import.meta.env.GROQ_API_KEY);
  set('CEREBRAS_API_KEY', import.meta.env.CEREBRAS_API_KEY);
  set('GEMINI_API_KEY', import.meta.env.GEMINI_API_KEY);
  set('NVIDIA_API_KEY', import.meta.env.NVIDIA_API_KEY);
  set('OPENROUTER_API_KEY', import.meta.env.OPENROUTER_API_KEY);
  set('TAVILY_API_KEY', import.meta.env.TAVILY_API_KEY);
  set('EXA_API_KEY', import.meta.env.EXA_API_KEY);
  set('TURNSTILE_SECRET_KEY', import.meta.env.TURNSTILE_SECRET_KEY);
  set('DEV_IPS', import.meta.env.DEV_IPS);
}

export function checkEnvKeys(env: Record<string, any>): Record<string, boolean> {
  const keyNames = ['GROQ_API_KEY', 'CEREBRAS_API_KEY', 'GEMINI_API_KEY', 'NVIDIA_API_KEY', 'OPENROUTER_API_KEY', 'TAVILY_API_KEY', 'EXA_API_KEY', 'TURNSTILE_SECRET_KEY', 'DEV_IPS'];
  const keys: Record<string, boolean> = {};
  for (const k of keyNames) {
    keys[k] = typeof env[k] === 'string' && (env[k] as string).trim().length > 0;
  }
  return keys;
}
