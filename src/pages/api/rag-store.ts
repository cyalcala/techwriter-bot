import type { APIRoute } from 'astro';
import { apiError, createRequestId } from '../../lib/api-response';

export const POST: APIRoute = async () => apiError({
  requestId: createRequestId(),
  status: 410,
  code: 'CONTENT_RETENTION_DISABLED',
  message: 'Persistent document storage is disabled in privacy-first mode.',
});
