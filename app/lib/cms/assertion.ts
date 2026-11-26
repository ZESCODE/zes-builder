/**
 * Canonical signed tenant assertion — Phase 1C.1 service-to-service contract.
 *
 * The Vercel application is the only caller of the CMS Worker. It proves two
 * things with every request:
 *
 * 1. **Service identity** — a bearer token (`CMS_SERVICE_TOKEN`) that only the
 *    Vercel deployment holds. It authenticates the *caller*, not the tenant.
 * 2. **Tenant identity** — an HMAC-SHA256 signature over the request itself
 *    (`CMS_ASSERTION_SECRET`). The signed payload binds the tenant principal
 *    to the exact method, path, body and moment of the request, so a captured
 *    assertion cannot be moved to another route, another body or another time.
 *
 * The two credentials are deliberately separate: compromising the assertion
 * secret does not authenticate a caller, and compromising the service token does
 * not let a caller forge a tenant.
 *
 * ## Canonical form
 *
 * The signed payload is the following nine lines, joined with `\n` and encoded
 * as UTF-8:
 *
 * ```
 * v1                     protocol version
 * <service>              service identity of the caller
 * <audience>             intended worker audience
 * <tenant>               canonical tenant principal
 * <METHOD>               upper-case HTTP method
 * <path>                 canonical request path (pathname only, no query)
 * <timestamp>            unix milliseconds, decimal
 * <nonce>                32 lower-case hex characters
 * <bodyHash>             lower-case hex SHA-256 of the raw request body
 * ```
 *
 * Every field is validated against a strict character set before it is signed
 * or verified, and no field may contain a line break, so the line structure can
 * never be forged by injecting a separator into a field value.
 *
 * The signature is `base64url(HMAC-SHA256(secret, canonical))` and is compared
 * in constant time.
 *
 * ## Signed method and path
 *
 * The signed method and path travel in their own headers (`x-zes-method`,
 * `x-zes-path`). The verifier rebuilds the canonical payload from those headers
 * and checks the signature against it, and only afterwards compares the signed
 * method and path with the request it actually received. A request that was
 * signed for another method or another path therefore fails with
 * `method_mismatch` or `path_mismatch` instead of an opaque signature error.
 *
 * ## Canonical path
 *
 * The canonical path is the request pathname only. A request that carries a
 * query string is rejected (`query_not_allowed`) instead of being canonicalised
 * in two different ways by the signer and the verifier. The signer builds the
 * path it is going to request and signs exactly that string; the verifier
 * derives the path from the URL it received.
 *
 * ## Body hash
 *
 * The hash covers the raw request body bytes. An empty body hashes to the
 * SHA-256 of the empty string, so a body-less request is still bound to the
 * signature.
 *
 * ## Failure behaviour
 *
 * Verification returns a structured failure with a stable machine-readable code.
 * The caller (the Worker) maps every failure to `401` and never reveals which
 * part of the assertion was wrong to an unauthenticated caller beyond the code
 * itself.
 *
 * This module is deliberately free of Node and React Router imports: the same
 * code runs in the Vercel Node runtime and in the Cloudflare Worker runtime.
 */

export const ASSERTION_VERSION = 'v1';

/** Default identity of the calling service (the Vercel application). */
export const ASSERTION_SERVICE_ID = 'zes-builder-web';

/** Default audience of the assertion (the CMS Worker). */
export const ASSERTION_AUDIENCE = 'zes-cms-api';

export const ASSERTION_HEADER_SERVICE = 'x-zes-service';
export const ASSERTION_HEADER_AUDIENCE = 'x-zes-audience';
export const ASSERTION_HEADER_TENANT = 'x-zes-tenant';
export const ASSERTION_HEADER_METHOD = 'x-zes-method';
export const ASSERTION_HEADER_PATH = 'x-zes-path';
export const ASSERTION_HEADER_TIMESTAMP = 'x-zes-timestamp';
export const ASSERTION_HEADER_NONCE = 'x-zes-nonce';
export const ASSERTION_HEADER_BODY_HASH = 'x-zes-body-sha256';
export const ASSERTION_HEADER_SIGNATURE = 'x-zes-signature';
export const ASSERTION_HEADER_REQUEST_ID = 'x-zes-request-id';

/** Default validity window of an assertion, in milliseconds. */
export const ASSERTION_VALIDITY_WINDOW_MS = 30_000;

/** SHA-256 of the empty byte string, used for body-less requests. */
export const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const SERVICE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const TENANT_PATTERN = /^whop:[A-Za-z0-9._:@+-]{1,200}$/;
const METHOD_PATTERN = /^[A-Z]{1,16}$/;
const PATH_PATTERN = /^\/[A-Za-z0-9/_\-.:~%]*$/;
const TIMESTAMP_PATTERN = /^[0-9]{1,16}$/;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;
const BODY_HASH_PATTERN = /^[0-9a-f]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface AssertionFields {
  service: string;
  audience: string;
  tenant: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
}

export type AssertionFailureCode =
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

export interface AssertionFailure {
  ok: false;
  code: AssertionFailureCode;
  message: string;
}

export interface AssertionSuccess {
  ok: true;
  fields: AssertionFields;
}

export type AssertionResult = AssertionSuccess | AssertionFailure;

function encodeUtf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

/**
 * Copies the bytes into a buffer the Web Crypto API accepts.
 *
 * A `Uint8Array` may be backed by a `SharedArrayBuffer`, which is not a valid
 * `BufferSource`. The copy is small (a request body or a digest input), so the
 * guarantee is worth more than the allocation.
 */
function toCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);

  copy.set(bytes);

  return copy;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url encoding without `Buffer`, so the module runs in every runtime. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const byte0 = bytes[index] as number;
    const byte1 = bytes[index + 1];
    const byte2 = bytes[index + 2];
    const hasByte1 = byte1 !== undefined;
    const hasByte2 = byte2 !== undefined;

    out += BASE64_ALPHABET[byte0 >> 2];
    out += BASE64_ALPHABET[((byte0 & 0x03) << 4) | (hasByte1 ? byte1 >> 4 : 0)];
    out += hasByte1 ? BASE64_ALPHABET[((byte1 & 0x0f) << 2) | (hasByte2 ? byte2 >> 6 : 0)] : '';
    out += hasByte2 ? BASE64_ALPHABET[byte2 & 0x3f] : '';
  }

  return out;
}

/** Lower-case hex SHA-256 of the given bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toCryptoBytes(bytes));

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** HMAC-SHA256 of the given string, base64url encoded. */
export async function hmacBase64Url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encodeUtf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);

  const signature = await crypto.subtle.sign('HMAC', key, encodeUtf8(data));

  return base64UrlEncode(new Uint8Array(signature));
}

/**
 * Compares two strings without an early exit.
 *
 * The comparison always walks the longer of the two inputs and folds the length
 * difference into the accumulator, so the running time does not depend on where
 * the first difference is.
 */
export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encodeUtf8(left);
  const rightBytes = encodeUtf8(right);
  const length = Math.max(leftBytes.length, rightBytes.length);

  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

/** The nine-line canonical payload that is signed. */
export function canonicalizeAssertion(fields: AssertionFields): string {
  return [
    ASSERTION_VERSION,
    fields.service,
    fields.audience,
    fields.tenant,
    fields.method,
    fields.path,
    fields.timestamp,
    fields.nonce,
    fields.bodyHash,
  ].join('\n');
}

/** True when every field matches its character set. */
export function isValidAssertionFields(fields: AssertionFields): boolean {
  return (
    SERVICE_PATTERN.test(fields.service) &&
    SERVICE_PATTERN.test(fields.audience) &&
    TENANT_PATTERN.test(fields.tenant) &&
    METHOD_PATTERN.test(fields.method) &&
    PATH_PATTERN.test(fields.path) &&
    TIMESTAMP_PATTERN.test(fields.timestamp) &&
    NONCE_PATTERN.test(fields.nonce) &&
    BODY_HASH_PATTERN.test(fields.bodyHash)
  );
}

/** The canonical path of a URL, or null when the URL carries a query string. */
export function canonicalPathFromUrl(url: string): string | null {
  const parsed = new URL(url);

  if (parsed.search) {
    return null;
  }

  return parsed.pathname;
}

/** Builds a random nonce as 32 lower-case hex characters. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Signs the fields with the assertion secret. */
export async function signAssertion(fields: AssertionFields, secret: string): Promise<string> {
  return hmacBase64Url(secret, canonicalizeAssertion(fields));
}

export interface VerifyAssertionOptions {
  secret: string;
  expectedService: string;
  expectedAudience: string;
  method: string;
  path: string;
  body: Uint8Array;
  headers: Headers;
  now?: number;
  validityWindowMs?: number;
}

/**
 * Verifies a signed tenant assertion.
 *
 * The signature is checked first: until the HMAC matches, nothing in the
 * request is trusted. Only then are the bound fields compared with what the
 * Worker expected.
 */
export async function verifyAssertion(options: VerifyAssertionOptions): Promise<AssertionResult> {
  const headers = options.headers;
  const service = headers.get(ASSERTION_HEADER_SERVICE) ?? '';
  const audience = headers.get(ASSERTION_HEADER_AUDIENCE) ?? '';
  const tenant = headers.get(ASSERTION_HEADER_TENANT) ?? '';
  const method = headers.get(ASSERTION_HEADER_METHOD) ?? '';
  const path = headers.get(ASSERTION_HEADER_PATH) ?? '';
  const timestamp = headers.get(ASSERTION_HEADER_TIMESTAMP) ?? '';
  const nonce = headers.get(ASSERTION_HEADER_NONCE) ?? '';
  const bodyHash = headers.get(ASSERTION_HEADER_BODY_HASH) ?? '';
  const signature = headers.get(ASSERTION_HEADER_SIGNATURE) ?? '';

  if (!service || !audience || !tenant || !method || !path || !timestamp || !bodyHash || !signature) {
    return { ok: false, code: 'missing_assertion', message: 'The request is missing its tenant assertion' };
  }

  if (!nonce) {
    return { ok: false, code: 'missing_nonce', message: 'The request is missing its assertion nonce' };
  }

  if (!SIGNATURE_PATTERN.test(signature)) {
    return { ok: false, code: 'invalid_assertion', message: 'The request assertion is malformed' };
  }

  const fields: AssertionFields = {
    service,
    audience,
    tenant,
    method,
    path,
    timestamp,
    nonce,
    bodyHash,
  };

  if (!isValidAssertionFields(fields)) {
    return { ok: false, code: 'invalid_assertion', message: 'The request assertion is malformed' };
  }

  const expectedSignature = await signAssertion(fields, options.secret);

  if (!constantTimeEqual(expectedSignature, signature)) {
    return { ok: false, code: 'invalid_signature', message: 'The request assertion signature is invalid' };
  }

  if (fields.audience !== options.expectedAudience) {
    return { ok: false, code: 'audience_mismatch', message: 'The request assertion targets another audience' };
  }

  if (fields.service !== options.expectedService) {
    return { ok: false, code: 'service_mismatch', message: 'The request assertion was issued by another service' };
  }

  if (fields.method !== options.method.toUpperCase()) {
    return { ok: false, code: 'method_mismatch', message: 'The request assertion was issued for another method' };
  }

  if (fields.path !== options.path) {
    return { ok: false, code: 'path_mismatch', message: 'The request assertion was issued for another path' };
  }

  const actualBodyHash = await sha256Hex(options.body);

  if (!constantTimeEqual(actualBodyHash, fields.bodyHash)) {
    return { ok: false, code: 'body_mismatch', message: 'The request body does not match the signed assertion' };
  }

  const issuedAt = Number(fields.timestamp);

  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) {
    return { ok: false, code: 'invalid_timestamp', message: 'The request assertion has an invalid timestamp' };
  }

  const now = options.now ?? Date.now();
  const window = options.validityWindowMs ?? ASSERTION_VALIDITY_WINDOW_MS;
  const skew = now - issuedAt;

  if (skew > window || -skew > window) {
    return { ok: false, code: 'expired_assertion', message: 'The request assertion is outside the validity window' };
  }

  return { ok: true, fields };
}
