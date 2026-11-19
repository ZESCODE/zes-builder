import { hubConfigured, zapPublishWorkflow } from '~/lib/hub.server';

export async function action({ request, params }: { request: Request; params: { workflowId?: string } }) {
  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)' }, { status: 503 });
  }

  if (!params.workflowId) {
    return Response.json({ error: 'workflowId is required' }, { status: 400 });
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = (await request.json().catch(() => ({}))) as { version?: number };

  try {
    const result = await zapPublishWorkflow(params.workflowId, body.version);
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to publish workflow' },
      { status: 502 },
    );
  }
}
