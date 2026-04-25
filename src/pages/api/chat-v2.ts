import type { APIRoute } from 'astro';

export const POST: APIRoute = async (context) => {
  const { request, locals } = context;
  const env = (locals as any).runtime?.env || (locals as any).env || locals || {};
  
  try {
    const { messages } = await request.json();
    const apiKey = env.CEREBRAS_API_KEY || 'csk-mrhhj8p4xvd42xwnxx9h4wp5kekt8mtnrr3n9m4838p6m2d4';

    if (!apiKey) {
      return new Response("ERROR: CEREBRAS_API_KEY is missing from Cloudflare Secrets.", { status: 500 });
    }

    console.log("[Chat API V2] Direct Cerebras Call Starting...");

    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3.1-70b',
        messages: messages,
        stream: true
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(`CEREBRAS_ERROR: ${response.status} - ${err}`, { status: response.status });
    }

    return new Response(response.body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'x-provider': 'cerebras-direct' }
    });

  } catch (error: any) {
    return new Response(`DIRECT_FATAL: ${error.message}\n${error.stack}`, { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
    });
  }
};
