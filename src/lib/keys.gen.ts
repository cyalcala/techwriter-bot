const keys: Record<string, string> = {};
const envKeys = ['GROQ_API_KEY','CEREBRAS_API_KEY','GEMINI_API_KEY','NVIDIA_API_KEY','OPENROUTER_API_KEY','TAVILY_API_KEY','EXA_API_KEY','TURNSTILE_SECRET_KEY','DEV_IPS'];
for (const k of envKeys) {
  const v = process.env[k];
  if (v) keys[k] = v;
}
export default keys;