import { hubConfigured, zapPlanJob, zapRunNext } from '~/lib/hub.server';

export async function action({ request, params }: { request: Request; params: { jobId?: string } }) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)' }, { status: 503 });
  }

  if (!params.jobId) {
    return Response.json({ error: 'jobId is required' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { action?: string; template?: string };

  try {
    if (body.action === 'run') {
      const result = await zapRunNext(params.jobId);

      return Response.json(result.data, { status: result.status });
    }

    const result = await zapPlanJob(params.jobId, body.template);

    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Orchestration request failed' },
      { status: 502 },
    );
  }
}
