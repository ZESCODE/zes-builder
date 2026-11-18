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
