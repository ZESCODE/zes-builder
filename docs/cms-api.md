# CMS API — service contract

The website API (`/api/websites`) is served by a dedicated Cloudflare Worker
that owns the D1 database. The browser never talks to the Worker: the
application server on Vercel proxies every request and signs it with the tenant
assertion.

```
browser ──► app.zes.codes (Vercel, React Router SSR)
               │  session + access gate + CSRF checks
               │  Authorization: Bearer <CMS_SERVICE_TOKEN>
               │  x-zes-* assertion headers (HMAC-SHA256)
               ▼
            api.zes.codes (Worker "zes-cms-api") ──► D1 "zes-builder"
```

The Agent Hub is not part of this path. It remains the orchestration system
for workflows and runs and keeps its own `X-ZES-User` contract.

## Components

| Path | Role |
| --- | --- |
| `app/lib/cms/assertion.ts` | The signed assertion: canonical form, signing, verification. Runs in both runtimes. |
| `app/lib/tenancy/principal.ts` | The canonical tenant principal `whop:<userId>` (case preserving). |
| `app/lib/cms/api-client.server.ts` | Server-side client that signs and sends a request to the Worker. |
| `app/lib/cms/proxy.server.ts` | Browser-facing proxy: session, CSRF, error mapping, request ids. |
| `app/lib/cms/websites.schema.ts` | The request schemas, shared by the proxy and the Worker. |
| `workers/cms-api/` | The Worker: authentication, replay protection, routes. |
| `migrations/002_cms_assertion_nonces.sql` | The nonce table of the replay protection. |

## Credentials

Two credentials, deliberately separate:

| Variable | Where | Purpose |
| --- | --- | --- |
| `CMS_SERVICE_TOKEN` | Vercel env + Worker secret | Authenticates the *caller*. |
| `CMS_ASSERTION_SECRET` | Vercel env + Worker secret | Signs the *tenant*. |
| `CMS_API_URL` | Vercel env | Base URL of the Worker. |
| `CMS_SERVICE_ID` | Vercel env + Worker var | Identity of the caller (default `zes-builder-web`). |
| `CMS_ASSERTION_AUDIENCE` | Vercel env + Worker var | Audience of the assertion (default `zes-cms-api`). |
| `CMS_ALLOWED_ORIGINS` | Vercel env | Extra origins that may send a mutation. |

All of them are server-only. A variable with the `VITE_` prefix is shipped to
the browser and must never carry a credential.

## The tenant assertion

The signed payload is nine lines joined with `\n`:

```
v1
<service>
<audience>
<tenant>
<METHOD>
<path>
<timestamp in unix milliseconds>
<nonce: 32 lower-case hex characters>
<sha256 of the raw body, lower-case hex>
```

The signature is `base64url(HMAC-SHA256(secret, canonical))` and is compared in
constant time. The headers are:

| Header | Value |
| --- | --- |
| `x-zes-service` | Service identity of the caller. |
| `x-zes-audience` | Audience of the assertion. |
| `x-zes-tenant` | Canonical tenant principal. |
| `x-zes-method` | The signed method. |
| `x-zes-path` | The signed path (pathname only, no query string). |
| `x-zes-timestamp` | Unix milliseconds. |
| `x-zes-nonce` | 32 lower-case hex characters. |
| `x-zes-body-sha256` | SHA-256 of the raw request body. |
| `x-zes-signature` | The base64url HMAC. |
| `x-zes-request-id` | The id of the request, propagated through both sides. |

The verifier rebuilds the payload from the headers, checks the signature first
and only then compares the signed method and path with the request it received.
A request that carries a query string is rejected (`query_not_allowed`).

The validity window is 30 seconds. Every assertion carries a nonce, and the
Worker records the nonce in D1 before it executes the request, so a captured
assertion cannot be replayed — not on another isolate, not on another edge
location and not after a restart. The nonce is consumed at-most-once: a request
that fails afterwards has to be signed again.

## The tenant principal

The canonical principal is `whop:<trimmed Whop account identifier>`. The
identifier is **not** lower-cased: folding the case would let two identifiers
that differ only in case collapse into one tenant. `callerPrincipal()` (the Hub
contract) still lower-cases its principal and is unchanged, so existing
workflows keep resolving.

## Endpoints of the Worker

| Method | Path | Authentication |
| --- | --- | --- |
| `GET` | `/api/health` | none — it only reports whether the D1 binding works. |
| `GET` | `/api/websites` | service token + assertion. |
| `POST` | `/api/websites` | service token + assertion. |
| `GET` | `/api/websites/:websiteId` | service token + assertion. |
| `PATCH` | `/api/websites/:websiteId` | service token + assertion. |
| `DELETE` | `/api/websites/:websiteId` | service token + assertion. |

The error contract is `not_found` → 404, `duplicate_slug` → 409,
`invalid_input` → 400, `method_not_allowed` → 405, authentication → 401,
`unavailable` → 503. An error body is `{ error, code, requestId }` and never
contains SQL, a stack trace or a credential.

## Browser protections

The proxy rejects a mutation when

- the `Origin` header is neither the origin of the request nor an entry of
  `CMS_ALLOWED_ORIGINS`,
- the fetch metadata reports a cross-site request (`sec-fetch-site` may only be
  `same-origin` or `none`), or
- the custom header `x-zes-csrf: 1` is missing.

A cross-site form post cannot set a custom header, so the third check alone
blocks the classic CSRF attack; the first two make an accidental cross-origin
call impossible as well. A `GET` never mutates.

## Environments

| | Production | Preview |
| --- | --- | --- |
| Worker | `zes-cms-api` | `zes-cms-api-preview` |
| Database | `zes-builder` (`ca6f8df5-35a7-49d6-b912-727aa78291b8`) | `zes-builder-preview` (`0062fbf8-5cd3-4552-9115-ec3edd3e933c`) |
| Secrets | own | own, different values |

`scripts/check-preview-isolation.mjs` fails when a preview environment shares
the production database id or name, when the preview environment is missing or
when the preview worker name equals the production worker name. The preview
workflow runs it before it deploys.

An environment that does not exist in the Wrangler configuration falls back to
the top-level configuration, which would attach the production database. The
guard exists for exactly that reason: `--env preview` only works while the
`env.preview` section is present.

## Deployment order

1. Apply the migrations to the target database:
   `wrangler d1 migrations apply DB --remote --config workers/cms-api/wrangler.jsonc --env <env>`.
2. Set the Worker secrets:
   `wrangler secret put CMS_SERVICE_TOKEN` and `wrangler secret put CMS_ASSERTION_SECRET`
   (with `--env <env>` for a preview environment).
3. Deploy the Worker:
   `wrangler deploy --config workers/cms-api/wrangler.jsonc --env <env>`.
4. Set the same values in the Vercel environment (`CMS_API_URL`,
   `CMS_SERVICE_TOKEN`, `CMS_ASSERTION_SECRET`) and deploy the application.

The preview deployment of the Worker stays disabled until the preview secrets
exist; without them the Worker rejects every request, which is the intended
behaviour.

## Smoke test after a deployment

```bash
curl -sS https://api.zes.codes/api/health
```

Expected: `{"status":"ok","database":"ok","requestId":"…"}`. A request without
the service token has to answer `401` with `service_unauthorized`, and a
request with a valid token but without an assertion has to answer `401` with
`missing_assertion`.
