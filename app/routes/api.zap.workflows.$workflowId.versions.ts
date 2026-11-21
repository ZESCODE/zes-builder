import { hubConfigured, zapWorkflowVersions } from '~/lib/hub.server';
import { callerPrincipal, requireAccess } from '~/lib/whop.server';

export async function loader({ request, params }: { request: Request; params: { workflowId?: string } }) {
  const denied = await requireAccess(request);

  if (denied) {
    return denied;
  }

  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)' }, { status: 503 });
  }

  if (!params.workflowId) {
    return Response.json({ error: 'workflowId is required' }, { status: 400 });
  }

  try {
    const result = await zapWorkflowVersions(params.workflowId, await callerPrincipal(request));
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load versions' },
      { status: 502 },
    );
  }
}
