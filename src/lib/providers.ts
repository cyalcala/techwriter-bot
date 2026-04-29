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
    model: 'llama-3.3-70b-instruct',
    strengths: ['insane-speed', 'intelligence']
  },
  {
    id: 'gemini-flash',
    name: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    strengths: ['thinking', 'massive-context', 'research']
  },
  {
    id: 'openrouter-fast',
    name: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.0-flash-001',
    strengths: ['reliability', 'fallback']
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
    model: 'meta/llama-3.1-8b-instruct',
    strengths: ['reasoning', 'editing']
  },
  {
    id: 'nvidia-deepseek',
    name: 'nvidia',
    endpoint: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.3-70b-instruct',
    strengths: ['reasoning', 'long-context']
  }
];

export const VARIANTS = {
  'draft': {
    temperature: 0.7,
    max_tokens: 4096,
    providerPreference: ['cerebras-llama', 'gemini-flash', 'openrouter-fast', 'nvidia-minimax']
  },
  'edit': {
    temperature: 0.2,
    max_tokens: 4096,
    providerPreference: ['cerebras-llama', 'gemini-flash', 'openrouter-fast', 'nvidia-minimax']
  },
  'outline': {
    temperature: 0.4,
    max_tokens: 2048,
    providerPreference: ['cerebras-llama', 'gemini-flash', 'openrouter-fast', 'nvidia-minimax']
  },
  'research': {
    temperature: 0.1,
    max_tokens: 2048,
    providerPreference: ['cerebras-llama', 'gemini-flash', 'openrouter-fast', 'nvidia-deepseek']
  },
  'chat-fast': {
    temperature: 0.7,
    max_tokens: 1024,
    providerPreference: ['cerebras-llama', 'gemini-flash', 'openrouter-fast', 'nvidia-llama-fast']
  },
  'deep-reason': {
    temperature: 0.6,
    max_tokens: 16384,
    providerPreference: ['cerebras-llama', 'gemini-flash', 'openrouter-fast', 'nvidia-deepseek']
  }
} as const;

export type IntentVariant = keyof typeof VARIANTS;
