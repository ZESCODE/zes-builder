/**
 * D1 storage adapter tests.
 *
 * The adapter runs against a `node:sqlite` engine behind a D1-compatible
 * binding shim, and the schema comes from the shipped migration file. The
 * SQLite engine therefore enforces the slug rule and the tenant columns exactly
 * as D1 would.
 *
 * The last section drives the CMS API Worker against the same shim. The Worker
 * is the component that talks to D1 in production, so the database behaviour
 * and the tenant scoping are verified through it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSignedRequest, executionContext, workerEnvironment } from './helpers/cms-request';
import { applyMigration, applyMigrations, createD1Shim } from './helpers/d1-sqlite';
import type { D1Shim } from './helpers/d1-sqlite';
import { D1StorageAdapter } from '~/lib/storage/adapters/d1';

const { default: cmsWorker } = await import('../../workers/cms-api/index');
const { createStorageAdapter, resetStorageAdapterForTesting } = await import('~/lib/storage/factory');

const TENANT_A = 'whop:user-a';
const TENANT_B = 'whop:user-b';

describe('D1 storage adapter', () => {
  let shim: D1Shim;
  let adapter: D1StorageAdapter;

  beforeEach(() => {
    shim = createD1Shim();
    applyMigration(shim.sqlite);
    adapter = new D1StorageAdapter(shim.db);
  });

  afterEach(() => {
    shim.close();
  });

  it('reports healthy when the schema is applied', async () => {
    await expect(adapter.health()).resolves.toBe(true);
  });

  it('reports unhealthy when the schema is missing', async () => {
    const empty = createD1Shim();

    try {
      await expect(new D1StorageAdapter(empty.db).health()).resolves.toBe(false);
    } finally {
      empty.close();
    }
  });

  it('stores the tenant from the context, not from the payload', async () => {
    const created = await adapter.createWebsite(
      { userId: TENANT_A },
      { name: 'Alpha', slug: 'alpha', themeJson: '{"color":"blue"}' },
    );

    expect(created.userId).toBe(TENANT_A);
    expect(created.status).toBe('active');
    expect(created.themeJson).toBe('{"color":"blue"}');
    expect(created.deletedAt).toBeUndefined();

    const row = shim.sqlite.prepare('SELECT user_id FROM website_projects WHERE id = ?').get(created.id) as {
      user_id: string;
    };

    expect(row.user_id).toBe(TENANT_A);
  });

  it('lists only the websites of the tenant', async () => {
    await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });
    await adapter.createWebsite({ userId: TENANT_B }, { name: 'Beta', slug: 'beta' });

    const websites = await adapter.listWebsites({ userId: TENANT_A });

    expect(websites.map((website) => website.name)).toEqual(['Alpha']);
  });

  it('returns null for another tenant’s website', async () => {
    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(adapter.getWebsite(created.id, { userId: TENANT_B })).resolves.toBeNull();
  });

  it('rejects a cross-tenant update', async () => {
    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(adapter.updateWebsite(created.id, { userId: TENANT_B }, { name: 'Hijacked' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('rejects a cross-tenant delete', async () => {
    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(adapter.deleteWebsite(created.id, { userId: TENANT_B })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('rejects a duplicate slug for the same tenant', async () => {
    await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(
      adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha again', slug: 'alpha' }),
    ).rejects.toMatchObject({ code: 'duplicate_slug', status: 409 });
  });

  it('allows the same slug for a different tenant', async () => {
    await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'shared-slug' });

    await expect(
      adapter.createWebsite({ userId: TENANT_B }, { name: 'Beta', slug: 'shared-slug' }),
    ).resolves.toMatchObject({ userId: TENANT_B, slug: 'shared-slug' });
  });

  it('allows a soft-deleted slug to be reused', async () => {
    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'recycled' });

    await adapter.deleteWebsite(created.id, { userId: TENANT_A });

    await expect(
      adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha again', slug: 'recycled' }),
    ).resolves.toMatchObject({ slug: 'recycled' });
  });

  it('keeps the slug when the patch does not change it', async () => {
    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    const updated = await adapter.updateWebsite(created.id, { userId: TENANT_A }, { name: 'Alpha renamed' });

    expect(updated.slug).toBe('alpha');
    expect(updated.name).toBe('Alpha renamed');
  });

  it('rejects an update to a slug owned by another website', async () => {
    await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    const beta = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Beta', slug: 'beta' });

    await expect(adapter.updateWebsite(beta.id, { userId: TENANT_A }, { slug: 'alpha' })).rejects.toMatchObject({
      code: 'duplicate_slug',
    });
  });

  it('rejects an invalid slug and a missing name', async () => {
    await expect(
      adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'Not Valid' }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });

    await expect(adapter.createWebsite({ userId: TENANT_A }, { name: '   ', slug: 'alpha' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('soft-deletes: the row is retained and leaves the tenant list', async () => {
    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await adapter.deleteWebsite(created.id, { userId: TENANT_A });

    const row = shim.sqlite.prepare('SELECT deleted_at, status FROM website_projects WHERE id = ?').get(created.id) as {
      deleted_at: string | null;
      status: string;
    };

    expect(row.deleted_at).not.toBeNull();
    expect(row.status).toBe('archived');

    await expect(adapter.listWebsites({ userId: TENANT_A })).resolves.toEqual([]);
    await expect(adapter.getWebsite(created.id, { userId: TENANT_A })).resolves.toBeNull();
  });

  it('reports an unavailable backend when the database cannot be queried', async () => {
    const broken = createD1Shim();

    applyMigration(broken.sqlite);
    broken.sqlite.exec('DROP TABLE website_projects');

    try {
      await expect(new D1StorageAdapter(broken.db).listWebsites({ userId: TENANT_A })).rejects.toMatchObject({
        code: 'unavailable',
        status: 503,
      });
    } finally {
      broken.close();
    }
  });
});

describe('D1 backend selection', () => {
  const originalBackend = process.env.STORAGE_BACKEND;

  beforeEach(() => {
    resetStorageAdapterForTesting();
  });

  afterEach(() => {
    resetStorageAdapterForTesting();

    if (originalBackend === undefined) {
      delete process.env.STORAGE_BACKEND;
    } else {
      process.env.STORAGE_BACKEND = originalBackend;
    }
  });

  it('fails closed when the D1 binding is missing', async () => {
    process.env.STORAGE_BACKEND = 'd1';

    await expect(createStorageAdapter()).rejects.toMatchObject({ code: 'unavailable', status: 503 });
  });

  it('builds the D1 adapter when the binding is available', async () => {
    process.env.STORAGE_BACKEND = 'd1';

    const shim = createD1Shim();

    applyMigration(shim.sqlite);

    try {
      const adapter = await createStorageAdapter({ d1: shim.db });

      expect(adapter).toBeInstanceOf(D1StorageAdapter);
      await expect(adapter.health()).resolves.toBe(true);
    } finally {
      shim.close();
    }
  });
});

describe('website API in the CMS API Worker on D1', () => {
  let shim: D1Shim;

  beforeEach(() => {
    shim = createD1Shim();
    applyMigrations(shim.sqlite);
    resetStorageAdapterForTesting();
  });

  afterEach(() => {
    resetStorageAdapterForTesting();
    shim.close();
  });

  function callWorker(request: Request): Promise<Response> {
    return cmsWorker.fetch(request, workerEnvironment(shim) as never, executionContext);
  }

  it('creates and lists a website for the tenant of the assertion', async () => {
    const created = await callWorker(
      await createSignedRequest({
        method: 'POST',
        path: '/api/websites',
        body: JSON.stringify({ name: 'Alpha', slug: 'alpha' }),
        tenant: TENANT_A,
      }),
    );

    expect(created.status).toBe(201);

    const listed = await callWorker(await createSignedRequest({ tenant: TENANT_A }));
    const payload = (await listed.json()) as { websites: Array<{ name: string; userId: string }> };

    expect(payload.websites).toHaveLength(1);
    expect(payload.websites[0]).toMatchObject({ name: 'Alpha', userId: TENANT_A });
  });

  it('reports a duplicate slug as a conflict', async () => {
    await callWorker(
      await createSignedRequest({
        method: 'POST',
        path: '/api/websites',
        body: JSON.stringify({ name: 'Alpha', slug: 'alpha' }),
        tenant: TENANT_A,
      }),
    );

    const second = await callWorker(
      await createSignedRequest({
        method: 'POST',
        path: '/api/websites',
        body: JSON.stringify({ name: 'Alpha again', slug: 'alpha' }),
        tenant: TENANT_A,
      }),
    );

    expect(second.status).toBe(409);
  });

  it('hides another tenant’s website behind a 404', async () => {
    const created = await callWorker(
      await createSignedRequest({
        method: 'POST',
        path: '/api/websites',
        body: JSON.stringify({ name: 'Alpha', slug: 'alpha' }),
        tenant: TENANT_A,
      }),
    );

    const payload = (await created.json()) as { website: { id: string } };
    const path = `/api/websites/${payload.website.id}`;

    const read = await callWorker(await createSignedRequest({ path, tenant: TENANT_B }));

    const removed = await callWorker(await createSignedRequest({ method: 'DELETE', path, tenant: TENANT_B }));

    expect(read.status).toBe(404);
    expect(removed.status).toBe(404);
  });

  it('fails closed with 503 when the deployment has no D1 binding', async () => {
    const response = await cmsWorker.fetch(
      await createSignedRequest(),
      workerEnvironment(null) as never,
      executionContext,
    );

    expect(response.status).toBe(503);
  });
});
