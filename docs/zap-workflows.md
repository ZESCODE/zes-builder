# ZAP workflows in the builder

The builder is the authoring and operations surface for `zes.workflow/v1`. The hub stays
authoritative for orchestration, permissions, model routing and verification.

## Surfaces

| Route | Gated | Purpose |
| --- | --- | --- |
| `/zap` | yes | Job dashboard, approval queue, plan/run controls, "View run". |
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

## Run overlay

`WorkflowCanvas` fetches `/api/zap/jobs/:id/graph` once per `jobId` and stores task status by
`nodeId` in the canvas store. Nodes render a status chip; `skipped` branches are dimmed.

## Approvals

`GET /api/zap/approvals` lists pending approvals; `POST /api/zap/approvals/:id` with
`{decision: "approve" | "reject"}` decides one. `decidedBy` defaults to the signed-in Whop
username, and the hub resolves that to a user row, so usage history stays attributable.

## Known limitations

- The hub API has no delete endpoint for workflows. The `smoke-scout` and `smoke-branch`
  sample workflows published to production can only be removed with direct database access.
- `WHOP_*` variables must be set on the Vercel project; the gate is off when
  `WHOP_GATE_ENABLED` is absent.
