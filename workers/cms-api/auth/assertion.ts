/**
 * Service authentication and tenant assertion verification.
 *
 * Two independent checks run before any storage call:
 *
 * 1. **Service authentication** — the `Authorization: Bearer <token>` header must
 *    match the Worker's `CMS_SERVICE_TOKEN`, compared in constant time. This
 *    proves the caller is the Vercel application.
 * 2. **Tenant assertion** — the HMAC-SHA256 signature over the method, path,
 *    body, timestamp and nonce must verify against `CMS_ASSERTION_SECRET`, and
 *    the bound fields must match the request the Worker actually received.
 *
 * The tenant that the Worker uses is the one inside the *verified* assertion.
 * A tenant header that arrives without a valid signature is never read.
 */

import type { CmsApiEnv } from '../env.ts';
import {
  ASSERTION_AUDIENCE,
  ASSERTION_SERVICE_ID,
  ASSERTION_VALIDITY_WINDOW_MS,
  constantTimeEqual,
  verifyAssertion,
} from '~/lib/cms/assertion';

export type AuthenticationFailureCode =
  | 'service_unauthorized'
  | 'missing_assertion'
  | 'invalid_assertion'
  | 'invalid_signature'
  | 'audience_mismatch'
  | 'service_mismatch'
  | 'method_mismatch'
  | 'path_mismatch'
  | 'body_mismatch'
  | 'invalid_timestamp'
  | 'expired_assertion'
  | 'missing_nonce'
  | 'invalid_nonce'
  | 'query_not_allowed';

export interface AuthenticationSuccess {
  ok: true;
  tenant: string;
  nonce: string;
  timestamp: string;
}

export interface AuthenticationFailure {
  ok: false;
  code: AuthenticationFailureCode;
  message: string;
}

export type AuthenticationResult = AuthenticationSuccess | AuthenticationFailure;

/** True when the bearer token matches the configured service token. */
export function isAuthorizedService(request: Request, env: CmsApiEnv): boolean {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);

  if (!match) {
    return false;
  }

  const expected = env.CMS_SERVICE_TOKEN ?? '';

  if (!expected) {
    return false;
  }

  return constantTimeEqual(match[1] as string, expected);
}

/** The validity window configured for the deployment. */
export function validityWindowMs(env: CmsApiEnv): number {
  const configured = Number(env.CMS_ASSERTION_WINDOW_MS ?? '');

  if (Number.isSafeInteger(configured) && configured > 0) {
    return configured;
  }

  return ASSERTION_VALIDITY_WINDOW_MS;
}

/**
 * Authenticates the caller and verifies the tenant assertion.
 *
 * The request body must already have been read, because its hash is part of
 * the signed payload.
 */
export async function authenticateRequest(
  request: Request,
  env: CmsApiEnv,
  body: Uint8Array,
  path: string,
): Promise<AuthenticationResult> {
  if (!isAuthorizedService(request, env)) {
    return { ok: false, code: 'service_unauthorized', message: 'The service credentials are missing or invalid' };
  }

  const result = await verifyAssertion({
    secret: env.CMS_ASSERTION_SECRET ?? '',
    expectedService: env.CMS_SERVICE_ID || ASSERTION_SERVICE_ID,
    expectedAudience: env.CMS_ASSERTION_AUDIENCE || ASSERTION_AUDIENCE,
    method: request.method,
    path,
    body,
    headers: request.headers,
    validityWindowMs: validityWindowMs(env),
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    tenant: result.fields.tenant,
    nonce: result.fields.nonce,
    timestamp: result.fields.timestamp,
  };
}
