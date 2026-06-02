import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { apiError, createRequestId, jsonResponse } from '../../lib/api-response';
import { readEnvKeys } from '../../lib/env-reader';
import { collectOperationalStats, isStatsAuthorized } from '../../lib/stats';

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store, private' };

function loadEnv(locals: App.Locals): Record<string, unknown> {
  const env: Record<string, unknown> = {};
  try { if (cfGlobalEnv) Object.assign(env, cfGlobalEnv); } catch {}
  try {
    const runtimeEnv = (locals as any)?.runtime?.env;
    if (runtimeEnv) {
      for (const [key, value] of Object.entries(runtimeEnv)) {
        if (value != null && !env[key]) env[key] = value;
      }
    }
  } catch {}
  readEnvKeys(env);
  return env;
}

function hasStatsPassword(env: Record<string, unknown>): boolean {
  return typeof env.STATS_PASSWORD === 'string' && env.STATS_PASSWORD.trim().length > 0;
}

export const GET: APIRoute = async ({ request, locals }) => {
  const requestId = createRequestId();
  const env = loadEnv(locals);

  if (!hasStatsPassword(env)) {
    return apiError({
      requestId,
      status: 503,
      code: 'STATS_UNAVAILABLE',
      message: 'Stats endpoint is not configured.',
      retryable: false,
      headers: RESPONSE_HEADERS,
    });
  }

  if (!isStatsAuthorized(request.headers, env)) {
    return apiError({
      requestId,
      status: 401,
      code: 'STATS_AUTH_REQUIRED',
      message: 'Stats password is required.',
      retryable: false,
      headers: RESPONSE_HEADERS,
    });
  }

  try {
    const stats = await collectOperationalStats((env as any).SESSION, env, { hours: 24 });
    return jsonResponse({
      status: 'ok',
      ...stats,
    }, {
      requestId,
      headers: RESPONSE_HEADERS,
    });
  } catch {
    return apiError({
      requestId,
      status: 503,
      code: 'STATS_UNAVAILABLE',
      message: 'Stats are unavailable.',
      retryable: true,
      headers: RESPONSE_HEADERS,
    });
  }
};

export const POST: APIRoute = async () => apiError({
  requestId: createRequestId(),
  status: 405,
  code: 'METHOD_NOT_ALLOWED',
  message: 'Use GET /api/stats.',
  headers: RESPONSE_HEADERS,
});
