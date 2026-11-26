/**
 * Phase 1A storage contract.
 *
 * Scope: website CRUD, tenant isolation and safe local persistence only.
 * D1, media, domains, CMS articles, publishing and Hub integration are out of
 * scope for this milestone.
 *
 * Every storage method receives an explicit {@link TenantContext}. No method
 * infers the tenant from ambient state, and no method accepts a tenant identity
 * from a request payload: the tenant is derived from the authenticated Whop
 * session by the caller and travels through the context.
 */

export type WebsiteStatus = 'active' | 'archived';

export type DeployTarget = 'cloudflare' | 'netlify' | 'vercel' | 'custom' | 'zes-cms';

/**
 * Tenant identity for one storage operation.
 *
 * `userId` is the canonical tenant identity (the Whop principal). It is opaque:
 * it is never lowercased, normalized or converted into an email by the storage
 * layer, and it is never taken from an untrusted request body.
 */
export interface TenantContext {
  userId: string;
  websiteId?: string;
}

/** A stored website project. */
export interface Website {
  id: string;
  userId: string;
  name: string;
  slug: string;
  templateId?: string;

  /** Theme definition as validated JSON text. */
  themeJson: string;
  domain?: string;
  deployTarget?: DeployTarget;

  /** Deployment configuration as validated JSON text. */
  deployConfigJson: string;
  status: WebsiteStatus;

  /** Set by `deleteWebsite`; the row is retained, not removed. */
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fields accepted when creating a website.
 *
 * The tenant is not part of the input: it comes from the tenant context.
 */
export interface WebsiteInput {
  name: string;
  slug: string;
  templateId?: string;
  themeJson?: string;
  domain?: string;
  deployTarget?: DeployTarget;
  deployConfigJson?: string;
}

/** Fields accepted when updating a website. Absent fields are left unchanged. */
export interface WebsitePatch {
  name?: string;
  slug?: string;
  templateId?: string;
  themeJson?: string;
  domain?: string;
  deployTarget?: DeployTarget;
  deployConfigJson?: string;
  status?: WebsiteStatus;
}

/**
 * Typed storage failures.
 *
 * - `not_found`      — the website does not exist, or belongs to another tenant.
 * - `duplicate_slug` — the tenant already owns an active website with that slug.
 * - `invalid_input`  — the payload violates the storage contract.
 * - `unavailable`    — the backend is unreachable, unconfigured or unreadable.
 * - `unexpected`     — any other storage failure.
 */
export type StorageErrorCode = 'not_found' | 'duplicate_slug' | 'invalid_input' | 'unavailable' | 'unexpected';

const STORAGE_ERROR_STATUS: Record<StorageErrorCode, number> = {
  not_found: 404,
  duplicate_slug: 409,
  invalid_input: 400,
  unavailable: 503,
  unexpected: 500,
};

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly status: number;

  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.status = STORAGE_ERROR_STATUS[code];
  }
}

/**
 * Storage backend contract.
 *
 * Implementations must scope every read and write to the tenant in the context.
 * A website owned by another tenant must be indistinguishable from a website
 * that does not exist (`not_found`), so resource ids cannot be enumerated.
 */
export interface StorageAdapter {
  /** False when the backend is unreachable or unusable; callers fail closed. */
  health(): Promise<boolean>;

  /** Active (not soft-deleted) websites owned by the tenant. */
  listWebsites(ctx: TenantContext): Promise<Website[]>;

  /** One website owned by the tenant, or null when missing or cross-tenant. */
  getWebsite(id: string, ctx: TenantContext): Promise<Website | null>;

  /** Creates a website owned by the tenant and returns the stored record. */
  createWebsite(ctx: TenantContext, input: WebsiteInput): Promise<Website>;

  /** Updates a website owned by the tenant; throws `not_found` otherwise. */
  updateWebsite(id: string, ctx: TenantContext, patch: WebsitePatch): Promise<Website>;

  /**
   * Soft delete: the row is retained with `deletedAt` set and drops out of the
   * tenant's website list. The slug becomes reusable.
   */
  deleteWebsite(id: string, ctx: TenantContext): Promise<void>;
}
