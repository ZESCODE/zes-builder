/**
 * Cloudflare D1 storage adapter.
 *
 * The adapter stores website projects in the `website_projects` table created by
 * `migrations/001_zes_cms.sql`. Tenant scoping is part of every statement: the
 * tenant comes from the {@link TenantContext}, never from a request payload, and
 * a row owned by another tenant is indistinguishable from a missing row.
 *
 * The slug rule is enforced by the database, not by the adapter: the partial
 * unique index `idx_website_projects_user_slug` covers `(user_id, slug)` for
 * active rows only, so a duplicate slug for the same tenant is rejected by D1
 * and a soft-deleted slug can be reused. The adapter translates the constraint
 * violation into the `duplicate_slug` storage error.
 *
 * The adapter is a pure data layer: it never decides who may read or write. The
 * API routes and the website storage service do that, and this adapter only
 * refuses to act without an explicit tenant context.
 */

import { assertValidSlug } from '~/lib/cms/slug';
import { StorageError } from '~/lib/storage/contract';
import type {
  DeployTarget,
  StorageAdapter,
  TenantContext,
  Website,
  WebsiteInput,
  WebsitePatch,
} from '~/lib/storage/contract';

export interface D1ExecResult {
  success: boolean;
  meta?: { changes?: number; last_row_id?: number };
}

export interface D1ResultSet<T = Record<string, unknown>> {
  success: boolean;
  results: T[];
  meta?: { changes?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = Record<string, unknown>>(): Promise<D1ExecResult & { results: T[] }>;
  all<T = Record<string, unknown>>(): Promise<D1ResultSet<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

/** The part of the D1 binding the adapter uses. */
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface WebsiteRow {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  template_id: string | null;
  theme_json: string;
  domain: string | null;
  deploy_target: string | null;
  deploy_config_json: string;
  status: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

const WEBSITE_COLUMNS =
  'id, user_id, name, slug, template_id, theme_json, domain, deploy_target, deploy_config_json, status, deleted_at, created_at, updated_at';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rowToWebsite(row: WebsiteRow): Website {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    ...(row.template_id === null ? {} : { templateId: row.template_id }),
    themeJson: row.theme_json,
    ...(row.domain === null ? {} : { domain: row.domain }),
    ...(row.deploy_target === null ? {} : { deployTarget: row.deploy_target as DeployTarget }),
    deployConfigJson: row.deploy_config_json,
    status: row.status === 'archived' ? 'archived' : 'active',
    ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Translates a database constraint violation into a typed storage error.
 *
 * Returns null when the failure is not a constraint violation, so the caller can
 * report the backend as unavailable instead.
 */
function mapConstraintError(error: unknown, slug?: string): StorageError | null {
  const message = errorMessage(error);

  if (/UNIQUE constraint failed/i.test(message)) {
    return new StorageError(
      'duplicate_slug',
      slug === undefined
        ? 'The value is already in use for this user'
        : `Slug '${slug}' is already in use for this user`,
    );
  }

  if (/NOT NULL constraint failed|CHECK constraint failed|FOREIGN KEY constraint failed/i.test(message)) {
    return new StorageError('invalid_input', 'The website was rejected by the database constraints');
  }

  return null;
}

export class D1StorageAdapter implements StorageAdapter {
  private readonly _db: D1Database;

  constructor(db: D1Database) {
    this._db = db;
  }

  private async _query<T>(operation: () => Promise<T>, slug?: string): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const constraintError = mapConstraintError(error, slug);

      if (constraintError) {
        throw constraintError;
      }

      console.error('[storage/d1] the website database could not be reached', errorMessage(error));

      throw new StorageError('unavailable', 'The website database is currently unavailable');
    }
  }

  async health(): Promise<boolean> {
    try {
      await this._db.prepare('SELECT 1 AS ok').first();
      await this._db.prepare('SELECT id FROM website_projects LIMIT 1').first();

      return true;
    } catch {
      return false;
    }
  }

  async listWebsites(ctx: TenantContext): Promise<Website[]> {
    const result = await this._query(() =>
      this._db
        .prepare(
          `SELECT ${WEBSITE_COLUMNS} FROM website_projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
        )
        .bind(ctx.userId)
        .all<WebsiteRow>(),
    );

    return result.results.map(rowToWebsite);
  }

  async getWebsite(id: string, ctx: TenantContext): Promise<Website | null> {
    const row = await this._query(() =>
      this._db
        .prepare(`SELECT ${WEBSITE_COLUMNS} FROM website_projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
        .bind(id, ctx.userId)
        .first<WebsiteRow>(),
    );

    return row ? rowToWebsite(row) : null;
  }

  async createWebsite(ctx: TenantContext, input: WebsiteInput): Promise<Website> {
    const slug = assertValidSlug(input.slug);
    const name = input.name?.trim() ?? '';

    if (!name) {
      throw new StorageError('invalid_input', 'A website name is required');
    }

    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();

    await this._query(
      () =>
        this._db
          .prepare(
            `INSERT INTO website_projects (
               id, user_id, name, slug, template_id, theme_json, domain, deploy_target,
               deploy_config_json, status, deleted_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`,
          )
          .bind(
            id,
            ctx.userId,
            name,
            slug,
            input.templateId ?? null,
            input.themeJson ?? '{}',
            input.domain ?? null,
            input.deployTarget ?? null,
            input.deployConfigJson ?? '{}',
            timestamp,
            timestamp,
          )
          .run(),
      slug,
    );

    const created = await this.getWebsite(id, ctx);

    if (!created) {
      throw new StorageError('unexpected', 'The website was written but could not be read back');
    }

    return created;
  }

  async updateWebsite(id: string, ctx: TenantContext, patch: WebsitePatch): Promise<Website> {
    const existing = await this.getWebsite(id, ctx);

    if (!existing) {
      throw new StorageError('not_found', `Website '${id}' was not found`);
    }

    const slug = patch.slug === undefined ? existing.slug : assertValidSlug(patch.slug);

    const assignments: string[] = [];
    const values: unknown[] = [];

    if (patch.name !== undefined) {
      assignments.push('name = ?');
      values.push(patch.name.trim());
    }

    if (patch.slug !== undefined) {
      assignments.push('slug = ?');
      values.push(slug);
    }

    if (patch.templateId !== undefined) {
      assignments.push('template_id = ?');
      values.push(patch.templateId);
    }

    if (patch.themeJson !== undefined) {
      assignments.push('theme_json = ?');
      values.push(patch.themeJson);
    }

    if (patch.domain !== undefined) {
      assignments.push('domain = ?');
      values.push(patch.domain);
    }

    if (patch.deployTarget !== undefined) {
      assignments.push('deploy_target = ?');
      values.push(patch.deployTarget);
    }

    if (patch.deployConfigJson !== undefined) {
      assignments.push('deploy_config_json = ?');
      values.push(patch.deployConfigJson);
    }

    if (patch.status !== undefined) {
      assignments.push('status = ?');
      values.push(patch.status);
    }

    assignments.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id, ctx.userId);

    const result = await this._query(
      () =>
        this._db
          .prepare(
            `UPDATE website_projects SET ${assignments.join(', ')} WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
          )
          .bind(...values)
          .run(),
      slug,
    );

    if ((result.meta?.changes ?? 0) === 0) {
      throw new StorageError('not_found', `Website '${id}' was not found`);
    }

    const updated = await this.getWebsite(id, ctx);

    if (!updated) {
      throw new StorageError('not_found', `Website '${id}' was not found`);
    }

    return updated;
  }

  async deleteWebsite(id: string, ctx: TenantContext): Promise<void> {
    const timestamp = new Date().toISOString();

    const result = await this._query(() =>
      this._db
        .prepare(
          `UPDATE website_projects SET deleted_at = ?, status = 'archived', updated_at = ?
           WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        )
        .bind(timestamp, timestamp, id, ctx.userId)
        .run(),
    );

    if ((result.meta?.changes ?? 0) === 0) {
      throw new StorageError('not_found', `Website '${id}' was not found`);
    }
  }
}
