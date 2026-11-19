import { useCallback, useEffect, useState } from 'react';
import type { MetaFunction } from 'react-router';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { AccessGate } from '~/components/whop/AccessGate';

export const meta: MetaFunction = () => {
  return [
    { title: 'ZES Orchestration' },
    { name: 'description', content: 'Run ZAP v1 jobs across the ZES agent council' },
  ];
};

type JobRow = {
  id: string;
  title: string;
  objective: string;
  status: string;
  created_at: string;
};

type ApprovalRow = {
  id: string;
  job_id: string;
  task_id: string | null;
  action_type: string;
  action_description: string;
  status: string;
  expires_at: string | null;
};

type TaskRow = {
  id: string;
  assigned_agent: string;
  task_type: string;
  status: string;
  priority: number;
};

function statusTone(status: string): string {
  if (status === 'completed' || status === 'done') {
    return 'text-emerald-400';
  }

  if (status === 'failed' || status === 'error') {
    return 'text-red-400';
  }

  if (status === 'skipped') {
    return 'text-slate-500';
  }

  if (status === 'paused' || status === 'blocked' || status === 'waiting_approval') {
    return 'text-purple-400';
  }

  if (status === 'running') {
    return 'text-blue-400';
  }

  if (status === 'requested' || status === 'planning' || status === 'scouting') {
    return 'text-amber-400';
  }

  return 'text-slate-400';
}

export default function ZapDashboard() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadApprovals = useCallback(async () => {
    const response = await fetch('/api/zap/approvals');
    const body = (await response.json().catch(() => ({}))) as { approvals?: ApprovalRow[]; error?: string };

    if (!response.ok) {
      return;
    }

    setApprovals(Array.isArray(body.approvals) ? body.approvals : []);
  }, []);

  useEffect(() => {
    void loadJobs();
    void loadApprovals();
  }, [loadApprovals]);

  async function decide(approvalId: string, decision: 'approve' | 'reject') {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/zap/approvals/${approvalId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });

    const body = (await response.json().catch(() => ({}))) as { error?: string };

    setBusy(false);

    if (!response.ok) {
      setError(body.error || 'Failed to record the decision');
      return;
    }

    await loadApprovals();
    await loadJobs();

    if (selected) {
      await openJob(selected);
    }
  }

  async function loadJobs() {
    setError(null);

    const response = await fetch('/api/zap/jobs');
    const body = (await response.json().catch(() => ({}))) as { jobs?: JobRow[]; error?: string };

    if (!response.ok) {
      setError(body.error || 'Failed to load jobs');
      return;
    }

    setJobs(Array.isArray(body.jobs) ? body.jobs : []);
  }

  async function openJob(jobId: string) {
    setSelected(jobId);
    setError(null);

    const response = await fetch(`/api/zap/jobs/${jobId}`);
    const body = (await response.json().catch(() => ({}))) as { job?: { tasks?: TaskRow[] }; error?: string };

    if (!response.ok) {
      setError(body.error || 'Failed to load job');
      return;
    }

    setTasks(Array.isArray(body.job?.tasks) ? body.job.tasks : []);
  }

  async function createJob(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/zap/jobs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, objective }),
    });

    const body = (await response.json().catch(() => ({}))) as { error?: string; jobId?: string };

    setBusy(false);

    if (!response.ok) {
      setError(body.error || 'Failed to create job');
      return;
    }

    setTitle('');
    setObjective('');
    await loadJobs();
  }

  async function orchestrate(action: 'plan' | 'run') {
    if (!selected) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/zap/jobs/${selected}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });

    const body = (await response.json().catch(() => ({}))) as { error?: string };

    setBusy(false);

    if (!response.ok) {
      setError(body.error || `Failed to ${action}`);
      return;
    }

    await openJob(selected);
  }

  return (
    <AccessGate>
      <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary">
        <BackgroundRays />
        <Header />

        <main className="relative z-10 mx-auto w-full max-w-6xl px-4 py-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold mb-1">ZES Orchestration</h1>
              <p className="text-sm text-bolt-elements-textSecondary">
                ZAP v1 jobs planned and executed by the agent council.
              </p>
            </div>
            <a
              href="/zap/canvas"
              className="rounded-md border border-bolt-elements-borderColor px-3 py-1.5 text-sm hover:border-blue-400/60"
            >
              Workflow canvas →
            </a>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <section className="rounded-lg border border-bolt-elements-borderColor p-4 bg-bolt-elements-background-depth-1/60">
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-bolt-elements-textSecondary">
                New job
              </h2>

              <form onSubmit={createJob} className="flex flex-col gap-3">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Job title"
                  className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm outline-none focus:border-blue-400"
                />
                <textarea
                  value={objective}
                  onChange={(event) => setObjective(event.target.value)}
                  placeholder="Objective — what should the council accomplish?"
                  rows={4}
                  className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy || !title || !objective}
                    className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    Create job
                  </button>
                  <button
                    type="button"
                    onClick={() => loadJobs()}
                    className="rounded-md border border-bolt-elements-borderColor px-4 py-2 text-sm"
                  >
                    Refresh
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-lg border border-bolt-elements-borderColor p-4 bg-bolt-elements-background-depth-1/60">
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-bolt-elements-textSecondary">
                Jobs
              </h2>

              <ul className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                {jobs.length === 0 && <li className="text-sm text-bolt-elements-textSecondary">No jobs yet.</li>}
                {jobs.map((job) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      onClick={() => openJob(job.id)}
                      className={`w-full text-left rounded-md border px-3 py-2 text-sm ${
                        selected === job.id
                          ? 'border-blue-400 bg-blue-500/10'
                          : 'border-bolt-elements-borderColor hover:border-blue-400/60'
                      }`}
                    >
                      <div className="flex justify-between gap-2">
                        <span className="truncate">{job.title}</span>
                        <span className={`shrink-0 ${statusTone(job.status)}`}>{job.status}</span>
                      </div>
                      <div className="text-xs text-bolt-elements-textSecondary truncate mt-1">{job.objective}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {error && (
            <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {approvals.length > 0 && (
            <section className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-300">
                Approvals waiting ({approvals.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {approvals.map((approval) => (
                  <li
                    key={approval.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/60 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{approval.action_description}</p>
                      <p className="text-xs text-bolt-elements-textSecondary">
                        {approval.action_type} · job {approval.job_id.slice(0, 8)}
                        {approval.expires_at ? ` · expires ${new Date(approval.expires_at).toLocaleString()}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => decide(approval.id, 'approve')}
                      disabled={busy}
                      className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(approval.id, 'reject')}
                      disabled={busy}
                      className="rounded-md border border-red-500/50 px-3 py-1.5 text-sm text-red-300 disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {selected && (
            <section className="mt-6 rounded-lg border border-bolt-elements-borderColor p-4 bg-bolt-elements-background-depth-1/60">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-bolt-elements-textSecondary">Plan</h2>
                <div className="flex gap-2">
                  <a
                    href={`/zap/canvas?job=${selected}`}
                    className="rounded-md border border-bolt-elements-borderColor px-3 py-1.5 text-sm hover:border-blue-400/60"
                  >
                    View run
                  </a>
                  <button
                    type="button"
                    onClick={() => orchestrate('plan')}
                    disabled={busy}
                    className="rounded-md border border-bolt-elements-borderColor px-3 py-1.5 text-sm disabled:opacity-40"
                  >
                    Plan
                  </button>
                  <button
                    type="button"
                    onClick={() => orchestrate('run')}
                    disabled={busy}
                    className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                  >
                    Run next task
                  </button>
                </div>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-bolt-elements-textSecondary">
                    <th className="py-1">Task</th>
                    <th className="py-1">Agent</th>
                    <th className="py-1">Status</th>
                    <th className="py-1">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-bolt-elements-textSecondary">
                        No tasks — run Plan to create the task contracts.
                      </td>
                    </tr>
                  )}
                  {tasks.map((task) => (
                    <tr key={task.id} className="border-t border-bolt-elements-borderColor/60">
                      <td className="py-2">{task.task_type}</td>
                      <td className="py-2">{task.assigned_agent}</td>
                      <td className={`py-2 ${statusTone(task.status)}`}>{task.status}</td>
                      <td className="py-2">{task.priority}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </main>
      </div>
    </AccessGate>
  );
}
