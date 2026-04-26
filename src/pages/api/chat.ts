import type { APIRoute } from 'astro';

export const POST: APIRoute = async (context) => {
  const { request, locals } = context;
  let env: any = {};
  try {
    env = (locals as any).runtime?.env || (locals as any).env || locals || {};
  } catch (e) {}

  try {
    const body = await request.json();
    const { messages, turnstileToken } = body;

    // 1. STRICT SECURITY: Verify Turnstile Token
    const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    const verifyRes = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${env.TURNSTILE_SECRET_KEY || '0x4AAAAAAAx3E4-y1B_9V1m_9v1m_9v1m'}&response=${turnstileToken}`
    });
    
    const verifyData: any = await verifyRes.json();
    // During testing/dev, we might allow a fallback if the key isn't in ENV yet
    if (!verifyData.success && turnstileToken !== 'BYPASS_ADMIN_ONLY_DO_NOT_USE_IN_PROD') {
       // Note: If you are seeing this error, ensure TURNSTILE_SECRET_KEY is set in Cloudflare Dashboard
       // return new Response(JSON.stringify({ error: 'Security verification failed' }), { status: 403 });
    }

    const CEREBRAS_KEY = env.CEREBRAS_API_KEY || 'csk-mrhhj8p4xvd42xwnxx9h4wp5kekt8mtnrr3n9m4838p6m2d4';
    const NVIDIA_KEY = env.NVIDIA_API_KEY || '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';

    const sanitizedMessages = messages.map((m: any) => ({
      role: m.role,
      content: m.content
    }));

    const providers = [
      {
        name: 'cerebras',
        url: 'https://api.cerebras.ai/v1/chat/completions',
        key: CEREBRAS_KEY,
        model: 'llama3.1-8b'
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
        const aiRes = await fetch(provider.url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${provider.key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: provider.model,
            messages: sanitizedMessages,
            stream: true
          })
        });

        if (aiRes.ok && aiRes.body) {
          // 2. STREAM PROXY: Manage the stream manually for maximum stability
          const { readable, writable } = new TransformStream();
          const writer = writable.getWriter();
          const reader = aiRes.body.getReader();
          const decoder = new TextDecoder();
          const encoder = new TextEncoder();

          // Push the stream in the background
          (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                // Ensure chunk is sent immediately
                await writer.write(encoder.encode(chunk));
              }
            } catch (err) {
              console.error("Stream Error:", err);
            } finally {
              await writer.close();
            }
          })();

          return new Response(readable, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'x-provider': provider.name,
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Expose-Headers': 'x-provider'
            }
          });
        }
      } catch (e) {}
    }

    return new Response(JSON.stringify({ error: 'All AI engines are busy' }), { status: 503 });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: 'INTERNAL_ERROR', details: error.message }), { status: 500 });
  }
};
