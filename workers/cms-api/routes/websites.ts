/**
 * Website API of the CMS API Worker.
 *
 * The handler reuses the existing Phase 1A/1B storage layer unchanged: the
 * `D1StorageAdapter` for persistence, the `WebsiteStorageService` for the
 * business rules (tenant validation, payload validation, fail-closed backend)
 * and the shared zod schemas for the request payload. No rule is duplicated
 * here.
 *
 * The tenant comes from the verified tenant assertion and never from the
 * request payload, the query string or an unsigned header.
 */

import type { CmsApiEnv } from '../env.ts';
import { errorResponse, jsonResponse } from '../http.ts';
import { WebsiteStorageService } from '~/lib/cms/storage';
import { websitePatchSchema, websitePayloadSchema } from '~/lib/cms/websites.schema';
import { D1StorageAdapter } from '~/lib/storage/adapters/d1';
import { StorageError } from '~/lib/storage/contract';

export interface WebsiteRouteContext {
  request: Request;
  env: CmsApiEnv;
  tenant: string;
  requestId: string;
  body: Uint8Array;
}

function parseJson(body: Uint8Array): unknown {
  if (body.byteLength === 0) {
    return null;
  }

  const text = new TextDecoder().decode(body);

  return JSON.parse(text);
}

function storageFailure(error: unknown, requestId: string): Response {
  if (error instanceof StorageError) {
    return errorResponse(error.status, error.code, error.message, requestId);
  }

  return errorResponse(500, 'unexpected', 'The request could not be completed', requestId);
}

function invalidInput(details: unknown, requestId: string): Response {
  return errorResponse(400, 'invalid_input', 'Invalid input', requestId);
}

/** Routes a website request to the storage service. */
export async function handleWebsites(context: WebsiteRouteContext, websiteId?: string): Promise<Response> {
  const { request, env, tenant, requestId } = context;

  if (!env.DB) {
    return errorResponse(503, 'unavailable', 'The storage backend is unavailable', requestId);
  }

  const service = new WebsiteStorageService(new D1StorageAdapter(env.DB));

  if (websiteId === undefined) {
    if (request.method === 'GET') {
      try {
        const websites = await service.listWebsites({ userId: tenant });

        return jsonResponse({ websites }, 200, requestId);
      } catch (error) {
        return storageFailure(error, requestId);
      }
    }

    if (request.method === 'POST') {
      let payload: unknown;

      try {
        payload = parseJson(context.body);
      } catch {
        return errorResponse(400, 'invalid_input', 'The request body is not valid JSON', requestId);
      }

      const parsed = websitePayloadSchema.safeParse(payload);

      if (!parsed.success) {
        return invalidInput(parsed.error.issues, requestId);
      }

      try {
        const website = await service.createWebsite({ userId: tenant }, parsed.data);

        return jsonResponse({ website }, 201, requestId);
      } catch (error) {
        return storageFailure(error, requestId);
      }
    }

    return errorResponse(405, 'method_not_allowed', 'Method not allowed', requestId);
  }

  if (request.method === 'GET') {
    try {
      const website = await service.getWebsite(websiteId, { userId: tenant });

      if (!website) {
        return errorResponse(404, 'not_found', `Website '${websiteId}' was not found`, requestId);
      }

      return jsonResponse({ website }, 200, requestId);
    } catch (error) {
      return storageFailure(error, requestId);
    }
  }

  if (request.method === 'PATCH') {
    let payload: unknown;

    try {
      payload = parseJson(context.body);
    } catch {
      return errorResponse(400, 'invalid_input', 'The request body is not valid JSON', requestId);
    }

    const parsed = websitePatchSchema.safeParse(payload);

    if (!parsed.success) {
      return invalidInput(parsed.error.issues, requestId);
    }

    try {
      const website = await service.updateWebsite(websiteId, { userId: tenant }, parsed.data);

      return jsonResponse({ website }, 200, requestId);
    } catch (error) {
      return storageFailure(error, requestId);
    }
  }

  if (request.method === 'DELETE') {
    try {
      await service.deleteWebsite(websiteId, { userId: tenant });

      return jsonResponse({ ok: true }, 200, requestId);
    } catch (error) {
      return storageFailure(error, requestId);
    }
  }

  return errorResponse(405, 'method_not_allowed', 'Method not allowed', requestId);
}
