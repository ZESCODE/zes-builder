# Deploying to Vercel

This fork ships two build targets from one codebase:

| Target | Server bundle | Trigger |
| --- | --- | --- |
| Cloudflare Workers | `workers/app.ts` via `@cloudflare/vite-plugin` | `pnpm deploy` / `wrangler deploy` |
| Vercel | React Router's Node server build | push to `main` |

## Why the Vercel build must skip the Cloudflare plugin

`@cloudflare/vite-plugin` replaces the React Router server entry with a Worker
bundle (`workers/app.ts`) that expects `env` and `ctx` from the Workers runtime.
Vercel loads that bundle as a plain Node Function, so every request failed with:

```
TypeError: Cannot read properties of undefined (reading 'v8_middleware')
FUNCTION_INVOCATION_FAILED
```

`vite.config.ts` therefore enables the Cloudflare plugin only when `VERCEL` is
not set. On Vercel, `react-router build` emits the normal Node server bundle and
`app/entry.server.tsx` handles requests. Cloudflare deploys are unchanged.

Do not add `@vercel/react-router` unless its peer range supports the React
Router version in `package.json`; the zero-config React Router preset on Vercel
is enough. Vercel prints a warning that `vercelPreset()` was not detected — it
is advisory, not fatal.

## Project wiring

- Vercel project: `zes-builder` (team `zescode-2943s-projects`), framework
  preset `react-router`, Node 26.
- Build command: `pnpm build` (Vercel default); do not set a custom output
  directory.
- Production domains: `zes-builder.vercel.app` and `app.zes.codes`.
- Health probe: `GET /api/health` -> `{"status":"healthy", ...}`.

## Environment variables

Provider keys are read from `process.env` on Vercel (the code also accepts
Cloudflare bindings). Set them in the Vercel project, never in the repo.
Current minimal set:

- `OPEN_ROUTER_API_KEY` — enables the OpenRouter models.

Additional providers use the names from `.env.example`
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, ...).
After changing an env var you must redeploy: Vercel snapshots env at build time.

Verify a provider key from the deployed app:

```
curl "https://app.zes.codes/api/check-env-key?provider=OpenRouter"
# -> {"isSet":true}
```

## Local check before pushing

```bash
VERCEL=1 pnpm build
```

This mirrors the Vercel build (no Cloudflare plugin). Without `VERCEL=1` you get
the Worker build used for `wrangler deploy`.

## Rate limiting store

The limiter keys on the client IP and counts in a store. Two backends exist:

- **memory** (default) — a `Map` inside the serverless instance. The budget is
  therefore per instance: with `n` instances a client can spend `n` times the
  documented budget. It is exact on a single instance and good enough for a
  low traffic deployment.
- **Vercel KV** — one shared counter for the whole project, so the budget is
  exact no matter how many instances serve the request. It is selected
  automatically when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are present in
  the environment.

**Current decision: the in-memory backend is what runs.** The shared store was
built and shipped, but switching it on means installing a Redis database from
the Vercel marketplace, which asks the account owner to accept the provider
terms in a browser. The owner decided on 2026-11-28 to keep the in-memory
backend, so the rate limit budget is per instance. That is a deliberate
trade-off, not an oversight: the limiter protects capacity against a runaway
client, and the deployment is low traffic.

To switch to the shared store later:

1. Install the Redis database. Either in the dashboard — **Storage** → **Create
   Database** → **KV** (Upstash Redis), named `zes-builder-rate-limit` and
   linked to the project — or from the command line, which asks for the same
   one-time terms acceptance:

   ```bash
   vercel integration add upstash/upstash-kv \
     --scope <team-slug> --name zes-builder-rate-limit \
     --environment production
   ```

2. Vercel injects the credentials into the project environment as
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` or as
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (both pairs are
   accepted). Confirm with
   `curl -sS "https://api.vercel.com/v10/projects/<project-id>/env" -H "Authorization: Bearer $TOKEN"`.
3. Redeploy — the environment is snapshotted at build time. No code change is
   needed; the store is selected automatically.

`RATE_LIMIT_STORE=memory` forces the in-memory backend even when a KV store
is connected, which is the quick way to roll the shared store back.

If the KV store is unreachable the limiter **fails open**: the request is
allowed and the failure is logged. The limiter protects capacity, it is not an
authorisation gate, so a store outage must not turn every route into a 503.

## Promoting a staged deployment

The release workflow never promotes. It creates a STAGED production-target
deployment and stops. The promotion is a separate, manual and owner-only step:

```bash
VERCEL_TOKEN=... \
VERCEL_PROJECT_ID=... \
VERCEL_TEAM_ID=... \
  bash scripts/promote-release.sh dpl_XXXXXXXXXXXXXXXXXXXXXXXX
```

The script refuses to act unless the deployment exists, targets production,
is still `STAGED` and holds no alias, and it verifies afterwards that the
production target and every production alias moved to the new deployment and
that the production domain answers 200. It prints the rollback command.
