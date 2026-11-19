import { hubConfigured, zapJobTasks } from '~/lib/hub.server';
import { requireAccess } from '~/lib/whop.server';

export async function loader({ request, params }: { request: Request; params: { jobId?: string } }) {
  const denied = await requireAccess(request);

  if (denied) {
    return denied;
  }

  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)' }, { status: 503 });
  }

  if (!params.jobId) {
    return Response.json({ error: 'jobId is required' }, { status: 400 });
  }

  try {
    const result = await zapJobTasks(params.jobId);
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Failed to load tasks' }, { status: 502 });
  }
}
