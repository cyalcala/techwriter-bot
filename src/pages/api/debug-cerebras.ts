import type { APIRoute } from 'astro';

const CEREBRAS_ENDPOINT = 'https://api.cerebras.ai/v1/chat/completions';
const CEREBRAS_MODEL = 'llama3.1-8b';

function getRuntimeEnv(locals: any): Record<string, any> {
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.env || {};
  return runtimeEnv;
}

function maskKey(value: unknown) {
  if (typeof value !== 'string') {
    return {
      present: false,
      type: typeof value,
      length: 0,
      preview: null,
      hasOuterWhitespace: false
    };
  }

  const trimmed = value.trim();

  return {
    present: trimmed.length > 0,
    type: 'string',
    length: trimmed.length,
    preview: trimmed.length >= 8 ? `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}` : '[too-short]',
    hasOuterWhitespace: trimmed !== value
  };
}

function sanitizeProviderBody(text: string) {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .replace(/csk-[A-Za-z0-9]+/g, 'csk-[redacted]')
    .slice(0, 1200);
}

export const GET: APIRoute = async ({ locals }) => {
  const env = getRuntimeEnv(locals);
  const rawApiKey = env.CEREBRAS_API_KEY;
  const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : '';
  const key = maskKey(rawApiKey);

  if (!apiKey) {
    const envKeys = Object.keys(env || {});
    return new Response(JSON.stringify({
      ok: false,
      provider: 'cerebras',
      model: CEREBRAS_MODEL,
      key,
      error: 'CEREBRAS_API_KEY is missing from this runtime environment.',
      diagnostics: {
        envKeysCount: envKeys.length,
        allKeys: envKeys,
        localsKeys: Object.keys((locals as any) || {}),
        runtimeKeys: Object.keys((locals as any)?.runtime || {})
      }
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const startedAt = Date.now();
    const response = await fetch(CEREBRAS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
        messages: [
          {
            role: 'user',
            content: 'Reply with exactly: Cerebras production probe OK'
          }
        ],
        max_tokens: 16,
        temperature: 0,
        stream: false
      })
    });

    const text = await response.text();
    let parsed: any = null;

    try {
      parsed = JSON.parse(text);
    } catch {}

    return new Response(JSON.stringify({
      ok: response.ok,
      provider: 'cerebras',
      model: CEREBRAS_MODEL,
      endpoint: CEREBRAS_ENDPOINT,
      status: response.status,
      statusText: response.statusText,
      elapsedMs: Date.now() - startedAt,
      key,
      content: parsed?.choices?.[0]?.message?.content || null,
      error: response.ok ? null : sanitizeProviderBody(text)
    }, null, 2), {
      status: response.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      ok: false,
      provider: 'cerebras',
      model: CEREBRAS_MODEL,
      endpoint: CEREBRAS_ENDPOINT,
      key,
      error: sanitizeProviderBody(String(error?.message || error || 'Unknown Cerebras probe failure'))
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
