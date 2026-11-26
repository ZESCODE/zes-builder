/**
 * CMS API Worker — the dedicated Cloudflare Worker that owns the D1 database.
 *
 * The Worker is intentionally small and independent. It imports the storage
 * contract, the D1 adapter, the website storage service, the shared request
 * schemas and the tenant assertion helpers — and nothing else. It never
 * imports the React Router server build, the Hub client, the MCP services or
 * any Node-only module.
 *
 * Request flow:
 *
 * 1. The request id is resolved (propagated from the caller or generated).
 * 2. `GET /api/health` answers without authentication and proves that the D1
 *    binding works.
 * 3. Every other request is authenticated twice: the bearer token proves the
 *    service, the signed tenant assertion proves the tenant and binds it to
 *    this exact method, path, body and moment.
 * 4. The nonce of the assertion is consumed in D1, which makes a replayed
 *    request fail even when it reaches a different isolate.
 * 5. The request is routed to the website API, which reuses the existing
 *    storage service.
 *
 * Everything fails closed: an absent D1 binding, a wrong service token, an
 * invalid or expired assertion, a replayed nonce or a missing tenant context
 * stops the request before it reaches the database.
 */

import { authenticateRequest } from './auth/assertion.ts';
import { consumeNonce, purgeExpiredNonces } from './auth/replay-protection.ts';
import type { CmsApiEnv } from './env.ts';
import { errorResponse, resolveRequestId } from './http.ts';
import { handleHealth } from './routes/health.ts';
import { handleWebsites } from './routes/websites.ts';
import { isCanonicalPrincipal } from '~/lib/tenancy/principal';

const WEBSITE_PATH_PATTERN = /^\/api\/websites\/([^/]+)$/;

/** Probability of purging expired nonces after a successful request. */
const PURGE_PROBABILITY = 0.05;

export default {
  async fetch(request: Request, env: CmsApiEnv, ctx: ExecutionContext): Promise<Response> {
    const requestId = resolveRequestId(request);
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return errorResponse(405, 'method_not_allowed', 'Method not allowed', requestId);
      }

      return handleHealth(env, requestId);
    }

    if (!env.DB) {
      return errorResponse(503, 'unavailable', 'The storage backend is unavailable', requestId);
    }

    if (url.search) {
      return errorResponse(400, 'query_not_allowed', 'Query parameters are not supported', requestId);
    }

    let body: Uint8Array;

    try {
      body = new Uint8Array(await request.arrayBuffer());
    } catch {
      return errorResponse(400, 'invalid_request', 'The request body could not be read', requestId);
    }

    const authentication = await authenticateRequest(request, env, body, path);

    if (!authentication.ok) {
      return errorResponse(401, authentication.code, authentication.message, requestId);
    }

    if (!isCanonicalPrincipal(authentication.tenant)) {
      return errorResponse(401, 'invalid_assertion', 'The request assertion carries an invalid tenant', requestId);
    }

    const replay = await consumeNonce(env.DB, authentication.nonce, authentication.tenant);

    if (!replay.ok) {
      if (replay.code === 'replayed_nonce') {
        return errorResponse(401, replay.code, replay.message, requestId);
      }

      return errorResponse(503, replay.code, 'The request could not be verified', requestId);
    }

    if (Math.random() < PURGE_PROBABILITY) {
      ctx.waitUntil(purgeExpiredNonces(env.DB));
    }

    const context = {
      request,
      env,
      tenant: authentication.tenant,
      requestId,
      body,
    };

    if (path === '/api/websites') {
      return handleWebsites(context);
    }

    const websiteMatch = WEBSITE_PATH_PATTERN.exec(path);

    if (websiteMatch) {
      return handleWebsites(context, decodeURIComponent(websiteMatch[1] as string));
    }

    return errorResponse(404, 'not_found', 'Not found', requestId);
  },
} satisfies ExportedHandler<CmsApiEnv>;
