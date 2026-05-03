import type { SearchSource } from './search-reddit';

const TAVILY_TIMEOUT_MS = 3000;
const EXA_TIMEOUT_MS = 3000;

export interface EnhancedSearchResult extends SearchSource {}

export async function searchTavily(query: string, apiKey: string): Promise<EnhancedSearchResult | null> {
  if (!apiKey) return null;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TAVILY_TIMEOUT_MS);

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
        include_raw_content: false,
      }),
      signal: ctrl.signal,
    });

    clearTimeout(t);
    if (!res.ok) return null;

    const data = await res.json() as any;
    const parts: string[] = [];

    if (data.answer) parts.push(data.answer);

    const results = data.results?.slice(0, 5) || [];
    if (results.length > 0) {
      const formatted = results.map((r: any) =>
        `${r.title}: ${r.content || ''}`
      );
      parts.push(formatted.join('\n'));
    }

    if (parts.length === 0) return null;

    return {
      title: `Tavily: ${query.slice(0, 50)}`,
      url: data.results?.[0]?.url || `https://tavily.com/?q=${encodeURIComponent(query)}`,
      content: parts.join('\n\n'),
      provider: 'tavily',
    };
  } catch (e: any) {
    console.log(JSON.stringify({ event: 'tavily_error', message: e.message?.slice(0, 200), query: query.slice(0, 80) }));
    return null;
  }
}

export async function searchExa(query: string, apiKey: string): Promise<EnhancedSearchResult | null> {
  if (!apiKey) return null;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), EXA_TIMEOUT_MS);

    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: 5,
        useAutoprompt: true,
        contents: { text: true, summary: true },
      }),
      signal: ctrl.signal,
    });

    clearTimeout(t);
    if (!res.ok) return null;

    const data = await res.json() as any;
    const results = data.results?.slice(0, 5) || [];
    if (results.length === 0) return null;

    const parts = results.map((r: any) =>
      `${r.title || r.url}: ${r.summary || r.text || ''}`
    );

    return {
      title: `Exa: ${query.slice(0, 50)}`,
      url: results[0]?.url || `https://exa.ai/?q=${encodeURIComponent(query)}`,
      content: parts.join('\n'),
      provider: 'exa',
    };
  } catch (e: any) {
    console.log(JSON.stringify({ event: 'exa_error', message: e.message?.slice(0, 200), query: query.slice(0, 80) }));
    return null;
  }
}

export async function checkEnhancedBudget(
  kv: any,
  provider: 'tavily' | 'exa',
  monthKey: string,
  maxBudget: number = 1000,
): Promise<boolean> {
  if (!kv) return true;
  try {
    const key = `search:enhanced:total:${provider}:${monthKey}`;
    const currentRaw = await kv.get(key);
    const current = parseInt(currentRaw || '0', 10);
    return current < maxBudget;
  } catch {
    return true;
  }
}

export async function incrementEnhancedBudget(
  kv: any,
  provider: 'tavily' | 'exa',
  monthKey: string,
): Promise<void> {
  if (!kv) return;
  try {
    const key = `search:enhanced:total:${provider}:${monthKey}`;
    const currentRaw = await kv.get(key);
    const current = parseInt(currentRaw || '0', 10);
    await kv.put(key, String(current + 1), { expirationTtl: 45 * 24 * 3600 });
  } catch (e: any) {
    console.log(JSON.stringify({ event: 'budget_increment_error', provider, message: e.message?.slice(0, 100) }));
  }
}

export async function getEnhancedCredits(kv: any, ip: string): Promise<{ used: number; remaining: number }> {
  if (!kv) return { used: 0, remaining: 3 };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const key = `search:enhanced:${ip}:${today}`;
    const raw = await kv.get(key);
    const used = parseInt(raw || '0', 10);
    return { used, remaining: Math.max(0, 3 - used) };
  } catch {
    return { used: 0, remaining: 3 };
  }
}

export async function useEnhancedCredit(kv: any, ip: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `search:enhanced:${ip}:${today}`;

  if (!kv) return 3;

  const raw = await kv.get(key);
  const current = parseInt(raw || '0', 10);
  const next = current + 1;

  await kv.put(key, String(next), { expirationTtl: 24 * 3600 });
  return Math.max(0, 3 - next);
}