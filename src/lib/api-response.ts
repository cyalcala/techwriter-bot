export interface ApiErrorOptions {
  requestId: string;
  status?: number;
  code: string;
  message: string;
  retryable?: boolean;
  retryAfter?: number;
  headers?: HeadersInit;
}

export interface JsonResponseOptions {
  requestId: string;
  status?: number;
  headers?: HeadersInit;
}

export function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function withRequestId(headers: HeadersInit | undefined, requestId: string): Headers {
  const next = new Headers(headers);
  next.set('x-request-id', requestId);
  return next;
}

export function jsonResponse(body: unknown, options: JsonResponseOptions): Response {
  const headers = withRequestId(options.headers, options.requestId);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers,
  });
}
export function apiError(options: ApiErrorOptions): Response {
  const headers = withRequestId(options.headers, options.requestId);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (options.retryAfter != null) headers.set('Retry-After', String(options.retryAfter));

  return new Response(JSON.stringify({
    error: options.message,
    code: options.code,
    retryable: options.retryable ?? false,
  }), {
    status: options.status ?? 500,
    headers,
  });
}
