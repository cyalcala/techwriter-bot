export interface SearchSource { title: string; url: string; content: string; provider: string; }

const REDDIT_TIMEOUT_MS = 4000;

export async function searchReddit(query: string): Promise<SearchSource | null> {
  try {
    const params = new URLSearchParams({ q: query, limit: '5', sort: 'relevance', t: 'year' });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REDDIT_TIMEOUT_MS);

    const res = await fetch(`https://www.reddit.com/search.json?${params}`, {
      headers: { 'User-Agent': 'techwriter-bot/1.0' },
      signal: ctrl.signal,
    });

    clearTimeout(t);
    if (!res.ok) return null;

    const data = await res.json() as any;
    const children = data?.data?.children;
    if (!children?.length) return null;

    const filtered = children
      .map((c: any) => c.data)
      .filter((d: any) => !d.over_18 && d.score >= 2)
      .slice(0, 5);

    if (filtered.length === 0) return null;

    const parts: string[] = [];
    let firstUrl = '';

    for (const post of filtered) {
      const sub = post.subreddit || 'unknown';
      const title = post.title || '';
      const selftext = (post.selftext || '').slice(0, 300);
      const permalink = post.permalink || '';
      const url = permalink ? `https://reddit.com${permalink}` : `https://reddit.com/r/${sub}`;
      if (!firstUrl) firstUrl = url;

      const commentCount = post.num_comments || 0;
      const score = post.score || 0;

      let entry = `r/${sub} · ${score}pts · ${commentCount} comments: ${title}`;
      if (selftext) entry += `\n${selftext}`;
      parts.push(entry);
    }

    return {
      title: `Reddit: ${query.slice(0, 50)}`,
      url: firstUrl || `https://reddit.com/search/?q=${encodeURIComponent(query)}`,
      content: parts.join('\n\n'),
      provider: 'reddit',
    };
  } catch (e: any) {
    console.log(JSON.stringify({ event: 'reddit_error', message: e.message?.slice(0, 200), query: query.slice(0, 80) }));
    return null;
  }
}