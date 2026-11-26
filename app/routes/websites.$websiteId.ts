/**
 * Website CRUD — read, update and soft-delete.
 *
 * The route is a thin, authenticated proxy to the CMS API Worker. The Worker
 * owns the database; this side owns the session, the access gate and the
 * browser protections. A website owned by another tenant is reported as
 * `404 not found`, so website ids cannot be enumerated.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { proxyToCmsApi } from '~/lib/cms/proxy.server';
import { requireAccess } from '~/lib/whop.server';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const denied = await requireAccess(request);

  if (denied) {
    return denied;
  }

  const { websiteId } = params;

  if (!websiteId) {
    return Response.json({ error: 'websiteId is required', code: 'invalid_input' }, { status: 400 });
  }

  return proxyToCmsApi({
    request,
    method: 'GET',
    path: `/api/websites/${encodeURIComponent(websiteId)}`,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const denied = await requireAccess(request);

  if (denied) {
    return denied;
  }

  const { websiteId } = params;

  if (!websiteId) {
    return Response.json({ error: 'websiteId is required', code: 'invalid_input' }, { status: 400 });
  }

  const path = `/api/websites/${encodeURIComponent(websiteId)}`;

  if (request.method === 'DELETE') {
    return proxyToCmsApi({ request, method: 'DELETE', path });
  }

  if (request.method !== 'PATCH') {
    return Response.json({ error: 'Method not allowed', code: 'method_not_allowed' }, { status: 405 });
  }

  const body = await request.text();

  return proxyToCmsApi({ request, method: 'PATCH', path, body });
}
