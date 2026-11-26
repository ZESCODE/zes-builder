/**
 * Tests of the CMS API Worker.
 *
 * The Worker runs against the `node:sqlite` D1 shim, so the tests exercise the
 * real request flow: service authentication, the signed tenant assertion, the
 * durable replay protection, the tenant scoping of the storage layer and the
 * error contract.
 *
 * The tests never bypass the authentication: every request that reaches the
 * storage layer is signed with the assertion secret of the environment.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSignedRequest, executionContext, workerEnvironment } from './helpers/cms-request';
import { applyMigrations, createD1Shim } from './helpers/d1-sqlite';
import type { D1Shim } from './helpers/d1-sqlite';
import { createNonce } from '~/lib/cms/assertion';

const { default: worker } = await import('../../workers/cms-api/index');

const TENANT_A = 'whop:user-a';
const TENANT_B = 'whop:user-b';

async function callWorker(request: Request, shim: D1Shim | null): Promise<Response> {
  return worker.fetch(request as never, workerEnvironment(shim) as never, executionContext);
}

describe('CMS API Worker authentication', () => {
  let shim: D1Shim;

  beforeEach(() => {
    shim = createD1Shim();
    applyMigrations(shim.sqlite);
  });

  afterEach(() => {
    shim.close();
  });

  it('answers the health probe without authentication', async () => {
    const response = await callWorker(new Request('https://cms.test/api/health'), shim);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as { status: string };

    expect(payload.status).toBe('ok');
  });

  it('reports an unavailable database on the health probe', async () => {
    const response = await callWorker(new Request('https://cms.test/api/health'), null);

    expect(response.status).toBe(503);
  });

  it('rejects a request without a service token', async () => {
    const response = await callWorker(await createSignedRequest({ token: 'wrong-token' }), shim);

    expect(response.status).toBe(401);

    const payload = (await response.json()) as { code: string };

    expect(payload.code).toBe('service_unauthorized');
  });

  it('rejects a request without an assertion', async () => {
    const response = await callWorker(await createSignedRequest({ omitAssertion: true }), shim);

    expect(response.status).toBe(401);

    const payload = (await response.json()) as { code: string };

    expect(payload.code).toBe('missing_assertion');
  });

  it('rejects a request with an invalid signature', async () => {
    const response = await callWorker(await createSignedRequest({ secret: 'another-secret' }), shim);

    expect(response.status).toBe(401);

    const payload = (await response.json()) as { code: string };

    expect(payload.code).toBe('invalid_signature');
  });

  it('rejects a replayed assertion', async () => {
    const nonce = createNonce();
    const request = await createSignedRequest({ nonce });

    const first = await callWorker(request.clone() as never, shim);
    const second = await callWorker(request.clone() as never, shim);

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);

    const payload = (await second.json()) as { code: string };

    expect(payload.code).toBe('replayed_nonce');
  });

  it('records the nonce of every accepted request', async () => {
    await callWorker(await createSignedRequest(), shim);

    const rows = shim.sqlite.prepare('SELECT COUNT(*) AS count FROM cms_assertion_nonces').get() as { count: number };

    expect(Number(rows.count)).toBe(1);
  });

  it('fails closed when the database binding is missing', async () => {
    const response = await callWorker(await createSignedRequest(), null);

    expect(response.status).toBe(503);
  });

  it('rejects a request with a query string', async () => {
    const response = await callWorker(await createSignedRequest({ path: '/api/websites?limit=10' }), shim);

    expect(response.status).toBe(400);

    const payload = (await response.json()) as { code: string };

    expect(payload.code).toBe('query_not_allowed');
  });

  it('answers an unknown path with 404', async () => {
    const response = await callWorker(await createSignedRequest({ path: '/api/unknown' }), shim);

    expect(response.status).toBe(404);
  });
});

describe('CMS API Worker website API', () => {
  let shim: D1Shim;

  beforeEach(() => {
    shim = createD1Shim();
    applyMigrations(shim.sqlite);
  });

  afterEach(() => {
    shim.close();
  });

  async function createWebsite(tenant: string, name: string, slug: string): Promise<Response> {
    const body = JSON.stringify({ name, slug });

    return callWorker(await createSignedRequest({ method: 'POST', path: '/api/websites', body, tenant }), shim);
  }

  it('creates a website for the tenant of the assertion', async () => {
    const response = await createWebsite(TENANT_A, 'Alpha', 'alpha');

    expect(response.status).toBe(201);

    const payload = (await response.json()) as { website: { userId: string; slug: string } };

    expect(payload.website.userId).toBe(TENANT_A);
    expect(payload.website.slug).toBe('alpha');
  });

  it('lists only the websites of the tenant', async () => {
    await createWebsite(TENANT_A, 'Alpha', 'alpha');
    await createWebsite(TENANT_B, 'Beta', 'beta');

    const response = await callWorker(await createSignedRequest({ tenant: TENANT_A }), shim);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as { websites: Array<{ name: string; userId: string }> };

    expect(payload.websites).toHaveLength(1);
    expect(payload.websites[0]).toMatchObject({ name: 'Alpha', userId: TENANT_A });
  });

  it('hides the website of another tenant behind a 404', async () => {
    const created = await createWebsite(TENANT_A, 'Alpha', 'alpha');
    const payload = (await created.json()) as { website: { id: string } };
    const path = `/api/websites/${payload.website.id}`;

    const read = await callWorker(await createSignedRequest({ path, tenant: TENANT_B }), shim);

    const removed = await callWorker(await createSignedRequest({ method: 'DELETE', path, tenant: TENANT_B }), shim);

    expect(read.status).toBe(404);
    expect(removed.status).toBe(404);
  });

  it('reports a duplicate slug as a conflict without leaking database details', async () => {
    await createWebsite(TENANT_A, 'Alpha', 'alpha');

    const response = await createWebsite(TENANT_A, 'Alpha again', 'alpha');

    expect(response.status).toBe(409);

    const payload = (await response.json()) as { code: string; error: string };

    expect(payload.code).toBe('duplicate_slug');
    expect(payload.error).not.toMatch(/SELECT|INSERT|UNIQUE constraint/i);
  });

  it('rejects a payload that carries a tenant', async () => {
    const body = JSON.stringify({ name: 'Alpha', slug: 'alpha', userId: TENANT_B });

    const response = await callWorker(await createSignedRequest({ method: 'POST', path: '/api/websites', body }), shim);

    expect(response.status).toBe(400);
  });

  it('rejects a malformed payload', async () => {
    const body = JSON.stringify({ slug: 'alpha' });

    const response = await callWorker(await createSignedRequest({ method: 'POST', path: '/api/websites', body }), shim);

    expect(response.status).toBe(400);
  });

  it('updates a website of the tenant', async () => {
    const created = await createWebsite(TENANT_A, 'Alpha', 'alpha');
    const payload = (await created.json()) as { website: { id: string } };
    const body = JSON.stringify({ name: 'Alpha renamed' });

    const response = await callWorker(
      await createSignedRequest({
        method: 'PATCH',
        path: `/api/websites/${payload.website.id}`,
        body,
      }),
      shim,
    );

    expect(response.status).toBe(200);

    const updated = (await response.json()) as { website: { name: string } };

    expect(updated.website.name).toBe('Alpha renamed');
  });

  it('soft-deletes a website and hides it afterwards', async () => {
    const created = await createWebsite(TENANT_A, 'Alpha', 'alpha');
    const payload = (await created.json()) as { website: { id: string } };
    const path = `/api/websites/${payload.website.id}`;

    const removed = await callWorker(await createSignedRequest({ method: 'DELETE', path }), shim);
    const read = await callWorker(await createSignedRequest({ path }), shim);

    expect(removed.status).toBe(200);
    expect(read.status).toBe(404);
  });

  it('rejects an unsupported method', async () => {
    const response = await callWorker(await createSignedRequest({ method: 'PUT', path: '/api/websites' }), shim);

    expect(response.status).toBe(405);
  });

  it('answers every response with a request id', async () => {
    const response = await callWorker(await createSignedRequest(), shim);

    expect(response.headers.get('x-zes-request-id')).toBeTruthy();
  });
});
