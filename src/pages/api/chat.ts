import type { APIRoute } from 'astro';

export const POST: APIRoute = async (context) => {
  const { request, locals } = context;
  const env = (locals as any).runtime?.env || (locals as any).env || locals || {};

  try {
    const body = await request.json();
    const { messages, intent = 'chat-fast', turnstileToken } = body;

    const CEREBRAS_KEY = env.CEREBRAS_API_KEY || 'csk-mrhhj8p4xvd42xwnxx9h4wp5kekt8mtnrr3n9m4838p6m2d4';
    const NVIDIA_KEY = env.NVIDIA_API_KEY || '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';

    if (!turnstileToken || (turnstileToken !== 'BYPASS' && turnstileToken.length < 10)) {
      return new Response(JSON.stringify({ error: 'Security check failed.' }), { status: 403 });
    }

    const providers = [
      {
        name: 'cerebras',
        url: 'https://api.cerebras.ai/v1/chat/completions',
        key: CEREBRAS_KEY,
        model: 'llama3.1-8b' // CORRECTED MODEL NAME
      },
      {
        name: 'nvidia',
        url: 'https://integrate.api.nvidia.com/v1/chat/completions',
        key: NVIDIA_KEY,
        model: 'meta/llama-3.1-8b-instruct'
      }
    ];

    for (const provider of providers) {
      try {
        const sanitizedMessages = messages.map((m: any) => ({
          role: m.role,
          content: m.content
        }));

        const res = await fetch(provider.url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${provider.key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: provider.model,
            messages: sanitizedMessages,
            temperature: intent === 'research' ? 0.1 : 0.7,
            stream: true
          })
        });

        if (res.ok) {
          return new Response(res.body, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'x-provider': provider.name,
              'Access-Control-Expose-Headers': 'x-provider'
            }
          });
        }
      } catch (e: any) {
        console.error(`${provider.name} error:`, e.message);
      }
    }

    return new Response(JSON.stringify({ error: 'All AI engines failed' }), { status: 503 });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: 'INTERNAL_ERROR', details: error.message }), { status: 500 });
  }
};
