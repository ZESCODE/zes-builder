/**
 * In-memory storage adapter.
 *
 * Used by automated tests and by local development runs that must not touch the
 * filesystem. Every instance owns its own store, so tests stay isolated without
 * shared static state.
 */

import { assertValidSlug, slugIsUnique } from '~/lib/cms/slug';
import { StorageError } from '~/lib/storage/contract';
import type { StorageAdapter, TenantContext, Website, WebsiteInput, WebsitePatch } from '~/lib/storage/contract';

export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly _websites = new Map<string, Website>();

  constructor(seed: Website[] = []) {
    for (const website of seed) {
      this._websites.set(website.id, { ...website });
    }
  }

  async health(): Promise<boolean> {
    return true;
  }

  async listWebsites(ctx: TenantContext): Promise<Website[]> {
    return [...this._websites.values()]
      .filter((website) => website.userId === ctx.userId && !website.deletedAt)
      .map((website) => ({ ...website }));
  }

  async getWebsite(id: string, ctx: TenantContext): Promise<Website | null> {
    const website = this._websites.get(id);

    if (!website || website.userId !== ctx.userId || website.deletedAt) {
      return null;
    }

    return { ...website };
  }

  async createWebsite(ctx: TenantContext, input: WebsiteInput): Promise<Website> {
    const slug = assertValidSlug(input.slug);
    const name = input.name?.trim() ?? '';

    if (!name) {
      throw new StorageError('invalid_input', 'A website name is required');
    }

    const websites = [...this._websites.values()];

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

    this._websites.set(website.id, website);

    return { ...website };
  }

  async updateWebsite(id: string, ctx: TenantContext, patch: WebsitePatch): Promise<Website> {
    const existing = this._websites.get(id);

    if (!existing || existing.userId !== ctx.userId || existing.deletedAt) {
      throw new StorageError('not_found', `Website '${id}' was not found`);
    }

    const slug = patch.slug === undefined ? existing.slug : assertValidSlug(patch.slug);

    if (slug !== existing.slug) {
      const websites = [...this._websites.values()];

      if (!slugIsUnique(websites, { userId: ctx.userId, slug, excludeId: id })) {
        throw new StorageError('duplicate_slug', `Slug '${slug}' is already in use for this user`);
      }
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

    this._websites.set(id, updated);

    return { ...updated };
  }

  async deleteWebsite(id: string, ctx: TenantContext): Promise<void> {
    const existing = this._websites.get(id);

    if (!existing || existing.userId !== ctx.userId || existing.deletedAt) {
      throw new StorageError('not_found', `Website '${id}' was not found`);
    }

    const timestamp = new Date().toISOString();

    this._websites.set(id, {
      ...existing,
      status: 'archived',
      deletedAt: timestamp,
      updatedAt: timestamp,
    });
  }
}
