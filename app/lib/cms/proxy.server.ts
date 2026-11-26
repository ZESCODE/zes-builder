/**
 * Server-side proxy to the CMS API Worker — Phase 1C.3.
 *
 * The browser never talks to the Worker. Every browser request is handled by
 * the Vercel application, which
 *
 * 1. authenticates the caller with the existing Whop session and the access
 *    gate,
 * 2. derives the tenant principal from the session — never from the request
 *    payload, a query parameter or a client supplied header,
 * 3. protects mutations against cross-site requests (origin allowlist, fetch
 *    metadata and a required custom header),
 * 4. calls the Worker with a signed tenant assertion and
 * 5. validates and re-emits the answer of the Worker.
 *
 * The credentials of the service (`CMS_SERVICE_TOKEN`, `CMS_ASSERTION_SECRET`)
 * stay on the server; they are never part of a response and never reach the
 * browser.
 */

import { CmsApiError, callCmsApi, readCmsApiConfig } from '~/lib/cms/api-client.server';
import { canonicalPrincipal } from '~/lib/tenancy/principal';
import { readSession } from '~/lib/whop.server';

/** Custom header a browser has to send with every mutating request. */
export const CMS_MUTATION_HEADER = 'x-zes-csrf';

const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWebsiteShape(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && typeof value.slug === 'string';
}

/** The origins that may send a mutating request to this deployment. */
export function allowedOrigins(request: Request, env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.CMS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const requestOrigin = new URL(request.url).origin;

  return configured.includes(requestOrigin) ? configured : [requestOrigin, ...configured];
}

/**
 * Rejects a mutating request that does not come from this application.
 *
 * Three independent checks have to pass: the `Origin` header has to be the
 * origin of the application (or an explicitly allowed one), the fetch metadata
 * may not report a cross-site request and the custom header has to be present.
 * A cross-site form post cannot set a custom header, so the third check alone
 * already blocks the classic CSRF attack; the first two make an accidental
 * cross-origin call impossible as well.
 */
export function assertMutationAllowed(request: Request, env: NodeJS.ProcessEnv = process.env): Response | null {
  const origin = request.headers.get('origin');

  if (origin && !allowedOrigins(request, env).includes(origin)) {
    return Response.json({ error: 'The request origin is not allowed', code: 'origin_not_allowed' }, { status: 403 });
  }

  const fetchSite = request.headers.get('sec-fetch-site');

  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
    return Response.json({ error: 'The request is not allowed', code: 'cross_site_request' }, { status: 403 });
  }

  if (request.headers.get(CMS_MUTATION_HEADER) !== '1') {
    return Response.json(
      { error: 'The request is missing its CSRF header', code: 'missing_csrf_header' },
      { status: 403 },
    );
  }

  return null;
}

function errorResponse(status: number, code: string, message: string, requestId: string): Response {
  return Response.json(
    { error: message, code, requestId },
    { status, headers: { 'x-zes-request-id': requestId, 'cache-control': 'no-store' } },
  );
}

/** Maps the status of the Worker onto the status of the browser response. */
function mapStatus(status: number): number {
  if (status === 201 || status === 400 || status === 401 || status === 403 || status === 404) {
    return status;
  }

  if (status === 405 || status === 409 || status === 503) {
    return status;
  }

  if (status >= 500) {
    return 500;
  }

  return status;
}

function successResponse(status: number, body: unknown, requestId: string): Response {
  return Response.json(body, {
    status,
    headers: { 'x-zes-request-id': requestId, 'cache-control': 'no-store' },
  });
}

export interface CmsProxyRequest {
  request: Request;
  method: string;
  path: string;
  body?: string;
}

/**
 * Proxies a browser request to the CMS API Worker.
 *
 * The returned response is the response of the browser: the payload of a
 * successful call is validated before it is passed on, and an error of the
 * Worker is mapped onto a status and a message that reveal nothing about the
 * database.
 */
export async function proxyToCmsApi(options: CmsProxyRequest): Promise<Response> {
  const { request, method, path } = options;
  const requestId = crypto.randomUUID();
  const normalizedMethod = method.toUpperCase();

  if (MUTATING_METHODS.has(normalizedMethod)) {
    const denied = assertMutationAllowed(request);

    if (denied) {
      return denied;
    }
  }

  const session = await readSession(request);

  if (!session) {
    return errorResponse(401, 'sign_in_required', 'Sign in required', requestId);
  }

  let tenant: string;

  try {
    tenant = canonicalPrincipal(session.userId);
  } catch {
    return errorResponse(401, 'sign_in_required', 'Sign in required', requestId);
  }

  const config = readCmsApiConfig();

  if (!config) {
    console.error('[cms/proxy] the CMS API is not configured');

    return errorResponse(503, 'unavailable', 'The website store is currently unavailable', requestId);
  }

  let result;

  try {
    result = await callCmsApi({
      config,
      tenant,
      method: normalizedMethod,
      path,
      ...(options.body === undefined ? {} : { body: options.body }),
      requestId,
    });
  } catch (error) {
    if (error instanceof CmsApiError) {
      return errorResponse(error.status, error.code, error.message, requestId);
    }

    console.error('[cms/proxy] the CMS API call failed', error);

    return errorResponse(503, 'unavailable', 'The website store is currently unavailable', requestId);
  }

  const body = result.body;
  const status = mapStatus(result.status);

  if (status === 200 || status === 201) {
    if (
      isRecord(body) &&
      (isWebsiteShape(body.website) ||
        (Array.isArray(body.websites) && body.websites.every(isWebsiteShape)) ||
        body.ok === true)
    ) {
      return successResponse(status, body, result.requestId);
    }

    console.error('[cms/proxy] the CMS API returned an unexpected payload', result.requestId);

    return errorResponse(502, 'invalid_response', 'The website store returned an unexpected answer', result.requestId);
  }

  if (isRecord(body) && typeof body.error === 'string' && typeof body.code === 'string') {
    return errorResponse(status, body.code, body.error, result.requestId);
  }

  return errorResponse(
    status === 500 ? 500 : 503,
    status === 500 ? 'unexpected' : 'unavailable',
    status === 500 ? 'The request could not be completed' : 'The website store is currently unavailable',
    result.requestId,
  );
}
