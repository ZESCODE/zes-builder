/**
 * Storage adapter contract tests.
 *
 * The same suite runs against both Phase 1A adapters (local filesystem and
 * in-memory) so the two backends cannot drift apart. Local-only behaviour —
 * atomic writes, malformed store data, concurrent writes — has its own cases.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStorageAdapter } from '~/lib/storage/adapters/memory';
import { NodeLocalStorageAdapter } from '~/lib/storage/adapters/local';
import { createStorageAdapter, resetStorageAdapterForTesting } from '~/lib/storage/factory';
import { StorageError } from '~/lib/storage/contract';
import type { StorageAdapter } from '~/lib/storage/contract';

const TENANT_A = 'whop:user-a';
const TENANT_B = 'whop:user-b';

interface AdapterCase {
  name: string;
  create: () => Promise<StorageAdapter>;
  cleanup?: () => Promise<void>;
}

const temporaryDirectories: string[] = [];

async function createLocalAdapter(): Promise<StorageAdapter> {
  const directory = await mkdtemp(join(tmpdir(), 'zes-storage-'));

  temporaryDirectories.push(directory);

  return new NodeLocalStorageAdapter(directory);
}

const adapterCases: AdapterCase[] = [
  {
    name: 'local',
    create: createLocalAdapter,
  },
  {
    name: 'memory',
    create: async () => new InMemoryStorageAdapter(),
  },
];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe.each(adapterCases)('storage adapter contract ($name)', ({ create }) => {
  it('implements the contract and reports a healthy backend', async () => {
    const adapter = await create();

    expect(typeof adapter.health).toBe('function');
    expect(typeof adapter.listWebsites).toBe('function');
    expect(typeof adapter.getWebsite).toBe('function');
    expect(typeof adapter.createWebsite).toBe('function');
    expect(typeof adapter.updateWebsite).toBe('function');
    expect(typeof adapter.deleteWebsite).toBe('function');
    await expect(adapter.health()).resolves.toBe(true);
  });

  it('stores the tenant from the context, never from the payload', async () => {
    const adapter = await create();

    const website = await adapter.createWebsite(
      { userId: TENANT_A },
      { name: 'Portfolio', slug: 'portfolio', ...({ userId: TENANT_B } as Record<string, unknown>) },
    );

    expect(website.userId).toBe(TENANT_A);
  });

  it('lists only the websites owned by the tenant', async () => {
    const adapter = await create();

    await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });
    await adapter.createWebsite({ userId: TENANT_B }, { name: 'Beta', slug: 'beta' });

    const websites = await adapter.listWebsites({ userId: TENANT_A });

    expect(websites).toHaveLength(1);
    expect(websites[0]?.name).toBe('Alpha');
  });

  it('does not return another tenant’s website', async () => {
    const adapter = await create();

    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(adapter.getWebsite(created.id, { userId: TENANT_B })).resolves.toBeNull();
  });

  it('rejects a cross-tenant update', async () => {
    const adapter = await create();

    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(adapter.updateWebsite(created.id, { userId: TENANT_B }, { name: 'Hijacked' })).rejects.toMatchObject({
      code: 'not_found',
    });

    const unchanged = await adapter.getWebsite(created.id, { userId: TENANT_A });

    expect(unchanged?.name).toBe('Alpha');
  });

  it('rejects a cross-tenant delete', async () => {
    const adapter = await create();

    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(adapter.deleteWebsite(created.id, { userId: TENANT_B })).rejects.toMatchObject({
      code: 'not_found',
    });

    await expect(adapter.getWebsite(created.id, { userId: TENANT_A })).resolves.not.toBeNull();
  });

  it('rejects a duplicate slug for the same tenant', async () => {
    const adapter = await create();

    await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(
      adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha again', slug: 'alpha' }),
    ).rejects.toMatchObject({ code: 'duplicate_slug' });
  });

  it('allows a different slug for the same tenant', async () => {
    const adapter = await create();

    await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(
      adapter.createWebsite({ userId: TENANT_A }, { name: 'Gamma', slug: 'gamma' }),
    ).resolves.toMatchObject({ slug: 'gamma' });
  });

  it('allows the same slug for different tenants', async () => {
    const adapter = await create();

    await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'shared-slug' });

    await expect(
      adapter.createWebsite({ userId: TENANT_B }, { name: 'Beta', slug: 'shared-slug' }),
    ).resolves.toMatchObject({ slug: 'shared-slug' });
  });

  it('allows reusing the slug of a soft-deleted website', async () => {
    const adapter = await create();

    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await adapter.deleteWebsite(created.id, { userId: TENANT_A });

    await expect(
      adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha rebuilt', slug: 'alpha' }),
    ).resolves.toMatchObject({ slug: 'alpha' });
  });

  it('hides a soft-deleted website from the tenant', async () => {
    const adapter = await create();

    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await adapter.deleteWebsite(created.id, { userId: TENANT_A });

    await expect(adapter.getWebsite(created.id, { userId: TENANT_A })).resolves.toBeNull();
    await expect(adapter.listWebsites({ userId: TENANT_A })).resolves.toEqual([]);
  });

  it('accepts an update that keeps the current slug', async () => {
    const adapter = await create();

    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await expect(adapter.updateWebsite(created.id, { userId: TENANT_A }, { slug: 'alpha', name: 'Alpha renamed' })).resolves.toMatchObject(
      { name: 'Alpha renamed', slug: 'alpha' },
    );
  });

  it('rejects an invalid slug', async () => {
    const adapter = await create();

    await expect(
      adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'Not A Slug' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('reports a missing website as not found', async () => {
    const adapter = await create();

    await expect(adapter.updateWebsite('missing-id', { userId: TENANT_A }, { name: 'Nope' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(adapter.deleteWebsite('missing-id', { userId: TENANT_A })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('local adapter filesystem behaviour', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'zes-storage-'));
    temporaryDirectories.push(directory);
  });

  it('writes the store atomically and leaves no temporary files behind', async () => {
    const adapter = new NodeLocalStorageAdapter(directory);

    await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    const entries = await readdir(directory);

    expect(entries).toEqual(['websites.json']);
    expect(JSON.parse(await readFile(join(directory, 'websites.json'), 'utf8'))).toHaveLength(1);
  });

  it('keeps the row when a website is soft-deleted', async () => {
    const adapter = new NodeLocalStorageAdapter(directory);

    const created = await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    await adapter.deleteWebsite(created.id, { userId: TENANT_A });

    const stored = JSON.parse(await readFile(join(directory, 'websites.json'), 'utf8'));

    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(created.id);
    expect(stored[0].deletedAt).toBeTruthy();
    expect(stored[0].status).toBe('archived');
  });

  it('fails closed on malformed store data without overwriting it', async () => {
    await writeFile(join(directory, 'websites.json'), '{ not json', 'utf8');

    const adapter = new NodeLocalStorageAdapter(directory);

    await expect(adapter.listWebsites({ userId: TENANT_A })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(await readFile(join(directory, 'websites.json'), 'utf8')).toBe('{ not json');
  });

  it('serializes concurrent writes so no update is lost', async () => {
    const adapter = new NodeLocalStorageAdapter(directory);

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        adapter.createWebsite({ userId: TENANT_A }, { name: `Site ${index}`, slug: `site-${index}` }),
      ),
    );

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);

    const stored = JSON.parse(await readFile(join(directory, 'websites.json'), 'utf8'));

    expect(stored).toHaveLength(8);
  });

  it('allows exactly one of many concurrent creates with the same slug', async () => {
    const adapter = new NodeLocalStorageAdapter(directory);

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        adapter.createWebsite({ userId: TENANT_A }, { name: `Site ${index}`, slug: 'same-slug' }),
      ),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    expect(
      rejected.every(
        (result) => result.status === 'rejected' && (result.reason as StorageError).code === 'duplicate_slug',
      ),
    ).toBe(true);
  });

  it('reports an unusable data directory as unhealthy', async () => {
    await writeFile(join(directory, 'blocker'), 'not a directory', 'utf8');

    const adapter = new NodeLocalStorageAdapter(join(directory, 'blocker', 'nested'));

    await expect(adapter.health()).resolves.toBe(false);
  });
});

describe('storage factory', () => {
  const originalBackend = process.env.STORAGE_BACKEND;
  const originalDataDir = process.env.ZES_STORAGE_DATA_DIR;

  beforeEach(() => {
    resetStorageAdapterForTesting();
  });

  afterEach(() => {
    if (originalBackend === undefined) {
      delete process.env.STORAGE_BACKEND;
    } else {
      process.env.STORAGE_BACKEND = originalBackend;
    }

    if (originalDataDir === undefined) {
      delete process.env.ZES_STORAGE_DATA_DIR;
    } else {
      process.env.ZES_STORAGE_DATA_DIR = originalDataDir;
    }

    resetStorageAdapterForTesting();
  });

  it('creates the memory adapter', async () => {
    process.env.STORAGE_BACKEND = 'memory';

    const adapter = await createStorageAdapter();

    expect(adapter).toBeInstanceOf(InMemoryStorageAdapter);
  });

  it('creates the local adapter against the configured data directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zes-storage-'));

    temporaryDirectories.push(directory);

    process.env.STORAGE_BACKEND = 'local';
    process.env.ZES_STORAGE_DATA_DIR = directory;

    const adapter = await createStorageAdapter();

    expect(adapter).toBeInstanceOf(NodeLocalStorageAdapter);

    await adapter.createWebsite({ userId: TENANT_A }, { name: 'Alpha', slug: 'alpha' });

    expect(JSON.parse(await readFile(join(directory, 'websites.json'), 'utf8'))).toHaveLength(1);
  });

  it('refuses the D1 backend instead of falling back', async () => {
    process.env.STORAGE_BACKEND = 'd1';

    await expect(createStorageAdapter()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('refuses to run without a configured backend', async () => {
    delete process.env.STORAGE_BACKEND;

    await expect(createStorageAdapter()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('refuses an unknown backend', async () => {
    process.env.STORAGE_BACKEND = 'postgres';

    await expect(createStorageAdapter()).rejects.toMatchObject({ code: 'unavailable' });
  });
});
