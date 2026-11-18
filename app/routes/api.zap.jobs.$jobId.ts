import { hubConfigured, zapGetJob, zapJobUsage } from '~/lib/hub.server';

export async function loader({ params }: { params: { jobId?: string } }) {
  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)' }, { status: 503 });
  }

  if (!params.jobId) {
    return Response.json({ error: 'jobId is required' }, { status: 400 });
  }

  try {
    const [job, usage] = await Promise.all([zapGetJob(params.jobId), zapJobUsage(params.jobId)]);

    if (job.status >= 400) {
      return Response.json(job.data, { status: job.status });
    }

    return Response.json({ job: job.data, usage: usage.status < 400 ? usage.data : null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Failed to load job' }, { status: 502 });
  }
}
