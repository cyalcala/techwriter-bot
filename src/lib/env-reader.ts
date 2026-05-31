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
  set('PROJECT_NAME', import.meta.env.PROJECT_NAME);
  set('APP_VERSION', import.meta.env.APP_VERSION);
  set('RATE_LIMIT_PER_MINUTE', import.meta.env.RATE_LIMIT_PER_MINUTE);
  set('RATE_LIMIT_PER_DAY', import.meta.env.RATE_LIMIT_PER_DAY);
  set('CHAT_MAX_CHARS', import.meta.env.CHAT_MAX_CHARS);
  set('MAX_REQUEST_BODY_BYTES', import.meta.env.MAX_REQUEST_BODY_BYTES);
  set('HEALTH_PING_TIMEOUT_MS', import.meta.env.HEALTH_PING_TIMEOUT_MS);
  set('PROVIDER_FAULT_INJECTION_TOKEN', import.meta.env.PROVIDER_FAULT_INJECTION_TOKEN);
  set('SYSTEM_PROMPT', import.meta.env.SYSTEM_PROMPT);
}

export function checkEnvKeys(env: Record<string, any>): Record<string, boolean> {
  const keyNames = ['GROQ_API_KEY', 'CEREBRAS_API_KEY', 'GEMINI_API_KEY', 'NVIDIA_API_KEY', 'OPENROUTER_API_KEY', 'TAVILY_API_KEY', 'EXA_API_KEY', 'TURNSTILE_SECRET_KEY', 'DEV_IPS', 'PROJECT_NAME', 'APP_VERSION', 'RATE_LIMIT_PER_MINUTE', 'RATE_LIMIT_PER_DAY', 'CHAT_MAX_CHARS', 'MAX_REQUEST_BODY_BYTES', 'HEALTH_PING_TIMEOUT_MS', 'SYSTEM_PROMPT'];
  const keys: Record<string, boolean> = {};
  for (const k of keyNames) {
    keys[k] = typeof env[k] === 'string' && (env[k] as string).trim().length > 0;
  }
  return keys;
}
