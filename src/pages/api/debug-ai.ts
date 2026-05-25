import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { apiError, createRequestId, jsonResponse } from '../../lib/api-response';

export const GET: APIRoute = async () => {
  const requestId = createRequestId();
  try {
    const ai = (env as any).AI;
    
    if (!ai) {
      return apiError({
        requestId,
        status: 500,
        code: 'AI_BINDING_MISSING',
        message: 'AI binding not found.',
        retryable: true,
      });
    }

    const result = await ai.run('@cf/baai/bge-small-en-v1.5', { text: ['test'] });

    return jsonResponse({
      success: true, 
      embeddingLength: result?.data?.[0]?.length,
      envKeys: Object.keys(env)
    }, { requestId });
  } catch (err: any) {
    return apiError({
      requestId,
      status: 500,
      code: 'AI_DEBUG_FAILED',
      message: err.message || 'AI debug check failed.',
      retryable: true,
    });
  }
};
