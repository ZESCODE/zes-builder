import { hubConfigured, zapCreateJob } from '~/lib/hub.server';
import { callerPrincipal, requireAccess } from '~/lib/whop.server';

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

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    objective?: string;
    workflowType?: string;
    workflowId?: string;
    workflowVersion?: number;
  };

  if (!body.title || !body.objective) {
    return Response.json({ error: 'title and objective are required' }, { status: 400 });
  }

  try {
    const result = await zapCreateJob(
      {
        title: body.title,
        objective: body.objective,
        workflowType: body.workflowType,
        workflowId: body.workflowId,
        workflowVersion: body.workflowVersion,
      },
      await callerPrincipal(request),
    );

    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Failed to create job' }, { status: 502 });
  }
}
