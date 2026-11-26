/**
 * Tenant isolation, slug rules and route behaviour for the website API.
 *
 * The service tests drive the real storage service, so the tenant plumbing is
 * exercised end to end: a caller can only ever reach the websites of their own
 * tenant.
 *
 * The route tests drive the real loaders and actions. The routes are proxies to
 * the CMS API Worker, so the tests verify the part of the chain that belongs to
 * the application server: the access gate, the session, the browser
 * protections and the forwarding of the payload.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidSlug, slugIsUnique } from '~/lib/cms/slug';
import { WebsiteStorageService } from '~/lib/cms/storage';
import { InMemoryStorageAdapter } from '~/lib/storage/adapters/memory';
import { StorageError } from '~/lib/storage/contract';
import type { StorageAdapter } from '~/lib/storage/contract';
import { tenantContext } from '~/lib/tenancy/ownership';

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

const { loader: websitesLoader, action: websitesAction } = await import('~/routes/websites');
const { loader: websiteLoader, action: websiteAction } = await import('~/routes/websites.$websiteId');
const { default: routeRegistry } = await import('~/routes');

const TENANT_A = 'whop:user-a';
const TENANT_B = 'whop:user-b';

const CMS_API_URL = 'https://cms.test';

interface OutgoingCall {
  url: string;
  init: RequestInit;
}

function stubWorker(response: Response): OutgoingCall[] {
  const calls: OutgoingCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });

      return response.clone();
    }),
  );

  return calls;
}

function workerResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-zes-request-id': 'worker-request-id' },
  });
}

function jsonRequest(url: string, method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', origin: 'https://app.zes.codes', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function unhealthyAdapter(): StorageAdapter {
  return {
    health: async () => false,
    listWebsites: async () => [],
    getWebsite: async () => null,
    createWebsite: async () => {
      throw new StorageError('unavailable', 'The storage backend is unavailable');
    },
    updateWebsite: async () => {
      throw new StorageError('unavailable', 'The storage backend is unavailable');
    },
    deleteWebsite: async () => {
      throw new StorageError('unavailable', 'The storage backend is unavailable');
    },
  };
}

describe('website service tenant isolation', () => {
  let service: WebsiteStorageService;

  beforeEach(() => {
    service = new WebsiteStorageService(new InMemoryStorageAdapter());
  });

  it('lists only the websites of the tenant', async () => {
    await service.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });
    await service.createWebsite({ userId: TENANT_B }, { name: 'Beta', slug: 'beta' });

    const websites = await service.listWebsites({ userId: TENANT_A });

    expect(websites.map((website) => website.name)).toEqual(['Alpha']);
  });

  it('returns null for another tenant’s website', async () => {
    const created = await service.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(service.getWebsite(created.id, { userId: TENANT_B })).resolves.toBeNull();
  });

  it('rejects a cross-tenant update', async () => {
    const created = await service.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(service.updateWebsite(created.id, { userId: TENANT_B }, { name: 'Hijacked' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('rejects a cross-tenant delete', async () => {
    const created = await service.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(service.deleteWebsite(created.id, { userId: TENANT_B })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('rejects a duplicate slug inside one tenant', async () => {
    await service.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(
      service.createWebsite({ userId: TENANT_A }, { name: 'Alpha again', slug: 'alpha' }),
    ).rejects.toMatchObject({
      code: 'duplicate_slug',
    });
  });

  it('releases the slug of a soft-deleted website', async () => {
    const created = await service.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await service.deleteWebsite(created.id, { userId: TENANT_A });

    await expect(
      service.createWebsite({ userId: TENANT_A }, { name: 'Alpha rebuilt', slug: 'alpha' }),
    ).resolves.toMatchObject({ slug: 'alpha' });
  });

  it('rejects invalid input', async () => {
    await expect(service.createWebsite({ userId: TENANT_A }, { name: '   ', slug: 'alpha' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(
      service.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'Alpha Slug' }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(
      service.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha', themeJson: '{ broken' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses to work without a tenant', async () => {
    await expect(service.listWebsites({ userId: '' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('fails closed when the backend is unhealthy', async () => {
    const unhealthy = new WebsiteStorageService(unhealthyAdapter());

    await expect(unhealthy.listWebsites({ userId: TENANT_A })).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('slug rules', () => {
  it('accepts lowercase slugs with single hyphens', () => {
    expect(isValidSlug('alpha')).toBe(true);
    expect(isValidSlug('alpha-one')).toBe(true);
    expect(isValidSlug('alpha1')).toBe(true);
  });

  it('rejects malformed slugs', () => {
    expect(isValidSlug('Alpha')).toBe(false);
    expect(isValidSlug('alpha one')).toBe(false);
    expect(isValidSlug('alpha--one')).toBe(false);
    expect(isValidSlug('-alpha')).toBe(false);
    expect(isValidSlug('a')).toBe(false);
    expect(isValidSlug('a'.repeat(64))).toBe(false);
  });

  it('ignores soft-deleted websites and the website being updated', () => {
    const websites = [
      { id: '1', userId: TENANT_A, slug: 'alpha' },
      { id: '2', userId: TENANT_A, slug: 'beta', deletedAt: '2026-01-01T00:00:00.000Z' },
      { id: '3', userId: TENANT_B, slug: 'gamma' },
    ];

    expect(slugIsUnique(websites, { userId: TENANT_A, slug: 'alpha' })).toBe(false);
    expect(slugIsUnique(websites, { userId: TENANT_A, slug: 'alpha', excludeId: '1' })).toBe(true);
    expect(slugIsUnique(websites, { userId: TENANT_A, slug: 'beta' })).toBe(true);
    expect(slugIsUnique(websites, { userId: TENANT_A, slug: 'gamma' })).toBe(true);
  });

  it('builds a tenant context from a principal', () => {
    expect(tenantContext('whop:user-a')).toEqual({ userId: 'whop:user-a' });
    expect(() => tenantContext('  ')).toThrow(StorageError);
  });
});

describe('website API routes', () => {
  beforeEach(() => {
    mockRequireAccess.mockResolvedValue(null);
    mockReadSession.mockResolvedValue({ userId: 'user-a' });
    process.env.CMS_API_URL = CMS_API_URL;
    process.env.CMS_SERVICE_TOKEN = 'service-token-for-tests';
    process.env.CMS_ASSERTION_SECRET = 'assertion-secret-for-tests';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CMS_API_URL;
    delete process.env.CMS_SERVICE_TOKEN;
    delete process.env.CMS_ASSERTION_SECRET;
  });

  it('requires a session for the collection route', async () => {
    mockReadSession.mockResolvedValue(null);

    const listResponse = await websitesLoader({
      request: new Request('https://app.zes.codes/api/websites'),
    } as unknown as LoaderFunctionArgs);
    const createResponse = await websitesAction({
      request: jsonRequest(
        'https://app.zes.codes/api/websites',
        'POST',
        { name: 'Alpha', slug: 'alpha' },
        {
          'x-zes-csrf': '1',
        },
      ),
    } as unknown as ActionFunctionArgs);

    expect(listResponse.status).toBe(401);
    expect(createResponse.status).toBe(401);
  });

  it('propagates the access gate response', async () => {
    mockRequireAccess.mockResolvedValue(Response.json({ error: 'no_access' }, { status: 403 }));

    const response = await websitesLoader({
      request: new Request('https://app.zes.codes/api/websites'),
    } as unknown as LoaderFunctionArgs);

    expect(response.status).toBe(403);
  });

  it('forwards the list request with the tenant of the session', async () => {
    const calls = stubWorker(workerResponse({ websites: [] }, 200));

    const response = await websitesLoader({
      request: new Request('https://app.zes.codes/api/websites'),
    } as unknown as LoaderFunctionArgs);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${CMS_API_URL}/api/websites`);

    const headers = new Headers(calls[0]?.init.headers);

    expect(headers.get('x-zes-tenant')).toBe(TENANT_A);
  });

  it('never trusts a userId supplied in the request body', async () => {
    const calls = stubWorker(workerResponse({ website: { id: '1', slug: 'alpha' } }, 201));

    await websitesAction({
      request: jsonRequest(
        'https://app.zes.codes/api/websites',
        'POST',
        { name: 'Alpha', slug: 'alpha', userId: TENANT_B },
        { 'x-zes-csrf': '1' },
      ),
    } as unknown as ActionFunctionArgs);

    const headers = new Headers(calls[0]?.init.headers);

    expect(headers.get('x-zes-tenant')).toBe(TENANT_A);
  });

  it('forwards the payload of a mutation', async () => {
    const calls = stubWorker(workerResponse({ website: { id: '1', slug: 'alpha' } }, 201));

    const response = await websitesAction({
      request: jsonRequest(
        'https://app.zes.codes/api/websites',
        'POST',
        { name: 'Alpha', slug: 'alpha' },
        {
          'x-zes-csrf': '1',
        },
      ),
    } as unknown as ActionFunctionArgs);

    expect(response.status).toBe(201);
    expect(new TextDecoder().decode(calls[0]?.init.body as Uint8Array)).toBe(
      JSON.stringify({ name: 'Alpha', slug: 'alpha' }),
    );
  });

  it('rejects a mutation without the CSRF header', async () => {
    const calls = stubWorker(workerResponse({ website: { id: '1', slug: 'alpha' } }, 201));

    const response = await websitesAction({
      request: jsonRequest('https://app.zes.codes/api/websites', 'POST', { name: 'Alpha', slug: 'alpha' }),
    } as unknown as ActionFunctionArgs);

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('maps an error of the Worker', async () => {
    stubWorker(workerResponse({ error: "Slug 'alpha' is already in use for this user", code: 'duplicate_slug' }, 409));

    const response = await websitesAction({
      request: jsonRequest(
        'https://app.zes.codes/api/websites',
        'POST',
        { name: 'Alpha', slug: 'alpha' },
        {
          'x-zes-csrf': '1',
        },
      ),
    } as unknown as ActionFunctionArgs);

    expect(response.status).toBe(409);
  });

  it('rejects unsupported methods', async () => {
    const collectionResponse = await websitesAction({
      request: jsonRequest('https://app.zes.codes/api/websites', 'PUT', {}),
    } as unknown as ActionFunctionArgs);
    const itemResponse = await websiteAction({
      request: jsonRequest('https://app.zes.codes/api/websites/abc', 'POST', {}),
      params: { websiteId: 'abc' },
    } as unknown as ActionFunctionArgs);

    expect(collectionResponse.status).toBe(405);
    expect(itemResponse.status).toBe(405);
  });

  it('returns 503 when the CMS API is not configured', async () => {
    delete process.env.CMS_API_URL;

    const response = await websitesLoader({
      request: new Request('https://app.zes.codes/api/websites'),
    } as unknown as LoaderFunctionArgs);

    expect(response.status).toBe(503);
  });

  it('returns 503 when the CMS API cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const response = await websitesLoader({
      request: new Request('https://app.zes.codes/api/websites'),
    } as unknown as LoaderFunctionArgs);

    expect(response.status).toBe(503);
  });

  it('forwards the website id of an item route', async () => {
    const calls = stubWorker(workerResponse({ website: { id: 'abc', slug: 'alpha' } }, 200));

    const response = await websiteLoader({
      request: new Request('https://app.zes.codes/api/websites/abc'),
      params: { websiteId: 'abc' },
    } as unknown as LoaderFunctionArgs);

    expect(response.status).toBe(200);
    expect(calls[0]?.url).toBe(`${CMS_API_URL}/api/websites/abc`);
  });
});

describe('route registry regression', () => {
  it('registers the website routes next to the existing API routes', () => {
    const paths = routeRegistry.map((route) => ('path' in route ? route.path : undefined));

    expect(paths).toContain('/api/websites');
    expect(paths).toContain('/api/websites/:websiteId');
    expect(paths).toContain('/api/health');
    expect(paths).toContain('/api/chat');
    expect(paths).toContain('/api/auth/whop');
  });
});
