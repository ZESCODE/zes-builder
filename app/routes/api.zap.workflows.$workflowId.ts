import { hubConfigured, zapGetWorkflow, zapUpdateWorkflow } from '~/lib/hub.server';
import { requireAccess } from '~/lib/whop.server';

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
    const result = await zapGetWorkflow(params.workflowId);
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load workflow' },
      { status: 502 },
    );
  }
}

export async function action({ request, params }: { request: Request; params: { workflowId?: string } }) {
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

  if (request.method !== 'PUT') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'A workflow definition is required' }, { status: 400 });
  }

  try {
    const result = await zapUpdateWorkflow(params.workflowId, body);
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to update workflow' },
      { status: 502 },
    );
  }
}
