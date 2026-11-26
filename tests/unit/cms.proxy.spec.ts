/**
 * Tests of the server-side proxy to the CMS API Worker.
 *
 * The proxy is the only path from the browser to the database. The tests verify
 * that it authenticates the caller, derives the tenant from the session alone,
 * blocks cross-site mutations, signs every request, hides the credentials and
 * never leaks an internal error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASSERTION_HEADER_METHOD,
  ASSERTION_HEADER_PATH,
  ASSERTION_HEADER_SIGNATURE,
  ASSERTION_HEADER_TENANT,
} from '~/lib/cms/assertion';
import { CMS_MUTATION_HEADER } from '~/lib/cms/proxy.server';

const mockRequireAccess = vi.hoisted(() => vi.fn<() => Promise<Response | null>>(async () => null));

const mockReadSession = vi.hoisted(() =>
  vi.fn<() => Promise<{ userId: string; username?: string; name?: string } | null>>(async () => ({
    userId: 'user-a',
  })),
);

vi.mock('~/lib/whop.server', () => ({
  requireAccess: mockRequireAccess,
  readSession: mockReadSession,
}));

const { proxyToCmsApi } = await import('~/lib/cms/proxy.server');

const SERVICE_TOKEN = 'service-token-for-tests';
const ASSERTION_SECRET = 'assertion-secret-for-tests';
const CMS_API_URL = 'https://cms.test';

interface OutgoingCall {
  url: string;
  init: RequestInit;
}

function stubWorker(response: Response | (() => Response | Promise<Response>)): OutgoingCall[] {
  const calls: OutgoingCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });

      return typeof response === 'function' ? response() : response.clone();
    }),
  );

  return calls;
}

function workerResponse(body: unknown, status: number, requestId = 'request-id-from-worker'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-zes-request-id': requestId },
  });
}

function browserRequest(options: { method?: string; body?: string; headers?: Record<string, string> } = {}): Request {
  const headers = new Headers({
    origin: 'https://app.zes.codes',
    ...(options.headers ?? {}),
  });

  return new Request('https://app.zes.codes/api/websites', {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

describe('CMS API proxy', () => {
  beforeEach(() => {
    process.env.CMS_API_URL = CMS_API_URL;
    process.env.CMS_SERVICE_TOKEN = SERVICE_TOKEN;
    process.env.CMS_ASSERTION_SECRET = ASSERTION_SECRET;
    mockRequireAccess.mockResolvedValue(null);
    mockReadSession.mockResolvedValue({ userId: 'user-a' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CMS_API_URL;
    delete process.env.CMS_SERVICE_TOKEN;
    delete process.env.CMS_ASSERTION_SECRET;
  });

  it('requires a session', async () => {
    mockReadSession.mockResolvedValue(null);

    const calls = stubWorker(workerResponse({ websites: [] }, 200));

    const response = await proxyToCmsApi({ request: browserRequest(), method: 'GET', path: '/api/websites' });

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('forwards a signed request with the tenant of the session', async () => {
    const calls = stubWorker(workerResponse({ websites: [] }, 200));

    const response = await proxyToCmsApi({ request: browserRequest(), method: 'GET', path: '/api/websites' });

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);

    const headers = new Headers(calls[0]?.init.headers);

    expect(calls[0]?.url).toBe(`${CMS_API_URL}/api/websites`);
    expect(headers.get('authorization')).toBe(`Bearer ${SERVICE_TOKEN}`);
    expect(headers.get(ASSERTION_HEADER_TENANT)).toBe('whop:user-a');
    expect(headers.get(ASSERTION_HEADER_METHOD)).toBe('GET');
    expect(headers.get(ASSERTION_HEADER_PATH)).toBe('/api/websites');
    expect(headers.get(ASSERTION_HEADER_SIGNATURE)).toBeTruthy();
  });

  it('keeps the case of the account identifier', async () => {
    mockReadSession.mockResolvedValue({ userId: 'UserA' });

    const calls = stubWorker(workerResponse({ websites: [] }, 200));

    await proxyToCmsApi({ request: browserRequest(), method: 'GET', path: '/api/websites' });

    const headers = new Headers(calls[0]?.init.headers);

    expect(headers.get(ASSERTION_HEADER_TENANT)).toBe('whop:UserA');
  });

  it('ignores a tenant supplied by the browser', async () => {
    const calls = stubWorker(workerResponse({ websites: [] }, 200));

    await proxyToCmsApi({
      request: browserRequest({ headers: { 'x-zes-tenant': 'whop:other-user' } }),
      method: 'GET',
      path: '/api/websites',
    });

    const headers = new Headers(calls[0]?.init.headers);

    expect(headers.get(ASSERTION_HEADER_TENANT)).toBe('whop:user-a');
  });

  it('blocks a mutation without the CSRF header', async () => {
    const calls = stubWorker(workerResponse({ website: { id: '1', slug: 'alpha' } }, 201));

    const response = await proxyToCmsApi({
      request: browserRequest({ method: 'POST', body: '{"name":"Alpha","slug":"alpha"}' }),
      method: 'POST',
      path: '/api/websites',
      body: '{"name":"Alpha","slug":"alpha"}',
    });

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('blocks a mutation from another origin', async () => {
    const calls = stubWorker(workerResponse({ website: { id: '1', slug: 'alpha' } }, 201));

    const response = await proxyToCmsApi({
      request: browserRequest({
        method: 'POST',
        body: '{}',
        headers: { origin: 'https://evil.example', [CMS_MUTATION_HEADER]: '1' },
      }),
      method: 'POST',
      path: '/api/websites',
      body: '{}',
    });

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('blocks a cross-site mutation reported by the fetch metadata', async () => {
    const calls = stubWorker(workerResponse({ website: { id: '1', slug: 'alpha' } }, 201));

    const response = await proxyToCmsApi({
      request: browserRequest({
        method: 'POST',
        body: '{}',
        headers: { 'sec-fetch-site': 'cross-site', [CMS_MUTATION_HEADER]: '1' },
      }),
      method: 'POST',
      path: '/api/websites',
      body: '{}',
    });

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('forwards a mutation of the same origin with its body unchanged', async () => {
    const body = '{"name":"Alpha","slug":"alpha"}';
    const calls = stubWorker(workerResponse({ website: { id: '1', slug: 'alpha' } }, 201));

    const response = await proxyToCmsApi({
      request: browserRequest({ method: 'POST', body, headers: { [CMS_MUTATION_HEADER]: '1' } }),
      method: 'POST',
      path: '/api/websites',
      body,
    });

    expect(response.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe('POST');
    expect(new TextDecoder().decode(calls[0]?.init.body as Uint8Array)).toBe(body);
  });

  it('maps an error of the Worker', async () => {
    stubWorker(workerResponse({ error: "Slug 'alpha' is already in use for this user", code: 'duplicate_slug' }, 409));

    const response = await proxyToCmsApi({ request: browserRequest(), method: 'GET', path: '/api/websites' });

    expect(response.status).toBe(409);

    const payload = (await response.json()) as { code: string; error: string };

    expect(payload.code).toBe('duplicate_slug');
    expect(payload.error).toContain('alpha');
  });

  it('answers 503 when the Worker cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const response = await proxyToCmsApi({ request: browserRequest(), method: 'GET', path: '/api/websites' });

    expect(response.status).toBe(503);

    const payload = (await response.json()) as { code: string; error: string };

    expect(payload.code).toBe('unavailable');
    expect(payload.error).not.toContain(SERVICE_TOKEN);
    expect(payload.error).not.toContain(ASSERTION_SECRET);
  });

  it('answers 502 when the Worker returns an unexpected payload', async () => {
    stubWorker(workerResponse({ websites: [{ unexpected: true }] }, 200));

    const response = await proxyToCmsApi({ request: browserRequest(), method: 'GET', path: '/api/websites' });

    expect(response.status).toBe(502);

    const payload = (await response.json()) as { code: string };

    expect(payload.code).toBe('invalid_response');
  });

  it('answers 503 when the deployment is not configured', async () => {
    delete process.env.CMS_API_URL;

    const calls = stubWorker(workerResponse({ websites: [] }, 200));

    const response = await proxyToCmsApi({ request: browserRequest(), method: 'GET', path: '/api/websites' });

    expect(response.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it('propagates the request id of the Worker', async () => {
    stubWorker(workerResponse({ websites: [] }, 200, 'worker-request-id'));

    const response = await proxyToCmsApi({ request: browserRequest(), method: 'GET', path: '/api/websites' });

    expect(response.headers.get('x-zes-request-id')).toBe('worker-request-id');
  });

  it('never exposes the credentials in a response', async () => {
    stubWorker(workerResponse({ websites: [] }, 200));

    const response = await proxyToCmsApi({ request: browserRequest(), method: 'GET', path: '/api/websites' });
    const text = await response.text();

    expect(text).not.toContain(SERVICE_TOKEN);
    expect(text).not.toContain(ASSERTION_SECRET);
  });
});
