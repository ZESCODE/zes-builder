/**
 * Website CRUD — list and create.
 *
 * The route is a thin, authenticated proxy to the CMS API Worker. The Worker
 * owns the database; this side owns the session, the access gate and the
 * browser protections. The tenant principal is derived from the authenticated
 * Whop session inside the proxy — a `userId` in the request body is never
 * trusted, and the payload schema of the Worker rejects unknown fields.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { proxyToCmsApi } from '~/lib/cms/proxy.server';
import { requireAccess } from '~/lib/whop.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const denied = await requireAccess(request);

  if (denied) {
    return denied;
  }

  return proxyToCmsApi({ request, method: 'GET', path: '/api/websites' });
}

export async function action({ request }: ActionFunctionArgs) {
  const denied = await requireAccess(request);

  if (denied) {
    return denied;
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed', code: 'method_not_allowed' }, { status: 405 });
  }

  const body = await request.text();

  return proxyToCmsApi({ request, method: 'POST', path: '/api/websites', body });
}
