import { ZEN_REGISTRY, VARIANTS, type IntentVariant, type Provider } from './providers';

const PROVIDER_COOLDOWN_MS = 45_000;
const PROVIDER_TIMEOUT_MS = 30_000;

const providerCooldowns = new Map<string, number>();

type FailureKind = 'temporary' | 'configuration' | 'request' | 'auth' | 'provider';

export async function routeChat(intent: IntentVariant, messages: any[], env: any) {
  const variant = VARIANTS[intent] || VARIANTS['chat-fast'];
  const errors: string[] = [];

  for (const providerId of variant.providerPreference) {
    const provider = ZEN_REGISTRY.find(p => p.id === providerId);
    if (!provider) continue;

    try {
      if (isCoolingDown(provider.id)) {
        errors.push(`${provider.id}: temporarily cooling down`);
        continue;
      }

      console.log(`[ZenRouter] Attempting to route to ${provider.id}...`);
      const res = await callProvider(provider, variant, messages, env);

      if (res.ok) {
        console.log(`[Zen Router] Success with ${provider.id}`);
        const providerName = provider.id;

        const newHeaders = new Headers(res.headers);
        newHeaders.set('x-provider', providerName);
        newHeaders.set('Content-Type', 'text/event-stream');
        newHeaders.set('Cache-Control', 'no-cache');
        newHeaders.set('Connection', 'keep-alive');

        return new Response(res.body, {
          status: res.status,
          headers: newHeaders
        });
      }

      const failureKind = classifyStatus(res.status);
      console.warn(`[ZenRouter] Provider ${provider.id} returned ${res.status} (${failureKind})`);
      await drainResponse(res);
      errors.push(`${provider.id}: ${failureKind} failure (${res.status})`);

      if (failureKind === 'temporary') {
        coolDown(provider.id);
        continue;
      }

      return new Response(JSON.stringify({
        error: 'AI_PROVIDER_REQUEST_FAILED',
        provider: provider.id,
        status: res.status,
        details: `${provider.id} returned a non-retryable ${failureKind} failure.`
      }), {
        status: res.status >= 400 && res.status < 500 ? 502 : res.status,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e: any) {
      const failureKind = classifyError(e);
      console.error(`[ZenRouter] Provider ${provider.id} threw a ${failureKind} error:`, sanitizeError(e));
      errors.push(`${provider.id}: ${failureKind} error`);

      if (failureKind === 'temporary') {
        coolDown(provider.id);
        continue;
      }

      return new Response(JSON.stringify({
        error: 'AI_PROVIDER_CONFIGURATION_FAILED',
        provider: provider.id,
        details: `${provider.id} failed before the request could be sent.`
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response(JSON.stringify({ error: 'All AI providers are temporarily unavailable.', details: errors }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function callProvider(provider: Provider, variant: typeof VARIANTS[IntentVariant], messages: any[], env: any) {
  const endpoint = provider.name === 'gemini'
    ? `${provider.endpoint}/openai/chat/completions`
    : `${provider.endpoint}/chat/completions`;

  const apiKey = env[`${provider.name.toUpperCase()}_API_KEY`];

  if (!apiKey) {
    throw new Error(`Missing API Key for ${provider.name}. Ensure ${provider.name.toUpperCase()}_API_KEY is set in your Cloudflare secrets.`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('Provider request timed out'), PROVIDER_TIMEOUT_MS);

  const payload: any = {
    model: provider.model,
    messages: messages,
    temperature: variant.temperature,
    max_tokens: variant.max_tokens,
    stream: true
  };

  if (provider.name === 'nvidia' && (provider.model.includes('nemotron') || provider.model.includes('deepseek'))) {
    payload.extra_body = {
      chat_template_kwargs: { thinking: false }
    };
  }

  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function classifyStatus(status: number): FailureKind {
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) {
    return 'temporary';
  }
  if ([401, 403].includes(status)) {
    return 'auth';
  }
  if ([400, 404, 422].includes(status)) {
    return 'request';
  }
  return status >= 500 ? 'temporary' : 'provider';
}

function classifyError(error: any): FailureKind {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('missing api key')) {
    return 'configuration';
  }
  if (error?.name === 'AbortError' || message.includes('timeout') || message.includes('network')) {
    return 'temporary';
  }
  return 'temporary';
}

function coolDown(providerId: string) {
  providerCooldowns.set(providerId, Date.now() + PROVIDER_COOLDOWN_MS);
}

function isCoolingDown(providerId: string) {
  const until = providerCooldowns.get(providerId);
  if (!until) return false;
  if (Date.now() >= until) {
    providerCooldowns.delete(providerId);
    return false;
  }
  return true;
}

async function drainResponse(response: Response) {
  try {
    await response.arrayBuffer();
  } catch {}
}

function sanitizeError(error: any) {
  const message = String(error?.message || error || 'unknown error');
  return message.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]');
}
