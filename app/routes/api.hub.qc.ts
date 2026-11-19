import { hubConfigured, qcCheck } from '~/lib/hub.server';
import { requireAccess } from '~/lib/whop.server';

export async function action({ request }: { request: Request }) {
  const denied = await requireAccess(request);

  if (denied) {
    return denied;
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { imageUrl?: string; prompt?: string };

  if (!body.imageUrl) {
    return Response.json({ error: 'imageUrl is required' }, { status: 400 });
  }

  try {
    const result = await qcCheck(body.imageUrl, body.prompt);
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'QC request failed' }, { status: 502 });
  }
}
