import { ZEN_REGISTRY, VARIANTS, type IntentVariant, type Provider } from './providers';

export async function routeChat(intent: IntentVariant, messages: any[], env: any) {
  const variant = VARIANTS[intent] || VARIANTS['chat-fast'];
  const errors: string[] = [];
  
  for (const providerId of variant.providerPreference) {
    const provider = ZEN_REGISTRY.find(p => p.id === providerId);
    if (!provider) continue;

    try {
      console.log(`[ZenRouter] Attempting to route to ${provider.id}...`);
      const res = await callProvider(provider, variant, messages, env);
      
      if (res.ok) {
        console.log(`[Zen Router] Success with ${provider.id}`);
        // Wrap the response to include the provider header
        const { body, headers } = res;
        const newHeaders = new Headers(headers);
        newHeaders.set('x-provider', provider.id);
        return new Response(body, { ...res, headers: newHeaders });
      }
      
      console.warn(`[ZenRouter] Provider ${provider.id} returned status ${res.status}`);
      const errText = await res.text();
      errors.push(`${provider.id} failed with ${res.status}: ${errText}`);
      // If 429 or 5xx, we continue to the next fallback provider
    } catch (e: any) {
      console.error(`[ZenRouter] Provider ${provider.id} threw an error:`, e);
      errors.push(`${provider.id} error: ${e.message || String(e)}`);
      continue;
    }
  }
  
  return new Response(JSON.stringify({ error: 'All free API providers exhausted or unavailable.', details: errors }), { status: 503 });
}

async function callProvider(provider: Provider, variant: typeof VARIANTS[IntentVariant], messages: any[], env: any) {
  // Gemini requires the /openai/ prefix for their compatibility endpoint
  const endpoint = provider.name === 'gemini' 
    ? `${provider.endpoint}/openai/chat/completions`
    : `${provider.endpoint}/chat/completions`;

  let apiKey = env[`${provider.name.toUpperCase()}_API_KEY`];
  
  if (!apiKey) {
    if (provider.name === 'cerebras') apiKey = 'csk-mrhhj8p4xvd42xwnxx9h4wp5kekt8mtnrr3n9m4838p6m2d4';
    if (provider.name === 'nvidia') apiKey = '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';
  }

  if (!apiKey) {
    throw new Error(`Missing API Key for ${provider.name}. Ensure ${provider.name.toUpperCase()}_API_KEY is set in your Cloudflare secrets.`);
  }

  const payload = {
    model: provider.model,
    messages: messages,
    temperature: variant.temperature,
    max_tokens: variant.max_tokens,
    stream: true
  };

  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}
