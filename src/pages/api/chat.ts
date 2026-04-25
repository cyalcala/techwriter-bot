import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  // This route runs on Cloudflare edge (Worker environment)
  
  try {
    const body = await request.json();
    const { message, intent = 'chat-fast' } = body;
    
    // Placeholder for Zen Router logic
    // We will connect Groq, NVIDIA, and Gemini here based on `intent`
    
    return new Response(JSON.stringify({
      response: `Echo from Cloudflare Edge. You said: ${message}`,
      intent_detected: intent
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
};
