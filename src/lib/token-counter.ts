import { kvKey } from './kv-prefix';

export const MAX_SYSTEM_PROMPT_TOKENS = 2048;
export const MAX_TOTAL_REQUEST_TOKENS = 4096;
export const CORE_PERSONA_TOKENS = 300;
export const MAX_GRAPH_TOKENS = 1200;
export const MAX_SEARCH_TOKENS = 500;
export const MAX_RAG_TOKENS = 400;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export interface TokenCount {
  inputTokens: number;
  estimatedOutputTokens: number;
}

export function countMessages(messages: { role: string; content: string }[]): TokenCount {
  let inputTokens = 0;
  for (const msg of messages) {
    inputTokens += estimateTokens(msg.content);
  }
  return { inputTokens, estimatedOutputTokens: 0 };
}

export function isWithinBudget(messages: { role: string; content: string }[], maxSystem: number, maxTotal: number): boolean {
  const { inputTokens } = countMessages(messages);
  const systemTokens = messages
    .filter(m => m.role === 'system')
    .reduce((sum, m) => sum + estimateTokens(m.content), 0);
  return systemTokens <= maxSystem && inputTokens <= maxTotal;
}

export function enforceBudget(layers: { priority: number; content: string }[], maxTokens: number): string {
  let remaining = maxTokens;
  const sorted = [...layers].sort((a, b) => a.priority - b.priority);
  const result: string[] = [];

  for (const layer of sorted) {
    const needed = estimateTokens(layer.content);
    if (needed <= remaining) {
      result.push(layer.content);
      remaining -= needed;
    } else if (remaining > 10) {
      const chars = remaining * 4;
      result.push(layer.content.slice(0, chars) + '\n[...]');
      remaining = 0;
    }
  }

  return result.join('\n\n');
}

export async function logTokenUsage(
  kv: any,
  env: Record<string, unknown>,
  provider: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  if (!kv) return;
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getHours().toString().padStart(2, '0');
  const key = kvKey(env, `tk:${today}:${hour}`);
  try {
    const existing = await kv.get(key, 'json').catch(() => null) || { total: 0, providers: {} };
    existing.total += (inputTokens + outputTokens);
    existing.providers[provider] = (existing.providers[provider] || 0) + (inputTokens + outputTokens);
    await kv.put(key, JSON.stringify(existing), { expirationTtl: 86400 * 7 });
  } catch {}
}

export interface TokenStats {
  today: { total: number; providers: Record<string, number> };
  hourly: { hour: string; total: number }[];
}

export async function getTokenStats(kv: any, env: Record<string, unknown> = {}): Promise<TokenStats> {
  if (!kv) return { today: { total: 0, providers: {} }, hourly: [] };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const prefix = kvKey(env, `tk:${today}:`);
    const list = await kv.list({ prefix });
    const stats: TokenStats = { today: { total: 0, providers: {} }, hourly: [] };

    for (const { name } of list.keys) {
      const data = await kv.get(name, 'json').catch(() => null);
      if (!data) continue;
      stats.today.total += data.total;
      for (const [p, c] of Object.entries(data.providers || {})) {
        stats.today.providers[p] = (stats.today.providers[p] || 0) + (c as number);
      }
      stats.hourly.push({ hour: name.replace(prefix, ''), total: data.total as number });
    }
    return stats;
  } catch {
    return { today: { total: 0, providers: {} }, hourly: [] };
  }
}
