import { gateEnabled, productUrl, sessionStatus } from '~/lib/whop.server';

export async function loader({ request }: { request: Request }) {
  const status = gateEnabled()
    ? await sessionStatus(request)
    : { signedIn: true, hasAccess: true, level: 'gate_off', user: null };

  return Response.json(
    { ...status, gateEnabled: gateEnabled(), loginUrl: '/api/auth/whop', productUrl: productUrl() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
