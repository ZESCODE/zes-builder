import { redirect } from 'react-router';
import {
  PKCE_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  cookie,
  exchangeCode,
  fetchUser,
  parseCookies,
  sign,
  unsign,
  verifyIdTokenNonce,
} from '~/lib/whop.server';

type Pkce = { state: string; verifier: string; nonce: string; next: string };

function fail(reason: string) {
  return redirect(`/?whop_error=${encodeURIComponent(reason)}`, {
    headers: { 'Set-Cookie': clearCookie(PKCE_COOKIE) },
  });
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (url.searchParams.get('error')) {
    return fail(url.searchParams.get('error_description') || 'access_denied');
  }

  if (!code || !state) {
    return fail('missing_code');
  }

  const pkce = await unsign<Pkce>(parseCookies(request.headers.get('cookie'))[PKCE_COOKIE]);

  if (!pkce || pkce.state !== state) {
    return fail('invalid_state');
  }

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;

  try {
    tokens = await exchangeCode(code, pkce.verifier, request.url);
  } catch (error) {
    return fail(String(error));
  }

  if (tokens.id_token && !(await verifyIdTokenNonce(tokens.id_token, pkce.nonce))) {
    return fail('invalid_nonce');
  }

  const profile = await fetchUser(tokens.access_token).catch(() => null);
  const userId = profile?.user_id || profile?.sub || profile?.id;

  if (!userId) {
    return fail('no_profile');
  }

  const session = await sign({
    userId,
    username: profile?.username || profile?.preferred_username || '',
    name: profile?.name || '',
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30,
  });

  const headers = new Headers();
  headers.append('Set-Cookie', cookie(PKCE_COOKIE, '', 0));
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, session, 60 * 60 * 24 * 30));

  return redirect(pkce.next || '/', { headers });
}
