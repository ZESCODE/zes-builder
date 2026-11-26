/**
 * Client for the CMS API Worker — Phase 1C.3.
 *
 * The Vercel application is the only caller of the Worker. This module turns a
 * request into a signed, authenticated call:
 *
 * 1. The body hash, the timestamp and a fresh nonce are computed.
 * 2. The canonical nine-line payload is signed with the assertion secret.
 * 3. The request is sent with the bearer token of the service and the
 *    assertion headers.
 *
 * The module never sees a browser request: it is server-only by design, the
 * credentials it uses are read from the server environment and it is only
 * imported by the route modules of the application server.
 */

import {
  ASSERTION_AUDIENCE,
  ASSERTION_HEADER_AUDIENCE,
  ASSERTION_HEADER_BODY_HASH,
  ASSERTION_HEADER_METHOD,
  ASSERTION_HEADER_NONCE,
  ASSERTION_HEADER_PATH,
  ASSERTION_HEADER_REQUEST_ID,
  ASSERTION_HEADER_SERVICE,
  ASSERTION_HEADER_SIGNATURE,
  ASSERTION_HEADER_TENANT,
  ASSERTION_HEADER_TIMESTAMP,
  ASSERTION_SERVICE_ID,
  createNonce,
  sha256Hex,
  signAssertion,
} from '~/lib/cms/assertion';

export interface CmsApiConfig {
  baseUrl: string;
  serviceToken: string;
  assertionSecret: string;
  serviceId: string;
  audience: string;
}

export class CmsApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'CmsApiError';
    this.code = code;
    this.status = status;
  }
}

const METHOD_PATTERN = /^[A-Z]{1,16}$/;

/**
 * Reads the CMS API configuration from the server environment.
 *
 * Returns null when the deployment is not configured; the caller then answers
 * with `503` instead of talking to an unconfigured endpoint. The configuration
 * is only ever read from the server environment — the values are never exposed
 * to the browser.
 */
export function readCmsApiConfig(env: NodeJS.ProcessEnv = process.env): CmsApiConfig | null {
  const baseUrl = env.CMS_API_URL?.trim();
  const serviceToken = env.CMS_SERVICE_TOKEN?.trim();
  const assertionSecret = env.CMS_ASSERTION_SECRET?.trim();

  if (!baseUrl || !serviceToken || !assertionSecret) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }

  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

  if (parsed.protocol !== 'https:' && !isLoopback) {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    serviceToken,
    assertionSecret,
    serviceId: env.CMS_SERVICE_ID?.trim() || ASSERTION_SERVICE_ID,
    audience: env.CMS_ASSERTION_AUDIENCE?.trim() || ASSERTION_AUDIENCE,
  };
}

export interface CmsApiRequest {
  config: CmsApiConfig;
  tenant: string;
  method: string;
  path: string;
  body?: string;
  requestId: string;
}

export interface CmsApiResponse {
  status: number;
  body: unknown;
  requestId: string;
}

/**
 * Calls the CMS API Worker with a signed tenant assertion.
 *
 * Throws {@link CmsApiError} when the call itself fails (no route, wrong
 * configuration). A response of the Worker — including an error response — is
 * returned to the caller and mapped there.
 */
export async function callCmsApi(request: CmsApiRequest): Promise<CmsApiResponse> {
  const method = request.method.toUpperCase();

  if (!METHOD_PATTERN.test(method)) {
    throw new CmsApiError('invalid_request', 'The request method is not supported', 400);
  }

  if (!request.path.startsWith('/') || request.path.includes('?') || request.path.includes('#')) {
    throw new CmsApiError('invalid_request', 'The request path is not supported', 400);
  }

  const bodyBytes = new TextEncoder().encode(request.body ?? '');
  const bodyHash = await sha256Hex(bodyBytes);
  const timestamp = String(Date.now());
  const nonce = createNonce();

  const signature = await signAssertion(
    {
      service: request.config.serviceId,
      audience: request.config.audience,
      tenant: request.tenant,
      method,
      path: request.path,
      timestamp,
      nonce,
      bodyHash,
    },
    request.config.assertionSecret,
  );

  const headers = new Headers({
    authorization: `Bearer ${request.config.serviceToken}`,
    [ASSERTION_HEADER_SERVICE]: request.config.serviceId,
    [ASSERTION_HEADER_AUDIENCE]: request.config.audience,
    [ASSERTION_HEADER_TENANT]: request.tenant,
    [ASSERTION_HEADER_METHOD]: method,
    [ASSERTION_HEADER_PATH]: request.path,
    [ASSERTION_HEADER_TIMESTAMP]: timestamp,
    [ASSERTION_HEADER_NONCE]: nonce,
    [ASSERTION_HEADER_BODY_HASH]: bodyHash,
    [ASSERTION_HEADER_SIGNATURE]: signature,
    [ASSERTION_HEADER_REQUEST_ID]: request.requestId,
  });

  const hasBody = method !== 'GET' && method !== 'HEAD';

  if (hasBody) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;

  try {
    response = await fetch(`${request.config.baseUrl}${request.path}`, {
      method,
      headers,
      ...(hasBody ? { body: bodyBytes } : {}),
    });
  } catch {
    throw new CmsApiError('unavailable', 'The CMS API could not be reached', 503);
  }

  const text = await response.text();

  let body: unknown = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  return {
    status: response.status,
    body,
    requestId: response.headers.get(ASSERTION_HEADER_REQUEST_ID) ?? request.requestId,
  };
}
