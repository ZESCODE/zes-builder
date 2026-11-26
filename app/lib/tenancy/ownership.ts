/**
 * Tenant ownership helpers.
 *
 * The tenant identity is the Whop principal produced by `callerPrincipal`
 * (see `~/lib/whop.server`). It is opaque and case-sensitive as far as this
 * layer is concerned: helpers compare it verbatim and never normalize it.
 */

import { StorageError } from '~/lib/storage/contract';
import type { TenantContext, Website } from '~/lib/storage/contract';

/** Builds a tenant context from a principal, rejecting an empty identity. */
export function tenantContext(userId: string): TenantContext {
  const trimmed = typeof userId === 'string' ? userId.trim() : '';

  if (!trimmed) {
    throw new StorageError('invalid_input', 'A tenant user id is required');
  }

  return { userId };
}

/** Validates a tenant context before it reaches the storage layer. */
export function assertTenantContext(ctx: TenantContext): TenantContext {
  if (!ctx || typeof ctx.userId !== 'string' || !ctx.userId.trim()) {
    throw new StorageError('invalid_input', 'A tenant user id is required');
  }

  return ctx;
}

/** True when the website belongs to the tenant in the context. */
export function ownsWebsite(website: Pick<Website, 'userId'> | null | undefined, ctx: TenantContext): boolean {
  if (!website) {
    return false;
  }

  return website.userId === ctx.userId;
}

/**
 * Throws `not_found` when the website is missing or owned by another tenant.
 *
 * Cross-tenant access reports the same error as a missing row so that website
 * ids cannot be enumerated.
 */
export function assertWebsiteOwnership(
  website: Pick<Website, 'userId'> | null | undefined,
  ctx: TenantContext,
  id: string,
): void {
  if (!ownsWebsite(website, ctx)) {
    throw new StorageError('not_found', `Website '${id}' was not found`);
  }
}
