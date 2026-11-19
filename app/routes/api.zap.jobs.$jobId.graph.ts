import { hubConfigured, zapJobGraph, zapPauseJob, zapResumeJob } from '~/lib/hub.server';

export async function loader({ params }: { params: { jobId?: string } }) {
  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)' }, { status: 503 });
  }

  if (!params.jobId) {
    return Response.json({ error: 'jobId is required' }, { status: 400 });
  }

  try {
    const result = await zapJobGraph(params.jobId);
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Failed to load graph' }, { status: 502 });
  }
}

export async function action({ request, params }: { request: Request; params: { jobId?: string } }) {
  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)' }, { status: 503 });
  }

  if (!params.jobId) {
    return Response.json({ error: 'jobId is required' }, { status: 400 });
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = (await request.json().catch(() => ({}))) as { action?: string; reason?: string };

  try {
    const result =
      body.action === 'resume' ? await zapResumeJob(params.jobId) : await zapPauseJob(params.jobId, body.reason);

    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Failed to update job' }, { status: 502 });
  }
}
