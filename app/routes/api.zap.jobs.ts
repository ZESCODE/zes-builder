import { hubConfigured, zapListJobs } from '~/lib/hub.server';

export async function loader() {
  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)', jobs: [] }, { status: 503 });
  }

  try {
    const result = await zapListJobs();

    if (result.status >= 400) {
      return Response.json(result.data, { status: result.status });
    }

    return Response.json(result.data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Failed to load jobs' }, { status: 502 });
  }
}
