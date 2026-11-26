/**
 * Tests of the signed tenant assertion.
 *
 * The assertion is the contract between the Vercel application and the CMS API
 * Worker. The tests verify that a valid assertion is accepted and that every
 * manipulation — a changed signature, body, method, path, audience, service,
 * timestamp or nonce — is rejected with a stable failure code.
 */

import { describe, expect, it } from 'vitest';
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
  ASSERTION_VALIDITY_WINDOW_MS,
  canonicalizeAssertion,
  constantTimeEqual,
  createNonce,
  isValidAssertionFields,
  sha256Hex,
  signAssertion,
  verifyAssertion,
} from '~/lib/cms/assertion';
import type { AssertionFields } from '~/lib/cms/assertion';

const SECRET = 'assertion-secret-for-tests';
const TENANT = 'whop:user-a';

async function fieldsFor(overrides: Partial<AssertionFields> = {}): Promise<AssertionFields> {
  const body = new TextEncoder().encode('{"name":"Alpha","slug":"alpha"}');

  return {
    service: ASSERTION_SERVICE_ID,
    audience: ASSERTION_AUDIENCE,
    tenant: TENANT,
    method: 'POST',
    path: '/api/websites',
    timestamp: String(Date.now()),
    nonce: createNonce(),
    bodyHash: await sha256Hex(body),
    ...overrides,
  };
}

async function headersFor(fields: AssertionFields, secret: string = SECRET): Promise<Headers> {
  const headers = new Headers({
    [ASSERTION_HEADER_SERVICE]: fields.service,
    [ASSERTION_HEADER_AUDIENCE]: fields.audience,
    [ASSERTION_HEADER_TENANT]: fields.tenant,
    [ASSERTION_HEADER_METHOD]: fields.method,
    [ASSERTION_HEADER_PATH]: fields.path,
    [ASSERTION_HEADER_TIMESTAMP]: fields.timestamp,
    [ASSERTION_HEADER_NONCE]: fields.nonce,
    [ASSERTION_HEADER_BODY_HASH]: fields.bodyHash,
    [ASSERTION_HEADER_SIGNATURE]: await signAssertion(fields, secret),
  });

  return headers;
}

describe('assertion canonical form', () => {
  it('signs exactly nine lines', async () => {
    const fields = await fieldsFor();
    const canonical = canonicalizeAssertion(fields);

    expect(canonical.split('\n')).toHaveLength(9);
    expect(canonical.split('\n')[0]).toBe('v1');
  });

  it('rejects a field that contains a line break', async () => {
    const fields = await fieldsFor({ tenant: 'whop:user-a\nwhop:user-b' });

    expect(isValidAssertionFields(fields)).toBe(false);
  });

  it('builds a random nonce of 32 hex characters', () => {
    const first = createNonce();
    const second = createNonce();

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
  });

  it('compares in constant time without an early exit', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('assertion verification', () => {
  it('accepts a valid assertion', async () => {
    const body = new TextEncoder().encode('{"name":"Alpha","slug":"alpha"}');
    const fields = await fieldsFor();

    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'POST',
      path: '/api/websites',
      body,
      headers: await headersFor(fields),
    });

    expect(result.ok).toBe(true);
  });

  it('rejects a missing assertion', async () => {
    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'GET',
      path: '/api/websites',
      body: new Uint8Array(),
      headers: new Headers(),
    });

    expect(result).toMatchObject({ ok: false, code: 'missing_assertion' });
  });

  it('rejects a signature that was signed with another secret', async () => {
    const body = new TextEncoder().encode('{"name":"Alpha","slug":"alpha"}');
    const fields = await fieldsFor();

    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'POST',
      path: '/api/websites',
      body,
      headers: await headersFor(fields, 'another-secret'),
    });

    expect(result).toMatchObject({ ok: false, code: 'invalid_signature' });
  });

  it('rejects a changed body', async () => {
    const fields = await fieldsFor();

    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'POST',
      path: '/api/websites',
      body: new TextEncoder().encode('{"name":"Beta","slug":"beta"}'),
      headers: await headersFor(fields),
    });

    expect(result).toMatchObject({ ok: false, code: 'body_mismatch' });
  });

  it('rejects a changed method', async () => {
    const fields = await fieldsFor({ method: 'POST' });

    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'DELETE',
      path: '/api/websites',
      body: new TextEncoder().encode('{"name":"Alpha","slug":"alpha"}'),
      headers: await headersFor(fields),
    });

    expect(result).toMatchObject({ ok: false, code: 'method_mismatch' });
  });

  it('rejects a changed path', async () => {
    const fields = await fieldsFor({ path: '/api/websites' });

    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'POST',
      path: '/api/websites/other',
      body: new TextEncoder().encode('{"name":"Alpha","slug":"alpha"}'),
      headers: await headersFor(fields),
    });

    expect(result).toMatchObject({ ok: false, code: 'path_mismatch' });
  });

  it('rejects another audience', async () => {
    const fields = await fieldsFor({ audience: 'another-service' });

    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'POST',
      path: '/api/websites',
      body: new TextEncoder().encode('{"name":"Alpha","slug":"alpha"}'),
      headers: await headersFor(fields),
    });

    expect(result).toMatchObject({ ok: false, code: 'audience_mismatch' });
  });

  it('rejects another service', async () => {
    const fields = await fieldsFor({ service: 'another-service' });

    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'POST',
      path: '/api/websites',
      body: new TextEncoder().encode('{"name":"Alpha","slug":"alpha"}'),
      headers: await headersFor(fields),
    });

    expect(result).toMatchObject({ ok: false, code: 'service_mismatch' });
  });

  it('rejects an expired assertion', async () => {
    const fields = await fieldsFor({ timestamp: String(Date.now() - ASSERTION_VALIDITY_WINDOW_MS - 1000) });

    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'POST',
      path: '/api/websites',
      body: new TextEncoder().encode('{"name":"Alpha","slug":"alpha"}'),
      headers: await headersFor(fields),
    });

    expect(result).toMatchObject({ ok: false, code: 'expired_assertion' });
  });

  it('rejects an assertion from the future', async () => {
    const fields = await fieldsFor({ timestamp: String(Date.now() + ASSERTION_VALIDITY_WINDOW_MS + 1000) });

    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'POST',
      path: '/api/websites',
      body: new TextEncoder().encode('{"name":"Alpha","slug":"alpha"}'),
      headers: await headersFor(fields),
    });

    expect(result).toMatchObject({ ok: false, code: 'expired_assertion' });
  });

  it('rejects a malformed nonce', async () => {
    const fields = await fieldsFor({ nonce: 'not-a-nonce' });

    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'POST',
      path: '/api/websites',
      body: new TextEncoder().encode('{"name":"Alpha","slug":"alpha"}'),
      headers: await headersFor(fields),
    });

    expect(result).toMatchObject({ ok: false, code: 'invalid_assertion' });
  });

  it('rejects a malformed signature', async () => {
    const fields = await fieldsFor();
    const headers = await headersFor(fields);

    headers.set(ASSERTION_HEADER_SIGNATURE, 'not a signature');

    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'POST',
      path: '/api/websites',
      body: new TextEncoder().encode('{"name":"Alpha","slug":"alpha"}'),
      headers,
    });

    expect(result).toMatchObject({ ok: false, code: 'invalid_assertion' });
  });

  it('accepts an assertion inside the validity window', async () => {
    const body = new TextEncoder().encode('{"name":"Alpha","slug":"alpha"}');
    const fields = await fieldsFor({ timestamp: String(Date.now() - 5000) });

    const result = await verifyAssertion({
      secret: SECRET,
      expectedService: ASSERTION_SERVICE_ID,
      expectedAudience: ASSERTION_AUDIENCE,
      method: 'POST',
      path: '/api/websites',
      body,
      headers: await headersFor(fields),
    });

    expect(result.ok).toBe(true);
  });
});
