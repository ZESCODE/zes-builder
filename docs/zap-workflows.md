# ZAP workflows in the builder

The builder is the authoring and operations surface for `zes.workflow/v1`. The hub stays
authoritative for orchestration, permissions, model routing and verification.

## Surfaces

| Route | Gated | Purpose |
| --- | --- | --- |
| `/zap` | yes | Workflow library, job dashboard, approval queue, run detail, plan/run and job controls. |
| `/zap/canvas` | yes | New workflow in the React Flow editor. |
| `/zap/canvas/:workflowId` | yes | Edit a stored workflow; add `?job=<id>` to overlay a run. |
| `/api/zap/*` | yes | Proxies to the hub with `AGORA_HUB_ADMIN_KEY`; the browser never sees a model ID or a key. |
| `/api/hub/{deploy,qc}` | yes | Hub deploy/QC actions. |

Every route calls `requireAccess(request)` (`app/lib/whop.server.ts`). With
`WHOP_GATE_ENABLED` unset the check is a no-op; otherwise anonymous callers get
`401 {error: "sign_in_required", loginUrl}` and signed-in callers without access get
`403 {error, level, productUrl}`.

## Contract rules enforced client-side

- `validateDefinition` mirrors the hub contract: declared node types only, condition nodes
  must wire both `true` and `false` handles, `acceptanceCriteria` requires a verifier node.
- `toHubPayload` maps editor strings to `{ id: criterion_<n>, description, verifierAgentId: "verifier", required: true }`.
- Published versions are immutable; editing a published workflow creates a new version.
- A job pins the graph snapshot it started with, so the run overlay always reflects what ran.

## Workflow library

`GET /api/zap/workflows` lists every stored definition with its status, version and publish
date. Each entry can be opened in the canvas, expanded into its version history
(`GET /api/zap/workflows/:id/versions`), started as a run (`POST /api/zap/jobs/create` with
`workflowId` and `workflowVersion`) or deleted.

`DELETE /api/zap/workflows/:id` maps to the hub's `DELETE /api/v1/workflows/:id`, which drops
every version, detaches the jobs that used it and keeps their tasks, artifacts and usage.
A job that is still running blocks the delete with `409`, so the library surfaces the hub's
message instead of failing silently.

## Run detail

`GET /api/zap/jobs/:id/tasks|artifacts|events` back the run panel:

- **Tasks** — contract, objective, status and attempt; the task `result`, `acceptance_criteria`
  and `input` expand on demand.
- **Artifacts** — type, name and URI, with artifacts produced by a completed verifier task or
  typed `verification_report` flagged as verification evidence.
- **Events** — the `agent_events` timeline, payload on demand.
- The job header shows the model spend for the run (cost, tokens, call count).

## Run overlay

`WorkflowCanvas` fetches `/api/zap/jobs/:id/graph` once per `jobId` and stores task status by
`nodeId` in the canvas store. Nodes render a status chip; `skipped` branches are dimmed.

## Approvals

`GET /api/zap/approvals` lists pending approvals; `POST /api/zap/approvals/:id` with
`{decision: "approve" | "reject"}` decides one. `decidedBy` defaults to the signed-in Whop
username, and the hub resolves that to a user row, so usage history stays attributable.

## Job controls

`POST /api/zap/jobs/:id/control` with `{action: "pause" | "resume" | "cancel"}` maps to the
hub's job transitions. The dashboard shows Pause while a job is active, Resume while it is
paused and Cancel until it is completed or cancelled; Cancel asks for confirmation.

## Known limitations

- `WHOP_*` variables must be set on the Vercel project; the gate is off when
  `WHOP_GATE_ENABLED` is absent.
- Workflow deletion removes the stored graph snapshot of finished runs. The tasks, artifacts
  and usage of those jobs remain, but the canvas overlay no longer resolves their nodes.
