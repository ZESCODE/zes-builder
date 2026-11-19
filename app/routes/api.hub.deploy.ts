import { deployFree, deployPremium, hubConfigured } from '~/lib/hub.server';
import { requireAccess } from '~/lib/whop.server';

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
    kind?: 'free' | 'premium';
    title?: string;
    niche?: string;
    templateId?: string;
    framework?: string;
    deployTarget?: 'vercel' | 'cloudflare';
  };

  if (!body.title || !body.niche) {
    return Response.json({ error: 'title and niche are required' }, { status: 400 });
  }

  try {
    const result =
      body.kind === 'premium'
        ? await deployPremium({
            title: body.title,
            niche: body.niche,
            framework: body.framework,
            deployTarget: body.deployTarget,
          })
        : await deployFree({ title: body.title, niche: body.niche, templateId: body.templateId });

    return Response.json(result.data, { status: result.status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Hub request failed' }, { status: 502 });
  }
}
