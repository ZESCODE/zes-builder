/**
 * Health endpoint of the CMS API Worker.
 *
 * The endpoint proves that the Worker is running and that the D1 binding is
 * usable. It returns the minimum: no configuration, no identifiers, no SQL and
 * no error detail. It is intentionally not authenticated, because a health
 * probe must work without credentials, and it exposes nothing that would help
 * an attacker.
 */

import type { CmsApiEnv } from '../env.ts';
import { jsonResponse } from '../http.ts';
import { D1StorageAdapter } from '~/lib/storage/adapters/d1';

export async function handleHealth(env: CmsApiEnv, requestId: string): Promise<Response> {
  if (!env.DB) {
    return jsonResponse({ status: 'unavailable', database: 'unavailable', requestId }, 503, requestId);
  }

  const healthy = await new D1StorageAdapter(env.DB).health();

  if (!healthy) {
    return jsonResponse({ status: 'unavailable', database: 'unavailable', requestId }, 503, requestId);
  }

  return jsonResponse({ status: 'ok', database: 'ok', requestId }, 200, requestId);
}
