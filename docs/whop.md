# Whop sign-in and access gate

ZES Builder is sold on Whop. The app uses Whop OAuth (public client, PKCE) to
identify the visitor, then asks Whop whether that user has access to the ZES
Builder product. Everyone else sees a sign-in / buy screen instead of the
builder.

## Flow

1. `GET /api/auth/whop` — creates a PKCE verifier, `state` and `nonce`, stores
   them in a signed 10-minute cookie (`zesb_pkce`), redirects to
   `https://api.whop.com/oauth/authorize` with scope `openid profile email`.
2. `GET /api/auth/callback/whop` — verifies `state`, exchanges the code at
   `https://api.whop.com/oauth/token` (client_id + code_verifier, no secret),
   checks the `nonce` in the ID token, reads `https://api.whop.com/oauth/userinfo`
   and sets a signed 30-day session cookie (`zesb_session`).
3. `GET /api/whop/session` — returns `{signedIn, hasAccess, level, gateEnabled,
   productUrl, user}`. Access is checked live with
   `GET /api/v1/users/{userId}/access/{resource}` using the **app API key**.
4. `GET /api/auth/logout` — clears the session cookie.

`app/components/whop/AccessGate.tsx` calls the session endpoint on mount and
renders either the builder or the sign-in card. The gate wraps the whole index
layout, so it also covers `chat/:id`.

## Access resource

Access is checked against `WHOP_PRODUCT_ID` (the product) when set, otherwise
against `WHOP_COMPANY_ID` (the whole account). Check the product, not the
company, if only buyers should get in: company-level access includes every
member of the Whop community.

## Whop app

- App id: `app_LUXluqp3B28iUh` ("ZES Builder", OAuth client type **public**).
- Product: `prod_ZDZHn772VXeFa`, route `zes-builder`.
- Registered redirect URIs: `https://app.zes.codes/api/auth/callback/whop`,
  `https://zes-builder.vercel.app/api/auth/callback/whop`,
  `http://127.0.0.1:5173/api/auth/callback/whop`.
- Product page: https://whop.com/aitech-7d00/zes-builder/

The public client type is deliberate: the token exchange uses PKCE, so no
client secret is stored anywhere.

## Environment (Vercel)

| Variable | Purpose |
| --- | --- |
| `WHOP_GATE_ENABLED` | `true` to require sign-in + access |
| `WHOP_CLIENT_ID` | OAuth app id (`app_...`) |
| `WHOP_PRODUCT_ID` | product access is checked against (`prod_...`) |
| `WHOP_COMPANY_ID` | fallback resource (`biz_...`) |
| `WHOP_API_KEY` | app API key, server only, encrypted |
| `WHOP_SESSION_SECRET` | HMAC key for the cookies, encrypted |
| `WHOP_PRODUCT_URL` | link shown to users without access |
| `WHOP_REDIRECT_URI` | optional override of the callback URL |

Set `WHOP_GATE_ENABLED=false` (or remove it) to open the builder to everyone
without touching code. Redeploy after changing env: Vercel snapshots env at
build time.

## Limitations

- The app renders inside a Whop iframe only if the app's `base_url` is set to
  the deployment. Until then, use the standalone OAuth flow above.
- `x-whop-user-token` (iframe auth) is not verified; add JWKS verification
  before relying on embedded mode.
- Product pricing/plans are managed in the Whop dashboard, not in this repo.
