import { hubConfigured, zapCancelJob, zapPauseJob, zapResumeJob } from '~/lib/hub.server';
import { requireAccess } from '~/lib/whop.server';

export async function action({ request, params }: { request: Request; params: { jobId?: string } }) {
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

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = (await request.json().catch(() => ({}))) as { action?: string; reason?: string };

  try {
    if (body.action === 'cancel') {
      const result = await zapCancelJob(params.jobId);
      return Response.json(result.data, { status: result.status });
    }

    if (body.action === 'resume') {
      const result = await zapResumeJob(params.jobId);
      return Response.json(result.data, { status: result.status });
    }

    if (body.action === 'pause') {
      const result = await zapPauseJob(params.jobId, body.reason);
      return Response.json(result.data, { status: result.status });
    }

    return Response.json({ error: 'action must be cancel, resume or pause' }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to update the job' },
      { status: 502 },
    );
  }
}
