import { redirect } from 'react-router';
import { SESSION_COOKIE, clearCookie } from '~/lib/whop.server';

export async function loader({ request }: { request: Request }) {
  const next = new URL(request.url).searchParams.get('next') || '/';

  return redirect(next, { headers: { 'Set-Cookie': clearCookie(SESSION_COOKIE) } });
}
