import type { APIRoute } from 'astro';
import { apiError, createRequestId } from '../../lib/api-response';

export const GET: APIRoute = async () => apiError({
  requestId: createRequestId(),
  status: 404,
  code: 'DIAGNOSTICS_DISABLED',
  message: 'Diagnostics endpoint is not available.',
});
