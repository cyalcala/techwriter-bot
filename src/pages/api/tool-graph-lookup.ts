import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';
import { apiError, createRequestId, jsonResponse } from '../../lib/api-response';
import { ensureGraph, queryGraphReferences } from '../../lib/graph-query';
import { boundLookupResult, validateLookupTerm } from '../../lib/tool-graph-lookup';

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store, private' };
const MAX_BODY_LENGTH = 1024;

function loadEnv(locals: App.Locals): Record<string, unknown> {
  const env: Record<string, unknown> = {};
  try { if (cfGlobalEnv) Object.assign(env, cfGlobalEnv); } catch {}
  try {
    const runtimeEnv = (locals as any)?.runtime?.env;
    if (runtimeEnv) Object.assign(env, runtimeEnv);
  } catch {}
  return env;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = createRequestId();

  let body: { term?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_LENGTH) throw new Error('oversized');
    body = JSON.parse(raw) as { term?: unknown };
  } catch {
    return apiError({
      requestId,
      status: 400,
      code: 'INVALID_LOOKUP_REQUEST',
      message: 'Provide one bounded reference term.',
      headers: RESPONSE_HEADERS,
    });
  }

  const term = validateLookupTerm(body.term);
  if (!term) {
    return apiError({
      requestId,
      status: 400,
      code: 'INVALID_LOOKUP_TERM',
      message: 'Provide one bounded reference term.',
      headers: RESPONSE_HEADERS,
    });
  }

  try {
    const graph = await ensureGraph((loadEnv(locals) as any).SESSION);
    if (!graph.available) {
      return jsonResponse({ available: false, context: '', nodeCount: 0 }, {
        requestId,
        headers: RESPONSE_HEADERS,
      });
    }

    return jsonResponse(boundLookupResult(queryGraphReferences(term)), {
      requestId,
      headers: RESPONSE_HEADERS,
    });
  } catch {
    return apiError({
      requestId,
      status: 503,
      code: 'GRAPH_LOOKUP_UNAVAILABLE',
      message: 'Reference lookup is unavailable.',
      retryable: true,
      headers: RESPONSE_HEADERS,
    });
  }
};

export const GET: APIRoute = async () => apiError({
  requestId: createRequestId(),
  status: 405,
  code: 'METHOD_NOT_ALLOWED',
  message: 'Use POST /api/tool-graph-lookup.',
  headers: RESPONSE_HEADERS,
});
