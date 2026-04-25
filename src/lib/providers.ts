export interface Provider {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  strengths: string[];
}

export const ZEN_REGISTRY: Provider[] = [
  {
    id: 'groq-llama',
    name: 'groq',
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    strengths: ['speed', 'drafting']
  },
  {
    id: 'nvidia-nemotron',
    name: 'nvidia',
    endpoint: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/nemotron-4-340b-instruct', // Or whichever free model is preferred
    strengths: ['reasoning', 'editing']
  },
  {
    id: 'gemini-flash',
    name: 'gemini',
    // Gemini supports the OpenAI compatibility layer
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.0-flash-lite',
    strengths: ['context', 'research']
  }
];

export const VARIANTS = {
  'draft': {
    temperature: 0.7,
    max_tokens: 4096,
    providerPreference: ['groq-llama', 'nvidia-nemotron', 'gemini-flash']
  },
  'edit': {
    temperature: 0.2,
    max_tokens: 4096,
    providerPreference: ['nvidia-nemotron', 'groq-llama', 'gemini-flash']
  },
  'outline': {
    temperature: 0.4,
    max_tokens: 2048,
    providerPreference: ['nvidia-nemotron', 'gemini-flash']
  },
  'research': {
    temperature: 0.1,
    max_tokens: 2048,
    providerPreference: ['gemini-flash', 'groq-llama']
  },
  'chat-fast': {
    temperature: 0.7,
    max_tokens: 1024,
    providerPreference: ['groq-llama', 'gemini-flash']
  }
} as const;

export type IntentVariant = keyof typeof VARIANTS;
