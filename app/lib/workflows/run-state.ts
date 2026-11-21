/*
 * Run state projection — the canvas shows the state the hub persisted, it
 * never invents it. Both the builder proxy shape and the raw hub shape are
 * accepted so the helper stays usable from routes and tests.
 */

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? (value as JsonRecord) : {};
}

export type RunState = {
  jobStatus: string | null;
  workflowVersion: number | null;
  nodeStatus: Record<string, string>;
};

export function parseRunState(jobPayload: unknown, tasksPayload?: unknown): RunState {
  const root = asRecord(jobPayload);
  const wrapped = asRecord(root.job);
  const row = 'job' in wrapped ? asRecord(wrapped.job) : wrapped;

  const tasks = Array.isArray(tasksPayload)
    ? tasksPayload
    : (asRecord(tasksPayload).tasks ?? wrapped.tasks ?? root.tasks ?? []);

  const nodeStatus: Record<string, string> = {};

  for (const task of tasks as Array<{ node_id?: string; nodeId?: string; status?: string }>) {
    const nodeId = task.node_id ?? task.nodeId;

    if (nodeId && task.status) {
      nodeStatus[nodeId] = task.status;
    }
  }

  const version = row.workflow_version ?? row.workflowVersion;

  return {
    jobStatus: typeof row.status === 'string' ? row.status : null,
    workflowVersion: typeof version === 'number' ? version : null,
    nodeStatus,
  };
}
