/**
 * Helper that builds signed requests for the CMS API Worker.
 *
 * The tests never bypass the authentication of the Worker: every request that
 * is supposed to reach the storage layer is signed with the assertion secret
 * of the test environment.
 */

import type { D1Shim } from './d1-sqlite';
import {
  ASSERTION_AUDIENCE,
  ASSERTION_HEADER_AUDIENCE,
  ASSERTION_HEADER_BODY_HASH,
  ASSERTION_HEADER_METHOD,
  ASSERTION_HEADER_NONCE,
  ASSERTION_HEADER_PATH,
  ASSERTION_HEADER_SERVICE,
  ASSERTION_HEADER_SIGNATURE,
  ASSERTION_HEADER_TENANT,
  ASSERTION_HEADER_TIMESTAMP,
  ASSERTION_SERVICE_ID,
  createNonce,
  sha256Hex,
  signAssertion,
} from '~/lib/cms/assertion';

export const SERVICE_TOKEN = 'service-token-for-tests';
export const ASSERTION_SECRET = 'assertion-secret-for-tests';

export const executionContext = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

export interface SignedRequestOptions {
  method?: string;
  path?: string;
  body?: string;
  tenant?: string;
  token?: string;
  secret?: string;
  nonce?: string;
  timestamp?: string;
  signature?: string;
  extraHeaders?: Record<string, string>;
  omitAssertion?: boolean;
}

/** Builds a request that carries a valid signed tenant assertion. */
export async function createSignedRequest(options: SignedRequestOptions = {}): Promise<Request> {
  const method = options.method ?? 'GET';
  const path = options.path ?? '/api/websites';
  const body = options.body ?? '';
  const tenant = options.tenant ?? 'whop:user-a';
  const nonce = options.nonce ?? createNonce();
  const timestamp = options.timestamp ?? String(Date.now());

  const fields = {
    service: ASSERTION_SERVICE_ID,
    audience: ASSERTION_AUDIENCE,
    tenant,
    method,
    path,
    timestamp,
    nonce,
    bodyHash: await sha256Hex(new TextEncoder().encode(body)),
  };

  const headers = new Headers({
    authorization: `Bearer ${options.token ?? SERVICE_TOKEN}`,
    ...(options.extraHeaders ?? {}),
  });

  if (!options.omitAssertion) {
    headers.set(ASSERTION_HEADER_SERVICE, fields.service);
    headers.set(ASSERTION_HEADER_AUDIENCE, fields.audience);
    headers.set(ASSERTION_HEADER_TENANT, fields.tenant);
    headers.set(ASSERTION_HEADER_METHOD, fields.method);
    headers.set(ASSERTION_HEADER_PATH, fields.path);
    headers.set(ASSERTION_HEADER_TIMESTAMP, fields.timestamp);
    headers.set(ASSERTION_HEADER_NONCE, fields.nonce);
    headers.set(ASSERTION_HEADER_BODY_HASH, fields.bodyHash);
    headers.set(
      ASSERTION_HEADER_SIGNATURE,
      options.signature ?? (await signAssertion(fields, options.secret ?? ASSERTION_SECRET)),
    );
  }

  return new Request(`https://cms.test${path}`, {
    method,
    headers,
    ...(body ? { body } : {}),
  });
}

/** The environment of the Worker for a test. */
export function workerEnvironment(shim: D1Shim | null): Record<string, unknown> {
  return {
    DB: shim?.db,
    STORAGE_BACKEND: 'd1',
    CMS_SERVICE_TOKEN: SERVICE_TOKEN,
    CMS_ASSERTION_SECRET: ASSERTION_SECRET,
    CMS_SERVICE_ID: ASSERTION_SERVICE_ID,
    CMS_ASSERTION_AUDIENCE: ASSERTION_AUDIENCE,
  };
}
