export interface Provider {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  strengths: string[];
}

export const ZEN_REGISTRY: Provider[] = [
  {
    id: 'cerebras-llama',
    name: 'cerebras',
    endpoint: 'https://api.cerebras.ai/v1',
    model: 'llama3.1-70b',
    strengths: ['insane-speed', 'intelligence']
  },
  {
    id: 'groq-llama',
    name: 'groq',
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    strengths: ['speed', 'drafting']
  },
  {
    id: 'nvidia-llama-fast',
    name: 'nvidia',
    endpoint: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.1-8b-instruct',
    strengths: ['speed', 'latency']
  },
  {
    id: 'nvidia-minimax',
    name: 'nvidia',
    endpoint: 'https://integrate.api.nvidia.com/v1',
    model: 'minimaxai/minimax-m2.7',
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
    providerPreference: ['cerebras-llama', 'groq-llama', 'nvidia-minimax', 'gemini-flash']
  },
  'edit': {
    temperature: 0.2,
    max_tokens: 4096,
    providerPreference: ['cerebras-llama', 'gemini-flash', 'groq-llama', 'nvidia-minimax']
  },
  'outline': {
    temperature: 0.4,
    max_tokens: 2048,
    providerPreference: ['cerebras-llama', 'nvidia-minimax', 'gemini-flash', 'groq-llama']
  },
  'research': {
    temperature: 0.1,
    max_tokens: 2048,
    providerPreference: ['cerebras-llama', 'gemini-flash', 'groq-llama', 'nvidia-minimax']
  },
  'chat-fast': {
    temperature: 0.7,
    max_tokens: 1024,
    providerPreference: ['cerebras-llama', 'groq-llama', 'nvidia-llama-fast', 'nvidia-minimax', 'gemini-flash']
  }
} as const;

export type IntentVariant = keyof typeof VARIANTS;
