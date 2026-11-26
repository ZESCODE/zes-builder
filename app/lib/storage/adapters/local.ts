/**
 * Node.js filesystem JSON storage adapter (local development only).
 *
 * Scope and limits:
 * - Single process only. There is no cross-process lock, so two processes
 *   writing the same data directory can lose updates. Do not run more than one
 *   server process against one data directory.
 * - Every read-modify-write operation runs inside one in-process critical
 *   section, so the slug uniqueness check and the write that follows it cannot
 *   interleave with another operation on the same store.
 * - Writes are atomic: the payload is written to a temporary file in the same
 *   directory and then renamed over the target, so a crash cannot leave a
 *   half-written store behind.
 * - Malformed store data is treated as an unavailable backend. The adapter never
 *   overwrites data it cannot read.
 *
 * Node-only (`node:fs`, `node:path`). The storage factory loads this module
 * lazily through a non-analyzable specifier so the module — and with it the
 * filesystem dependency — never enters the Cloudflare Worker bundle.
 */

import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { assertValidSlug, slugIsUnique } from '~/lib/cms/slug';
import { StorageError } from '~/lib/storage/contract';
import type { StorageAdapter, TenantContext, Website, WebsiteInput, WebsitePatch } from '~/lib/storage/contract';

const STORE_FILE = 'websites.json';

/**
 * In-process lock, one entry per store file.
 *
 * The map holds a promise that never rejects, so a failed operation cannot
 * break the chain for the operations queued behind it.
 */
const storeLocks = new Map<string, Promise<void>>();

async function withStoreLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = storeLocks.get(key) ?? Promise.resolve();
  const result = previous.then(() => operation());

  const settled = result.then(
    () => undefined,
    () => undefined,
  );

  storeLocks.set(key, settled);

  await settled;

  if (storeLocks.get(key) === settled) {
    storeLocks.delete(key);
  }

  return result;
}

function isWebsiteRecord(value: unknown): value is Website {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<Website>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.userId === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.slug === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

function parseWebsites(raw: string): Website[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StorageError(
      'unavailable',
      `The website store is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(parsed) || !parsed.every(isWebsiteRecord)) {
    throw new StorageError('unavailable', 'The website store has an unexpected shape');
  }

  return parsed;
}

export class NodeLocalStorageAdapter implements StorageAdapter {
  private readonly _dataDirOverride?: string;

  constructor(dataDir?: string) {
    this._dataDirOverride = dataDir;
  }

  private _dataDir(): string {
    return this._dataDirOverride ?? process.env.ZES_STORAGE_DATA_DIR ?? join(process.cwd(), '.zes-storage');
  }

  private _storePath(): string {
    return join(this._dataDir(), STORE_FILE);
  }

  async health(): Promise<boolean> {
    try {
      await fs.mkdir(this._dataDir(), { recursive: true });
      await fs.access(this._dataDir(), constants.W_OK);

      return true;
    } catch {
      return false;
    }
  }

  private async _readWebsites(): Promise<Website[]> {
    const file = this._storePath();

    let raw: string;

    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      throw new StorageError(
        'unavailable',
        `The website store could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return parseWebsites(raw);
  }

  private async _writeWebsites(websites: Website[]): Promise<void> {
    const dir = this._dataDir();
    const file = this._storePath();
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;

    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(temporary, `${JSON.stringify(websites, null, 2)}\n`, 'utf8');
      await fs.rename(temporary, file);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);

      throw new StorageError(
        'unavailable',
        `The website store could not be written: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async listWebsites(ctx: TenantContext): Promise<Website[]> {
    return withStoreLock(this._storePath(), async () => {
      const websites = await this._readWebsites();

      return websites.filter((website) => website.userId === ctx.userId && !website.deletedAt);
    });
  }

  async getWebsite(id: string, ctx: TenantContext): Promise<Website | null> {
    return withStoreLock(this._storePath(), async () => {
      const websites = await this._readWebsites();
      const website = websites.find((candidate) => candidate.id === id && candidate.userId === ctx.userId);

      return website && !website.deletedAt ? website : null;
    });
  }

  async createWebsite(ctx: TenantContext, input: WebsiteInput): Promise<Website> {
    const slug = assertValidSlug(input.slug);
    const name = input.name?.trim() ?? '';

    if (!name) {
      throw new StorageError('invalid_input', 'A website name is required');
    }

    return withStoreLock(this._storePath(), async () => {
      const websites = await this._readWebsites();

      if (!slugIsUnique(websites, { userId: ctx.userId, slug })) {
        throw new StorageError('duplicate_slug', `Slug '${slug}' is already in use for this user`);
      }

      const timestamp = new Date().toISOString();

      const website: Website = {
        id: crypto.randomUUID(),
        userId: ctx.userId,
        name,
        slug,
        templateId: input.templateId,
        themeJson: input.themeJson ?? '{}',
        domain: input.domain,
        deployTarget: input.deployTarget,
        deployConfigJson: input.deployConfigJson ?? '{}',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      websites.push(website);
      await this._writeWebsites(websites);

      return website;
    });
  }

  async updateWebsite(id: string, ctx: TenantContext, patch: WebsitePatch): Promise<Website> {
    return withStoreLock(this._storePath(), async () => {
      const websites = await this._readWebsites();

      const index = websites.findIndex(
        (candidate) => candidate.id === id && candidate.userId === ctx.userId && !candidate.deletedAt,
      );

      if (index === -1) {
        throw new StorageError('not_found', `Website '${id}' was not found`);
      }

      const existing = websites[index];
      const slug = patch.slug === undefined ? existing.slug : assertValidSlug(patch.slug);

      if (slug !== existing.slug && !slugIsUnique(websites, { userId: ctx.userId, slug, excludeId: id })) {
        throw new StorageError('duplicate_slug', `Slug '${slug}' is already in use for this user`);
      }

      const updated: Website = {
        ...existing,
        ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
        ...(patch.slug === undefined ? {} : { slug }),
        ...(patch.templateId === undefined ? {} : { templateId: patch.templateId }),
        ...(patch.themeJson === undefined ? {} : { themeJson: patch.themeJson }),
        ...(patch.domain === undefined ? {} : { domain: patch.domain }),
        ...(patch.deployTarget === undefined ? {} : { deployTarget: patch.deployTarget }),
        ...(patch.deployConfigJson === undefined ? {} : { deployConfigJson: patch.deployConfigJson }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        updatedAt: new Date().toISOString(),
      };

      websites[index] = updated;
      await this._writeWebsites(websites);

      return updated;
    });
  }

  async deleteWebsite(id: string, ctx: TenantContext): Promise<void> {
    await withStoreLock(this._storePath(), async () => {
      const websites = await this._readWebsites();

      const index = websites.findIndex(
        (candidate) => candidate.id === id && candidate.userId === ctx.userId && !candidate.deletedAt,
      );

      if (index === -1) {
        throw new StorageError('not_found', `Website '${id}' was not found`);
      }

      const timestamp = new Date().toISOString();

      websites[index] = {
        ...websites[index],
        status: 'archived',
        deletedAt: timestamp,
        updatedAt: timestamp,
      };

      await this._writeWebsites(websites);
    });
  }
}
