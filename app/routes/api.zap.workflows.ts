import { hubConfigured, zapCreateWorkflow, zapListWorkflows } from '~/lib/hub.server';

export async function loader() {
  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)' }, { status: 503 });
  }

  try {
    const result = await zapListWorkflows();
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load workflows' },
      { status: 502 },
    );
  }
}

export async function action({ request }: { request: Request }) {
  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)' }, { status: 503 });
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'A workflow definition is required' }, { status: 400 });
  }

  try {
    const result = await zapCreateWorkflow(body);
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to create workflow' },
      { status: 502 },
    );
  }
}
