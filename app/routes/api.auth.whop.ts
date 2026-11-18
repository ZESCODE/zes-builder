import { redirect } from 'react-router';
import { PKCE_COOKIE, clientId, cookie, randomToken, redirectUri, sha256, sign } from '~/lib/whop.server';

export async function loader({ request }: { request: Request }) {
  const id = clientId();

  if (!id) {
    return Response.json({ error: 'whop_not_configured' }, { status: 500 });
  }

  const verifier = randomToken(32);
  const state = randomToken(16);
  const nonce = randomToken(16);
  const url = new URL(request.url);
  const next = url.searchParams.get('next') || '/';

  const authorize = new URL('https://api.whop.com/oauth/authorize');
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: redirectUri(request.url),
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
  }).toString();

  const pkce = await sign({ state, verifier, nonce, next });

  return redirect(authorize.toString(), {
    headers: { 'Set-Cookie': cookie(PKCE_COOKIE, pkce, 600) },
  });
}
