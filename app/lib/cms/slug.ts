/**
 * Slug validation and uniqueness rules.
 *
 * A slug identifies a website inside one tenant. It is lowercase, URL-safe and
 * stable, so it is validated rather than rewritten: an invalid slug is rejected
 * with `invalid_input` instead of being silently transformed.
 *
 * Uniqueness is per tenant and applies to active websites only. A soft-deleted
 * website releases its slug, which mirrors the partial unique index planned for
 * the D1 schema (`WHERE deleted_at IS NULL`).
 */

import { StorageError } from '~/lib/storage/contract';

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 63;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Minimal shape of a stored website needed to evaluate slug uniqueness. */
export interface SlugCandidate {
  id?: string;
  userId: string;
  slug: string;
  deletedAt?: string;
}

/** True when the slug matches the accepted format and length. */
export function isValidSlug(slug: unknown): slug is string {
  if (typeof slug !== 'string') {
    return false;
  }

  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
    return false;
  }

  return SLUG_PATTERN.test(slug);
}

/** Returns the slug when valid, otherwise throws `invalid_input`. */
export function assertValidSlug(slug: unknown): string {
  if (!isValidSlug(slug)) {
    throw new StorageError(
      'invalid_input',
      `A slug must be ${SLUG_MIN_LENGTH}-${SLUG_MAX_LENGTH} lowercase characters, digits or single hyphens`,
    );
  }

  return slug;
}

/**
 * True when no active website of the tenant already uses the slug.
 *
 * `excludeId` ignores the website currently being updated, so re-saving a
 * website without changing its slug is not a duplicate.
 */
export function slugIsUnique(
  websites: SlugCandidate[],
  params: { userId: string; slug: string; excludeId?: string },
): boolean {
  return !websites.some(
    (website) =>
      website.userId === params.userId &&
      website.slug === params.slug &&
      !website.deletedAt &&
      website.id !== params.excludeId,
  );
}
