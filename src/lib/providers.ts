export type ProviderRole = 'fast' | 'balanced' | 'heavy' | 'fallback';

export interface Provider {
  id: string;
  name: string;
  role: ProviderRole;
  endpoint: string;
  model: string;
  timeoutMs: number;
  freeTier: boolean;
}

export const ZEN_REGISTRY: Provider[] = [
  {
    id: 'cerebras-llama',
    name: 'cerebras',
    role: 'balanced',
    endpoint: 'https://api.cerebras.ai/v1',
    model: 'llama-3.1-8b',
    timeoutMs: 12000,
    freeTier: true,
  },
  {
    id: 'groq-fast',
    name: 'groq',
    role: 'fast',
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    timeoutMs: 10000,
    freeTier: true,
  },
  {
    id: 'gemini-flash',
    name: 'gemini',
    role: 'heavy',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.0-flash',
    timeoutMs: 20000,
    freeTier: true,
  },
  {
    id: 'nvidia-fast',
    name: 'nvidia',
    role: 'fallback',
    endpoint: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/llama-3.1-nemotron-8b-instruct',
    timeoutMs: 12000,
    freeTier: true,
  },
  {
    id: 'openrouter-fast',
    name: 'openrouter',
    role: 'fallback',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.0-flash-001',
    timeoutMs: 10000,
    freeTier: false,
  },
  {
    id: 'cloudflare-llama',
    name: 'cloudflare',
    role: 'fallback',
    endpoint: 'workers-ai',
    model: '@cf/meta/llama-3.1-8b-instruct',
    timeoutMs: 25000,
    freeTier: true,
  },
];

export function classifyQuery(messages: any[], intent: string): ProviderRole {
  const lastMsg = messages[messages.length - 1]?.content || '';
  const msgLen = String(lastMsg).length;

  if (intent === 'deep-reason' || intent === 'research' || msgLen > 1500) return 'heavy';
  if (msgLen <= 200 && intent === 'chat-fast') return 'fast';
  return 'balanced';
}

const ROLE_PRIORITY: Record<ProviderRole, ProviderRole[]> = {
  fast:     ['fast', 'balanced', 'heavy', 'fallback'],
  balanced: ['balanced', 'fast', 'heavy', 'fallback'],
  heavy:    ['heavy', 'balanced', 'fast', 'fallback'],
  fallback: ['fallback', 'heavy', 'balanced', 'fast'],
};

export function getProvidersForRole(role: ProviderRole): Provider[] {
  const priority = ROLE_PRIORITY[role];
  const selected: Provider[] = [];
  for (const r of priority) {
    for (const p of ZEN_REGISTRY) {
      if (p.role === r && !selected.find(s => s.id === p.id)) {
        selected.push(p);
      }
    }
  }
  return selected;
}

export function getProvider(id: string): Provider | undefined {
  return ZEN_REGISTRY.find(p => p.id === id);
}