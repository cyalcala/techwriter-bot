import { ZEN_REGISTRY, VARIANTS, type IntentVariant, type Provider } from './providers';

export async function routeChat(intent: IntentVariant, messages: any[], env: any) {
  const variant = VARIANTS[intent] || VARIANTS['chat-fast'];
  
  for (const providerId of variant.providerPreference) {
    const provider = ZEN_REGISTRY.find(p => p.id === providerId);
    if (!provider) continue;

    try {
      console.log(`[ZenRouter] Attempting to route to ${provider.id}...`);
      const response = await callProvider(provider, variant, messages, env);
      
      if (response.ok) {
        console.log(`[ZenRouter] Success routing to ${provider.id}`);
        return response;
      }
      
      console.warn(`[ZenRouter] Provider ${provider.id} returned status ${response.status}`);
      // If 429 or 5xx, we continue to the next fallback provider
    } catch (e) {
      console.error(`[ZenRouter] Provider ${provider.id} threw an error:`, e);
      continue;
    }
  }
  
  return new Response(JSON.stringify({ error: 'All free API providers exhausted or unavailable.' }), { status: 503 });
}

async function callProvider(provider: Provider, variant: typeof VARIANTS[IntentVariant], messages: any[], env: any) {
  // Gemini requires the /openai/ prefix for their compatibility endpoint
  const endpoint = provider.name === 'gemini' 
    ? `${provider.endpoint}/openai/chat/completions`
    : `${provider.endpoint}/chat/completions`;

  const apiKey = env[`${provider.name.toUpperCase()}_API_KEY`];
  
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
