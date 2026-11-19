import { hubConfigured, zapListApprovals } from '~/lib/hub.server';
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
    const result = await zapListApprovals();
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load approvals' },
      { status: 502 },
    );
  }
}
