import { searchReddit, type SearchSource } from './search-reddit';
import { searchTavily, searchExa, checkEnhancedBudget, incrementEnhancedBudget, getEnhancedCredits, useEnhancedCredit } from './search-enhanced';
import { classifyQuery, filterRelevantResults, extractKeyTerms } from './relevance';
import { getDailyLimits, type ReputationState } from './reputation';

function expandQuery(query: string): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();
  const add = (q: string) => { const s = q.trim(); if (s.length > 2 && !seen.has(s)) { seen.add(s); expanded.push(s); } };

  add(query);

  const timeWords = /\b(latest|newest|current|recent|today|now|2026|2025|this year)\b/gi;
  let stripped = query.replace(timeWords, '').replace(/\s+/g, ' ').trim();
  if (stripped && stripped !== query) add(stripped);

  const fillerWords = /\b(the|a|an|is|are|was|were|be|been|being|have|has|had|do|does|did|can|could|will|would|should|may|might|in|on|at|to|for|of|with|by|from|about|me|my|give|show|tell|find|get|what|who|where|when|why|how|search|look|check|please|pls|just|want|need)\b/gi;
  let keywords = stripped.replace(fillerWords, '').replace(/\s+/g, ' ').trim();
  if (keywords && keywords !== stripped) add(keywords);

  const words = query.split(/\s+/).filter(w => w.length > 3 && !/^\d+$/.test(w));
  if (words.length <= 3 && expanded.length < 2) {
    for (const w of words) {
      const gen = `${w} information`;
      if (gen !== query) add(gen);
    }
  }

  return expanded;
}

export interface SearchResult {
  contextParts: string[];
  sources: { title: string; url: string; provider?: string }[];
  searchTier: 'none' | 'basic' | 'enhanced';
  searchAttempted: boolean;
  searchUnavailable?: boolean;
  enhancedRemaining?: number;
}

const DDG_TIMEOUT_MS = 3000;
const WIKI_TIMEOUT_MS = 4000;
const REDDIT_TIMEOUT_MS = 4000;
const SEARCH_TOTAL_TIMEOUT_MS = 8000;

async function searchDuckDuckGo(query: string, _kv?: any): Promise<SearchSource | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DDG_TIMEOUT_MS);
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;

    const data = await res.json() as any;
    const parts: string[] = [];
    if (data.Answer) parts.push(data.Answer);
    if (data.AbstractText) parts.push(data.AbstractText);
    if (data.Definition) parts.push(data.Definition);
    if (data.Heading) parts.push(`Topic: ${data.Heading}`);
    const topics = data.RelatedTopics?.slice(0, 5)?.filter((t: any) => t.Text)?.map((t: any) => `- ${t.Text}`) || [];
    if (topics.length) parts.push(topics.join('\n'));
    const results = data.Results?.slice(0, 3)?.filter((r: any) => r.Text)?.map((r: any) => `${r.FirstURL}: ${r.Text}`) || [];
    if (results.length) parts.push(results.join('\n'));

    if (parts.length === 0) return null;

    const content = parts.join('\n\n');
    const firstResultUrl = (data.Results?.[0] as any)?.FirstURL || data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    return { title: 'DuckDuckGo', url: firstResultUrl, content, provider: 'ddg' };
  } catch {
    console.log(JSON.stringify({ event: 'ddg_error' }));
    return null;
  }
}

async function searchWikipedia(query: string): Promise<SearchSource | null> {
  try {
    const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, format: 'json', srlimit: '3' });
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(WIKI_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const results = data?.query?.search;
    if (!results?.length) return null;

    const pages = results.slice(0, 2);
    const parts: string[] = [];
    let firstUrl = '';
    for (const page of pages) {
      const snippet = (page.snippet || '').replace(/<[^>]+>/g, '');
      const url = `https://en.wikipedia.org/wiki/${encodeURIComponent((page.title || '').replace(/ /g, '_'))}`;
      if (!firstUrl) firstUrl = url;
      parts.push(`${page.title}: ${snippet}`);
    }
    return { title: `Wikipedia: ${query.slice(0, 50)}`, url: firstUrl, content: parts.join('\n\n'), provider: 'wikipedia' };
  } catch {
    console.log(JSON.stringify({ event: 'wiki_error' }));
    return null;
  }
}

export { searchDuckDuckGo, searchWikipedia };

export async function searchRouter(
  query: string,
  liveSearch: boolean,
  env: any,
  clientIP: string,
  repState: ReputationState,
): Promise<SearchResult> {
  const contextParts: string[] = [];
  const sources: { title: string; url: string; provider?: string }[] = [];
  let sourceIdx = 0;
  let searchTier: 'none' | 'basic' | 'enhanced' = 'none';
  let searchAttempted = false;
  let enhancedRemaining: number | undefined;

  const classified = classifyQuery(query);
  if (classified === 'greeting' || classified === 'conversational') {
    return { contextParts, sources, searchTier: 'none', searchAttempted: false, searchUnavailable: false };
  }

  searchAttempted = true;

  const searchQuery = extractKeyTerms(query) || query;

  let enhancedResults: (SearchSource | null)[] = [];

  if (liveSearch) {
    const devIPs = (env.DEV_IPS || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    const isDev = devIPs.includes(clientIP);
    const tier = repState.tier;
    const limits = getDailyLimits(tier);

    if (isDev || limits.enhancedPerDay > 0) {
      if (!isDev) {
        const creds = await getEnhancedCredits(env.SESSION, clientIP);
        if (creds.remaining <= 0) {
          console.log(JSON.stringify({ event: 'enhanced_exhausted', ip: clientIP.slice(0, 8) }));
        } else {
          const monthKey = new Date().toISOString().slice(0, 7);
          const tavilyBudget = await checkEnhancedBudget(env.SESSION, 'tavily', monthKey);
          const exaBudget = await checkEnhancedBudget(env.SESSION, 'exa', monthKey);

          if (tavilyBudget && exaBudget) {
            const tavilyKey = env.TAVILY_API_KEY || '';
            const exaKey = env.EXA_API_KEY || '';

            if (tavilyKey || exaKey) {
              await useEnhancedCredit(env.SESSION, clientIP);
              searchTier = 'enhanced';

              enhancedResults = await Promise.all([
                tavilyKey ? searchTavily(searchQuery, tavilyKey) : null,
                exaKey ? searchExa(searchQuery, exaKey) : null,
              ]);

              if (tavilyKey) await incrementEnhancedBudget(env.SESSION, 'tavily', monthKey);
              if (exaKey) await incrementEnhancedBudget(env.SESSION, 'exa', monthKey);

              const refreshedCreds = await getEnhancedCredits(env.SESSION, clientIP);
              enhancedRemaining = refreshedCreds.remaining;
            }
          } else {
            console.log(JSON.stringify({ event: 'budget_exhausted', monthKey }));
          }
        }
      } else {
        searchTier = 'enhanced';
        enhancedRemaining = -1;
        enhancedResults = await Promise.all([
          env.TAVILY_API_KEY ? searchTavily(searchQuery, env.TAVILY_API_KEY || '') : null,
          env.EXA_API_KEY ? searchExa(searchQuery, env.EXA_API_KEY || '') : null,
        ]);
      }
    }
  }

  const basicResults = await Promise.all([
    searchDuckDuckGo(searchQuery, env?.SESSION),
    searchWikipedia(searchQuery),
    searchReddit(searchQuery),
  ]);

  const allResults: SearchSource[] = [];
  const seenUrls = new Set<string>();

  const addResults = (results: (SearchSource | null)[]) => {
    for (const r of results) {
      if (!r || seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      allResults.push(r);
    }
  };

  addResults(enhancedResults);
  addResults(basicResults);

  const scored = allResults.map(r => {
    if (r.provider === 'ddg' || r.provider === 'wikipedia') {
      return { result: r, score: 999 };
    }
    return { result: r, score: 0 };
  });

  const sorted = scored.sort((a, b) => b.score - a.score).map(s => s.result);

  const relevant = searchTier === 'enhanced'
    ? filterRelevantResults(sorted, searchQuery, 1.0)
    : sorted;

  for (const r of relevant) {
    sourceIdx++;
    const providerLabel = r.provider ? `[${sourceIdx}: ${r.provider.toUpperCase()}]` : `[${sourceIdx}]`;
    contextParts.push(`${providerLabel}\n${r.content}`);
    sources.push({ title: r.title, url: r.url, provider: r.provider });
  }

  if (searchTier === 'enhanced' && contextParts.length === 0) {
    searchTier = 'basic';
    sourceIdx = 0;
    contextParts.length = 0;
    sources.length = 0;
    seenUrls.clear();
    for (const r of basicResults) {
      if (!r || seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      sourceIdx++;
      const providerLabel = r.provider ? `[${sourceIdx}: ${r.provider.toUpperCase()}]` : `[${sourceIdx}]`;
      contextParts.push(`${providerLabel}\n${r.content}`);
      sources.push({ title: r.title, url: r.url, provider: r.provider });
    }
  }

  if (searchAttempted && searchTier === 'none') {
    searchTier = 'basic';
  }

  if (searchAttempted && contextParts.length === 0) {
    const expansions = expandQuery(query);
    for (const expanded of expansions) {
      console.log(JSON.stringify({ event: 'search_expansion' }));
      const retryResults = await Promise.all([
        searchDuckDuckGo(expanded, env?.SESSION),
        searchWikipedia(expanded),
        searchReddit(expanded),
      ]);
      for (const r of retryResults) {
        if (!r || seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        sourceIdx++;
        const providerLabel = r.provider ? `[${sourceIdx}: ${r.provider.toUpperCase()}]` : `[${sourceIdx}]`;
        contextParts.push(`${providerLabel}\n${r.content}`);
        sources.push({ title: r.title, url: r.url, provider: r.provider });
      }
      if (contextParts.length > 0) break;
    }
  }

  return {
    contextParts,
    sources,
    searchTier,
    searchAttempted,
    searchUnavailable: searchAttempted && contextParts.length === 0,
    enhancedRemaining,
  };
}
