import { hubConfigured, zapNodeTypes } from '~/lib/hub.server';
import { requireAccess } from '~/lib/whop.server';

export async function loader({ request }: { request: Request }) {
  const denied = await requireAccess(request);

  if (denied) {
    return denied;
  }

  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)' }, { status: 503 });
  }

  try {
    const result = await zapNodeTypes();
    return Response.json(result.data, {
      status: result.status,
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load node types' },
      { status: 502 },
    );
  }
}
