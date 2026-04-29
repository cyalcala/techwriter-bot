import { ZEN_REGISTRY, VARIANTS, type IntentVariant, type Provider } from './providers';

const PROVIDER_COOLDOWN_MS = 45_000;
const PROVIDER_TIMEOUT_MS = 8_000;
const AUTH_COOLDOWN_MS = 600_000; // 10 mins for 403/401

const providerCooldowns = new Map<string, number>();

type FailureKind = 'temporary' | 'configuration' | 'request' | 'auth' | 'provider';

export async function routeChat(intent: IntentVariant, messages: any[], locals: any, providedEnv?: any) {
  let env: any = { ...(providedEnv || {}) };
  try {
    const knownKeys = ['CEREBRAS_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TURNSTILE_SECRET_KEY', 'AI', 'SESSION'];

    for (const k of knownKeys) {
      if (env[k] !== undefined && env[k] !== null) continue;
      try {
        env[k] =
          (locals as any)?.runtime?.env?.[k] ??
          (locals as any)?.cfContext?.env?.[k] ??
          (locals as any)?.[k] ??
          (globalThis as any)[k];
      } catch (e) {}
    }

    if (!env.CEREBRAS_API_KEY) {
      try {
        const { env: cfEnv } = await import('cloudflare:workers');
        if (cfEnv) {
          for (const k of knownKeys) {
            if (!env[k] && cfEnv[k]) env[k] = cfEnv[k];
          }
        }
      } catch (e) {}
    }

    if (!env.CEREBRAS_API_KEY) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const envPath = path.join(process.cwd(), '.env');
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf-8');
          content.split(/\r?\n/).forEach(line => {
            const [k, ...v] = line.split('=');
            if (k && v.length > 0) {
              const key = k.trim();
              const val = v.join('=').trim();
              if (val && !env[key]) env[key] = val;
            }
          });
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error('[ZenRouter] Env extraction failed:', e);
  }

  const variantKey = (intent && VARIANTS.hasOwnProperty(intent)) ? intent : 'chat-fast';
  const variant = VARIANTS[variantKey as keyof typeof VARIANTS] || VARIANTS['chat-fast'];
  
  console.log(`[ZenRouter] Using variant: ${variantKey}. Providers: [${variant.providerPreference.join(', ')}]`);
  
  const errors: string[] = [];

  for (const providerId of variant.providerPreference) {
    const provider = ZEN_REGISTRY.find(p => p.id === providerId);
    if (!provider) continue;

    try {
      if (isCoolingDown(provider.id)) {
        errors.push(`${provider.id}: cooling down`);
        continue;
      }

      console.log(`[ZenRouter] Attempting ${provider.id}...`);
      const res = await callProvider(provider, variant, messages, env);

      if (res.ok) {
        const newHeaders = new Headers(res.headers);
        newHeaders.set('x-provider', provider.id);
        newHeaders.set('Content-Type', 'text/event-stream');
        return new Response(res.body, { status: res.status, headers: newHeaders });
      }

      const failureKind = classifyStatus(res.status);
      const errorText = await res.text().catch(() => 'unknown error');
      errors.push(`${provider.id}: ${failureKind} (${res.status}) - ${errorText.slice(0, 100)}`);

      if (variant.providerPreference.indexOf(providerId) === variant.providerPreference.length - 1) {
        return new Response(JSON.stringify({
          error: 'AI_PROVIDER_REQUEST_FAILED',
          provider: provider.id,
          details: `${provider.id} failed (${res.status}) and no fallbacks remain.`,
          errors: errors,
          diagnostics: { envKeys: Object.keys(env) }
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }

      coolDown(provider.id, failureKind === 'auth' ? AUTH_COOLDOWN_MS : PROVIDER_COOLDOWN_MS);
      continue;
    } catch (e: any) {
      const isMissingKey = String(e?.message || '').toLowerCase().includes('missing api key');
      errors.push(`${provider.id}: error`);

      if (variant.providerPreference.indexOf(providerId) === variant.providerPreference.length - 1) {
        const diag: any = { provider: provider.id };
        try {
          diag.envKeys = Object.keys(env || {});
          diag.localsKeys = Object.keys(locals || {});
          diag.runtimeKeys = Object.keys(locals?.runtime || {});
        } catch (diagError) {}

        return new Response(JSON.stringify({
          error: isMissingKey ? 'AI_PROVIDER_CONFIGURATION_FAILED' : 'AI_PROVIDER_FATAL_ERROR',
          provider: provider.id,
          details: isMissingKey 
            ? `${provider.id} is missing its API key.`
            : `${provider.id} failed: ${e.message}`,
          errors: errors,
          diagnostics: diag
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      coolDown(provider.id, PROVIDER_COOLDOWN_MS);
      continue;
    }
  }

  return new Response(JSON.stringify({ error: 'All AI providers are temporarily unavailable.', details: errors }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function callProvider(provider: Provider, variant: any, messages: any[], env: any) {
  if (provider.name === 'cloudflare') {
    return await callWorkersAI(provider, messages, env);
  }

  const endpoint = provider.name === 'gemini'
    ? `${provider.endpoint}/openai/chat/completions`
    : `${provider.endpoint}/chat/completions`;

  const apiKey = typeof env[`${provider.name.toUpperCase()}_API_KEY`] === 'string'
    ? env[`${provider.name.toUpperCase()}_API_KEY`].trim()
    : env[`${provider.name.toUpperCase()}_API_KEY`];

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

async function callWorkersAI(provider: Provider, messages: any[], env: any) {
  const ai = env.AI;
  if (!ai) {
    throw new Error("Cloudflare AI binding not found in environment.");
  }

  // Workers AI streaming response is a ReadableStream
  const stream = await ai.run(provider.model as any, {
    messages,
    stream: true
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
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

function coolDown(providerId: string, durationMs: number = PROVIDER_COOLDOWN_MS) {
  providerCooldowns.set(providerId, Date.now() + durationMs);
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
