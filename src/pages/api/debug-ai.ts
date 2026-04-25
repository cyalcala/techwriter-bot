import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async () => {
  try {
    const ai = (env as any).AI;
    
    if (!ai) {
      return new Response(JSON.stringify({ 
        error: 'AI binding not found',
        envKeys: Object.keys(env)
      }, null, 2), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await ai.run('@cf/baai/bge-small-en-v1.5', { text: ['test'] });

    return new Response(JSON.stringify({ 
      success: true, 
      embeddingLength: result?.data?.[0]?.length,
      envKeys: Object.keys(env)
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ 
      error: err.message, 
      stack: err.stack?.split('\n').slice(0, 5)
    }, null, 2), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
