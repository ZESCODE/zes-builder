import { hubConfigured, zapDecideApproval } from '~/lib/hub.server';
import { readSession, requireAccess } from '~/lib/whop.server';

export async function action({ request, params }: { request: Request; params: { approvalId?: string } }) {
  const denied = await requireAccess(request);

  if (denied) {
    return denied;
  }

  if (!hubConfigured()) {
    return Response.json({ error: 'Hub is not configured (AGORA_HUB_ADMIN_KEY)' }, { status: 503 });
  }

  if (!params.approvalId) {
    return Response.json({ error: 'approvalId is required' }, { status: 400 });
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    decision?: string;
    decidedBy?: string;
    reason?: string;
  };

  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return Response.json({ error: 'decision must be approve or reject' }, { status: 400 });
  }

  const session = await readSession(request);
  const decidedBy = body.decidedBy || session?.username || 'operator@zes.codes';

  try {
    const result = await zapDecideApproval(params.approvalId, body.decision, decidedBy, body.reason);
    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to record the decision' },
      { status: 502 },
    );
  }
}
