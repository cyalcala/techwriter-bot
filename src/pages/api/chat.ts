import type { APIRoute } from 'astro';
import { routeChat } from '../../lib/zen-router';
import type { IntentVariant } from '../../lib/providers';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();
    const { messages, intent = 'chat-fast' } = body;
    
    // Fallback environment grabbing depending on how Astro/Wrangler provides them
    const env = (locals as any).runtime?.env || process.env || import.meta.env;

    const response = await routeChat(intent as IntentVariant, messages, env);

    if (!response.ok) {
        return response; // Pass through the 503 or other error
    }

    // Return the SSE stream directly to the client
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error("[Chat API] Internal Server Error:", error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
};
