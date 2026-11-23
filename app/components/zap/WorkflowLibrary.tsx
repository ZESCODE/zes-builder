import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

type WorkflowRow = {
  workflowId: string;
  version: number;
  name: string;
  description: string;
  status: string;
  publishedAt: string | null;
};

type VersionRow = {
  version: number;
  status: string;
  createdAt?: string;
  created_at?: string;
};

function statusTone(status: string): string {
  if (status === 'published') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  }

  if (status === 'archived') {
    return 'border-slate-500/40 bg-slate-500/10 text-slate-400';
  }

  return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
}

export function WorkflowLibrary({ onJobStarted }: { onJobStarted?: (jobId: string) => void }) {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [versions, setVersions] = useState<Record<string, VersionRow[]>>({});
  const [openVersions, setOpenVersions] = useState<string | null>(null);
  const [objective, setObjective] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/zap/workflows');
    const body = (await response.json().catch(() => ({}))) as { workflows?: WorkflowRow[]; error?: string };

    if (!response.ok) {
      setError(body.error || 'Failed to load workflows');
      return;
    }

    setError(null);
    setWorkflows(Array.isArray(body.workflows) ? body.workflows : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleVersions(workflowId: string) {
    if (openVersions === workflowId) {
      setOpenVersions(null);
      return;
    }

    setOpenVersions(workflowId);

    if (versions[workflowId]) {
      return;
    }

    const response = await fetch(`/api/zap/workflows/${encodeURIComponent(workflowId)}/versions`);
    const body = (await response.json().catch(() => ({}))) as { versions?: VersionRow[] };

    if (response.ok && Array.isArray(body.versions)) {
      setVersions((current) => ({ ...current, [workflowId]: body.versions ?? [] }));
    }
  }

  async function remove(workflow: WorkflowRow) {
    if (!window.confirm(`Delete "${workflow.name}" and all of its versions?`)) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/zap/workflows/${encodeURIComponent(workflow.workflowId)}`, {
      method: 'DELETE',
    });

    const body = (await response.json().catch(() => ({}))) as { error?: string };

    setBusy(false);

    if (!response.ok) {
      setError(body.error || 'Failed to delete the workflow');
      return;
    }

    await load();
  }

  async function startRun(workflow: WorkflowRow) {
    const text = (objective[workflow.workflowId] ?? workflow.description ?? workflow.name).trim();

    if (!text) {
      setError('An objective is required to start a run.');
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch('/api/zap/jobs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: workflow.name,
        objective: text,
        workflowId: workflow.workflowId,
        workflowVersion: workflow.version,
      }),
    });

    const body = (await response.json().catch(() => ({}))) as { error?: string; jobId?: string };

    setBusy(false);

    if (!response.ok || !body.jobId) {
      setError(body.error || 'Failed to start the run');
      return;
    }

    if (onJobStarted) {
      onJobStarted(body.jobId);
    }

    navigate('/zap');
  }

  return (
    <section className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-bolt-elements-textSecondary">
          <img src="/zes-logo.webp" alt="ZESCODE logo" className="h-5 w-5" />
          Workflow library
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-bolt-elements-borderColor px-3 py-1.5 text-sm"
          >
            Refresh
          </button>
          <a
            href="/zap/canvas"
            className="rounded-md border border-blue-500/50 px-3 py-1.5 text-sm text-blue-300 hover:border-blue-400/80"
          >
            New workflow
          </a>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      {workflows.length === 0 ? (
        <p className="text-sm text-bolt-elements-textSecondary">
          No workflows yet — open the canvas to create the first one.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {workflows.map((workflow) => (
            <li
              key={`${workflow.workflowId}:${workflow.version}`}
              className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-3"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{workflow.name}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusTone(workflow.status)}`}>
                      {workflow.status}
                    </span>
                    <span className="text-[11px] text-bolt-elements-textTertiary">v{workflow.version}</span>
                  </div>
                  {workflow.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-bolt-elements-textSecondary">{workflow.description}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-bolt-elements-textTertiary">
                    {workflow.publishedAt
                      ? `published ${new Date(workflow.publishedAt).toLocaleString()}`
                      : 'not published'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/zap/canvas/${encodeURIComponent(workflow.workflowId)}`}
                    className="rounded-md border border-bolt-elements-borderColor px-3 py-1.5 text-sm"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => void toggleVersions(workflow.workflowId)}
                    className="rounded-md border border-bolt-elements-borderColor px-3 py-1.5 text-sm"
                  >
                    Versions
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(workflow)}
                    disabled={busy}
                    className="rounded-md border border-red-500/50 px-3 py-1.5 text-sm text-red-300 disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {openVersions === workflow.workflowId && (
                <ol className="mt-3 flex flex-col gap-1 border-l border-bolt-elements-borderColor pl-3 text-xs">
                  {(versions[workflow.workflowId] ?? []).map((version) => (
                    <li key={version.version} className="flex items-center gap-2">
                      <span className="text-bolt-elements-textTertiary">v{version.version}</span>
                      <span className={version.status === 'published' ? 'text-emerald-300' : 'text-amber-300'}>
                        {version.status}
                      </span>
                      <span className="text-bolt-elements-textTertiary">
                        {new Date(version.createdAt ?? version.created_at ?? Date.now()).toLocaleString()}
                      </span>
                    </li>
                  ))}
                  {versions[workflow.workflowId]?.length === 0 ? (
                    <li className="text-bolt-elements-textTertiary">No versions yet.</li>
                  ) : null}
                </ol>
              )}

              <div className="mt-3 flex flex-col gap-2 border-t border-bolt-elements-borderColor/60 pt-3 sm:flex-row">
                <input
                  type="text"
                  value={objective[workflow.workflowId] ?? workflow.description ?? ''}
                  onChange={(event) =>
                    setObjective((current) => ({ ...current, [workflow.workflowId]: event.target.value }))
                  }
                  placeholder="Objective for this run"
                  className="min-w-0 flex-1 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void startRun(workflow)}
                  disabled={busy}
                  className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Start run
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
