/**
 * Website CRUD service.
 *
 * The service is the only layer the API routes talk to. It validates the
 * tenant context and the payload, checks that the storage backend is healthy,
 * and delegates to the adapter. Tenant scoping is enforced twice on purpose:
 * the service refuses to work without an explicit tenant, and every adapter
 * filters by the tenant from the context, so a missing filter cannot leak data
 * across tenants.
 */

import { assertValidSlug } from '~/lib/cms/slug';
import { StorageError } from '~/lib/storage/contract';
import type { StorageAdapter, TenantContext, Website, WebsiteInput, WebsitePatch } from '~/lib/storage/contract';
import { assertTenantContext } from '~/lib/tenancy/ownership';

function assertJsonText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    JSON.parse(value);
  } catch (error) {
    throw new StorageError(
      'invalid_input',
      `${field} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return value;
}

function assertWebsiteInput(input: WebsiteInput): void {
  const name = input.name?.trim() ?? '';

  if (!name) {
    throw new StorageError('invalid_input', 'A website name is required');
  }

  assertValidSlug(input.slug);
  assertJsonText(input.themeJson, 'themeJson');
  assertJsonText(input.deployConfigJson, 'deployConfigJson');
}

function assertWebsitePatch(patch: WebsitePatch): void {
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new StorageError('invalid_input', 'A website name is required');
  }

  if (patch.slug !== undefined) {
    assertValidSlug(patch.slug);
  }

  if (patch.themeJson !== undefined) {
    assertJsonText(patch.themeJson, 'themeJson');
  }

  if (patch.deployConfigJson !== undefined) {
    assertJsonText(patch.deployConfigJson, 'deployConfigJson');
  }
}

export class WebsiteStorageService {
  constructor(private readonly _adapter: StorageAdapter) {}

  private async _requireHealthyAdapter(): Promise<void> {
    let healthy = false;

    try {
      healthy = await this._adapter.health();
    } catch (error) {
      console.error(
        '[cms/storage] the storage backend health check failed',
        error instanceof Error ? error.message : String(error),
      );

      throw new StorageError('unavailable', 'The storage backend is unavailable');
    }

    if (!healthy) {
      throw new StorageError('unavailable', 'The storage backend is unavailable');
    }
  }

  async listWebsites(ctx: TenantContext): Promise<Website[]> {
    assertTenantContext(ctx);
    await this._requireHealthyAdapter();

    return this._adapter.listWebsites(ctx);
  }

  async getWebsite(id: string, ctx: TenantContext): Promise<Website | null> {
    assertTenantContext(ctx);
    await this._requireHealthyAdapter();

    return this._adapter.getWebsite(id, ctx);
  }

  async createWebsite(ctx: TenantContext, input: WebsiteInput): Promise<Website> {
    assertTenantContext(ctx);
    assertWebsiteInput(input);
    await this._requireHealthyAdapter();

    return this._adapter.createWebsite(ctx, input);
  }

  async updateWebsite(id: string, ctx: TenantContext, patch: WebsitePatch): Promise<Website> {
    assertTenantContext(ctx);
    assertWebsitePatch(patch);
    await this._requireHealthyAdapter();

    return this._adapter.updateWebsite(id, ctx, patch);
  }

  async deleteWebsite(id: string, ctx: TenantContext): Promise<void> {
    assertTenantContext(ctx);
    await this._requireHealthyAdapter();

    return this._adapter.deleteWebsite(id, ctx);
  }
}
