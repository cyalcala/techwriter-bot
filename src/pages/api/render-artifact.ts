import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { apiError, createRequestId, jsonResponse } from '../../lib/api-response';
import { renderViaKroki, KROKI_RENDERABLE } from '../../lib/kroki-renderer';

function loadEnv(locals: any): any {
  const env: any = {};
  try { if (cfGlobalEnv) Object.assign(env, cfGlobalEnv); } catch {}
  try { const r = (locals as any)?.runtime?.env; if (r) for (const [k, v] of Object.entries(r)) { if (v != null && !env[k]) env[k] = v; } } catch {}
  return env;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = createRequestId();
  const env = loadEnv(locals);

  try {
    const body = await request.json().catch(() => null);
    if (!body?.type || !body?.code) {
      return apiError({ requestId, status: 400, code: 'INVALID_REQUEST', message: 'Artifact type and code are required.' });
    }

    const type = String(body.type || '').toLowerCase();
    const code = String(body.code || '');
    if (code.length > 200_000) {
      return apiError({ requestId, status: 413, code: 'ARTIFACT_TOO_LARGE', message: 'Artifact source is too large to render safely.' });
    }
    if (!KROKI_RENDERABLE.has(type)) {
      return apiError({ requestId, status: 400, code: 'UNSUPPORTED_ARTIFACT_TYPE', message: `${type} is not server-renderable.` });
    }

    const result = await renderViaKroki(type, code);
    if (result.svg) {
      return jsonResponse({ svg: result.svg, cached: result.cached }, {
        requestId,
        headers: {
          'Cache-Control': 'no-store, private',
        },
      });
    }
    const statusCode = result.status === 400 ? 400 : 502;
    return apiError({
      requestId,
      status: statusCode,
      code: 'RENDER_FAILED',
      message: result.error || 'Renderer returned no SVG.',
      retryable: statusCode >= 500,
    });
  } catch {
    return apiError({
      requestId,
      status: 500,
      code: 'SERVER_ERROR',
      message: 'Artifact render failed.',
      retryable: true,
    });
  }
};
