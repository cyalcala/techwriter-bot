import type { APIRoute } from 'astro';
import { apiError, createRequestId, jsonResponse } from '../../lib/api-response';
import { checkCSRF } from '../../lib/csrf';
import {
  createWebhookExportPayload,
  sendWebhookExport,
  validateWebhookUrl,
} from '../../lib/webhook-export';

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store, private' };
const MAX_BODY_LENGTH = 200_000;

function hasTrustedOrigin(request: Request): boolean {
  return Boolean(request.headers.get('origin') || request.headers.get('referer'));
}

export const POST: APIRoute = async ({ request }) => {
  const requestId = createRequestId();

  if (!hasTrustedOrigin(request) || !checkCSRF(request)) {
    return apiError({
      requestId,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Request origin is not allowed.',
      headers: RESPONSE_HEADERS,
    });
  }

  let body: { webhookUrl?: unknown; index?: unknown; message?: any };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_LENGTH) {
      return apiError({
        requestId,
        status: 413,
        code: 'WEBHOOK_EXPORT_TOO_LARGE',
        message: 'Webhook export payload is too large.',
        headers: RESPONSE_HEADERS,
      });
    }
    body = JSON.parse(raw);
  } catch {
    return apiError({
      requestId,
      status: 400,
      code: 'INVALID_WEBHOOK_EXPORT',
      message: 'Provide one webhook URL and assistant response.',
      headers: RESPONSE_HEADERS,
    });
  }

  const webhookUrl = validateWebhookUrl(body.webhookUrl);
  const payload = createWebhookExportPayload({
    index: Number(body.index),
    message: body.message,
  });

  if (!webhookUrl || !payload) {
    return apiError({
      requestId,
      status: 400,
      code: 'INVALID_WEBHOOK_EXPORT',
      message: 'Provide one HTTPS webhook URL and assistant response.',
      headers: RESPONSE_HEADERS,
    });
  }

  const delivery = await sendWebhookExport({ url: webhookUrl, payload });
  if (!delivery.ok) {
    return apiError({
      requestId,
      status: 502,
      code: 'WEBHOOK_DELIVERY_FAILED',
      message: delivery.error,
      retryable: true,
      headers: RESPONSE_HEADERS,
    });
  }

  return jsonResponse({
    ok: true,
    attempts: delivery.attempts,
    status: delivery.status,
    deliveredAt: delivery.deliveredAt,
  }, {
    requestId,
    headers: RESPONSE_HEADERS,
  });
};

export const GET: APIRoute = async () => apiError({
  requestId: createRequestId(),
  status: 405,
  code: 'METHOD_NOT_ALLOWED',
  message: 'Use POST /api/webhook-export.',
  headers: RESPONSE_HEADERS,
});
