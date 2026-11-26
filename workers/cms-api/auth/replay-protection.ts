/**
 * Shared, durable replay protection for tenant assertions.
 *
 * A timestamp alone does not prevent replay: a captured assertion stays valid
 * until its window expires. Every assertion therefore carries a random nonce,
 * and the Worker records it in D1 before it executes the request. The nonce is
 * the primary key, so a second use of the same nonce fails with a unique
 * constraint violation — in every isolate, on every edge location, and across
 * deployments. An isolate-local `Map` cannot do this: each Worker isolate has
 * its own memory, so a replayed request could land on a different isolate and
 * be accepted.
 *
 * The table is append-only in practice: expired rows are purged by a bounded
 * delete, which keeps the table proportional to the number of assertions inside
 * the validity window rather than to the total request count.
 */

import type { D1Database } from '~/lib/storage/adapters/d1';

export const NONCE_TABLE = 'cms_assertion_nonces';

export interface ReplaySuccess {
  ok: true;
}

export interface ReplayFailure {
  ok: false;
  code: 'replayed_nonce' | 'unavailable';
  message: string;
}

export type ReplayResult = ReplaySuccess | ReplayFailure;

/** Milliseconds after which a nonce row may be purged. */
export const NONCE_RETENTION_MS = 10 * 60 * 1000;

function isUniqueViolation(message: string): boolean {
  return /UNIQUE constraint failed|constraint failed: cms_assertion_nonces/i.test(message);
}

/**
 * Records the nonce of an assertion.
 *
 * The nonce is consumed *before* the request is executed: a request that fails
 * afterwards cannot be retried with the same assertion, because the caller has
 * to issue a new one. That is the safer trade-off — it guarantees at-most-once
 * execution.
 */
export async function consumeNonce(
  db: D1Database,
  nonce: string,
  tenant: string,
  now: number = Date.now(),
): Promise<ReplayResult> {
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + NONCE_RETENTION_MS).toISOString();

  try {
    await db
      .prepare(`INSERT INTO ${NONCE_TABLE} (nonce, tenant, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .bind(nonce, tenant, createdAt, expiresAt)
      .run();

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (isUniqueViolation(message)) {
      return { ok: false, code: 'replayed_nonce', message: 'The request assertion has already been used' };
    }

    return { ok: false, code: 'unavailable', message: 'The replay protection store is unavailable' };
  }
}

/** Removes expired nonce rows. Safe to call at any time. */
export async function purgeExpiredNonces(db: D1Database, now: number = Date.now()): Promise<void> {
  const cutoff = new Date(now).toISOString();

  try {
    await db.prepare(`DELETE FROM ${NONCE_TABLE} WHERE expires_at < ?`).bind(cutoff).run();
  } catch {
    // A failed purge only delays the cleanup; it must never fail a request.
  }
}
