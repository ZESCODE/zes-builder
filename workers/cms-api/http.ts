/**
 * Shared HTTP helpers of the CMS API Worker.
 *
 * Every response carries the request id so that a request can be traced across
 * the Vercel logs and the Worker logs. Error bodies never contain SQL, stack
 * traces, configuration or credentials.
 */

export interface ErrorBody {
  error: string;
  code: string;
  requestId: string;
}

export function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-zes-request-id': requestId,
    },
  });
}

export function errorResponse(status: number, code: string, message: string, requestId: string): Response {
  const body: ErrorBody = { error: message, code, requestId };

  return jsonResponse(body, status, requestId);
}

/** Returns the incoming request id when it looks sane, otherwise a new one. */
export function resolveRequestId(request: Request): string {
  const incoming = request.headers.get('x-zes-request-id') ?? '';
  const pattern = /^[A-Za-z0-9_-]{8,128}$/;

  if (pattern.test(incoming)) {
    return incoming;
  }

  return crypto.randomUUID();
}
