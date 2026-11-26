/**
 * Canonical tenant principal — Phase 1C.1.
 *
 * ## Why this module exists
 *
 * `callerPrincipal()` in `~/lib/whop.server` builds the Hub principal
 * `whop:<userId>` and **lower-cases** it (`app/lib/whop.server.ts:275`). Case
 * folding is lossy: two Whop identifiers that differ only in case collapse into
 * one tenant key, and a collapsed key would give both identities access to each
 * other's websites.
 *
 * The storage layer never normalises the tenant it is given — the contract
 * documents the principal as opaque and compares it verbatim
 * (`app/lib/storage/contract.ts:19-27`, `app/lib/tenancy/ownership.ts:33-39`).
 * The CMS storage path therefore uses the canonical, case-preserving principal
 * defined here.
 *
 * ## What was verified before choosing this format
 *
 * 1. **Whop identifier case-sensitivity.** Whop's OAuth user-info endpoint
 *    returns the account identifier under `sub` / `user_id` / `id`
 *    (`app/lib/whop.server.ts:195-212`). Whop documents the value as an opaque
 *    account identifier and does not promise a case-insensitive comparison, so
 *    it is treated as opaque and case-sensitive. Folding the case is therefore
 *    not required by the provider and can only lose information.
 * 2. **Existing tenant representation.** The Hub receives the lower-cased
 *    principal through the `X-ZES-User` header (`app/lib/hub.server.ts:17-36`),
 *    and the Hub is the authoritative orchestration system. `callerPrincipal()`
 *    is deliberately left unchanged so that workflows and runs created under
 *    the existing format keep resolving.
 * 3. **Stored data.** The D1 database is empty (`users = 0`,
 *    `website_projects = 0`), so no stored tenant key has to be migrated and no
 *    historical row is shadowed by the format change.
 *
 * ## Canonical format
 *
 * ```
 * whop:<trimmed whop account identifier>
 * ```
 *
 * The identifier is trimmed and validated against a strict character set. It is
 * **not** lower-cased, so distinct identifiers stay distinct.
 */

export const TENANT_PRINCIPAL_PREFIX = 'whop:';

const PRINCIPAL_ID_PATTERN = /^[A-Za-z0-9._:@+-]{1,200}$/;

/**
 * Builds the canonical tenant principal for a Whop account identifier.
 *
 * The identifier is trimmed and validated but never case-folded.
 */
export function canonicalPrincipal(userId: string): string {
  const trimmed = typeof userId === 'string' ? userId.trim() : '';

  if (!trimmed) {
    throw new Error('A tenant user id is required');
  }

  if (!PRINCIPAL_ID_PATTERN.test(trimmed)) {
    throw new Error('The tenant user id contains unsupported characters');
  }

  return `${TENANT_PRINCIPAL_PREFIX}${trimmed}`;
}

/** True when the value already is a canonical principal. */
export function isCanonicalPrincipal(value: string): boolean {
  if (!value.startsWith(TENANT_PRINCIPAL_PREFIX)) {
    return false;
  }

  return PRINCIPAL_ID_PATTERN.test(value.slice(TENANT_PRINCIPAL_PREFIX.length));
}

/**
 * Extracts the account identifier from a canonical principal.
 *
 * The identifier is returned verbatim; no normalisation is applied.
 */
export function principalAccountId(principal: string): string {
  if (!isCanonicalPrincipal(principal)) {
    throw new Error('The tenant principal is malformed');
  }

  return principal.slice(TENANT_PRINCIPAL_PREFIX.length);
}
