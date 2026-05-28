export interface CachedResponse {
  text: string;
  provider: string;
  searchTier: string;
  path: string;
  cached: boolean;
  stale?: boolean;
  ts: number;
}

export async function checkCache(kv: any, query: string, env: Record<string, unknown> = {}): Promise<{ hit: boolean; response?: CachedResponse }> {
  void kv;
  void query;
  void env;
  return { hit: false };
}

export async function checkStaleCache(kv: any, query: string, env: Record<string, unknown> = {}): Promise<{ hit: boolean; response?: CachedResponse }> {
  void kv;
  void query;
  void env;
  return { hit: false };
}

export async function writeCache(
  kv: any,
  query: string,
  text: string,
  provider: string,
  searchTier: string,
  path: string,
  env: Record<string, unknown> = {},
): Promise<void> {
  void kv;
  void query;
  void text;
  void provider;
  void searchTier;
  void path;
  void env;
}

export function cachedResponseToSSE(response: CachedResponse, options: { liveUnavailable?: boolean } = {}): string {
  const banner = options.liveUnavailable ? 'Live AI unavailable. Showing the latest cached response.' : '';
  const content = banner ? `${banner}\n\n${response.text}` : response.text;
  const payload = {
    choices: [{ delta: { content } }],
    provider: response.provider,
    searchTier: response.searchTier,
    path: response.path,
    cached: true,
    stale: !!response.stale,
    liveUnavailable: !!options.liveUnavailable,
  };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

export async function collectSSETextForCache(body: ReadableStream<Uint8Array>, maxChars: number = 100_000): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let collected = '';

  const append = (text: string) => {
    if (!text || collected.length >= maxChars) return;
    collected += text.slice(0, maxChars - collected.length);
  };

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const rawData = trimmed.slice(trimmed.indexOf(':') + 1).trim();
    if (!rawData || rawData === '[DONE]') return;

    try {
      const json = JSON.parse(rawData);
      if (json.error) return;
      append(json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || json.response || json.content || '');
    } catch {
      if (!rawData.includes('{')) append(rawData);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = done ? '' : (lines.pop() || '');
      for (const line of lines) processLine(line);
      if (done) break;
    }
    if (buffer) processLine(buffer);
  } finally {
    reader.releaseLock();
  }

  return collected.trim();
}
