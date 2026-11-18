/**
 * Whop OAuth + access checks.
 *
 * Sign-in only needs public-client PKCE (authorization code + S256 challenge);
 * the client secret is never used. Membership is checked server-side with the
 * app API key via `GET /users/{userId}/access/{companyId}`.
 *
 * Env:
 *   WHOP_GATE_ENABLED   "true" to require sign-in + access (default off)
 *   WHOP_CLIENT_ID      OAuth app id (app_...)
 *   WHOP_PRODUCT_ID     product to check access against (prod_...); falls back
 *                       to WHOP_COMPANY_ID
 *   WHOP_COMPANY_ID     account whose access is required (biz_...)
 *   WHOP_API_KEY        app API key, server only
 *   WHOP_SESSION_SECRET HMAC key for the session cookie
 *   WHOP_REDIRECT_URI   optional override of the OAuth redirect URI
 *   WHOP_PRODUCT_URL    checkout/product link shown to members without access
 */

const API_BASE = 'https://api.whop.com/api/v1';
const OAUTH_BASE = 'https://api.whop.com/oauth';
const API_VERSION = '2026-11-04-1';

export const SESSION_COOKIE = 'zesb_session';
export const PKCE_COOKIE = 'zesb_pkce';

export type WhopSession = {
  userId: string;
  username: string;
  name: string;
  exp: number;
};

export function gateEnabled() {
  return process.env.WHOP_GATE_ENABLED === 'true';
}

export function clientId() {
  return process.env.WHOP_CLIENT_ID || '';
}

export function companyId() {
  return process.env.WHOP_COMPANY_ID || '';
}

export function accessResourceId() {
  return process.env.WHOP_PRODUCT_ID || companyId();
}

export function productUrl() {
  return process.env.WHOP_PRODUCT_URL || 'https://whop.com/aitech-7d00/zes-builder/';
}

export function redirectUri(requestUrl: string) {
  return process.env.WHOP_REDIRECT_URI || `${new URL(requestUrl).origin}/api/auth/callback/whop`;
}

function secret() {
  return process.env.WHOP_SESSION_SECRET || '';
}

function b64url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url');
}

export function randomToken(length = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(length)));
}

export async function sha256(value: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

export async function sign(payload: object) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}

export async function unsign<T>(token: string | undefined): Promise<T | null> {
  if (!token || !secret()) {
    return null;
  }

  const [body, mac] = token.split('.');

  if (!body || !mac || mac !== (await hmac(body))) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};

  for (const part of (header || '').split(';')) {
    const index = part.indexOf('=');

    if (index > 0) {
      out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
  }

  return out;
}

export function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie(name: string) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function readSession(request: Request): Promise<WhopSession | null> {
  const session = await unsign<WhopSession>(parseCookies(request.headers.get('cookie'))[SESSION_COOKIE]);

  if (!session || session.exp < Date.now()) {
    return null;
  }

  return session;
}

export async function checkAccess(userId: string): Promise<{ hasAccess: boolean; level: string | null; error?: string }> {
  const key = process.env.WHOP_API_KEY;
  const account = accessResourceId();

  if (!key || !account) {
    return { hasAccess: false, level: null, error: 'whop_not_configured' };
  }

  try {
    const response = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/access/${encodeURIComponent(account)}`, {
      headers: { Authorization: `Bearer ${key}`, 'Api-Version-Date': API_VERSION },
    });

    if (!response.ok) {
      return { hasAccess: false, level: null, error: `access_check_${response.status}` };
    }

    const data = (await response.json()) as { has_access?: boolean; access_level?: string };

    return { hasAccess: Boolean(data.has_access), level: data.access_level || null };
  } catch {
    return { hasAccess: false, level: null, error: 'access_check_failed' };
  }
}

export async function exchangeCode(code: string, verifier: string, requestUrl: string) {
  const response = await fetch(`${OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: clientId(),
      redirect_uri: redirectUri(requestUrl),
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`token_exchange_${response.status}`);
  }

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };
}

export async function fetchUser(accessToken: string) {
  const response = await fetch(`${OAUTH_BASE}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`userinfo_${response.status}`);
  }

  return (await response.json()) as {
    sub?: string;
    user_id?: string;
    id?: string;
    username?: string;
    preferred_username?: string;
    name?: string;
  };
}

export async function verifyIdTokenNonce(idToken: string | undefined, nonce: string) {
  if (!idToken) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return payload.nonce === nonce;
  } catch {
    return false;
  }
}

/** Loads a session (if any) and its current Whop access state. */
export async function sessionStatus(request: Request) {
  const session = await readSession(request);

  if (!session) {
    return { signedIn: false, hasAccess: false, level: null, user: null };
  }

  const access = await checkAccess(session.userId);

  return {
    signedIn: true,
    hasAccess: access.hasAccess,
    level: access.level,
    user: { id: session.userId, username: session.username, name: session.name },
  };
}
