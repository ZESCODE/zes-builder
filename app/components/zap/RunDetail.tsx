import { useCallback, useEffect, useState } from 'react';

type TaskRow = {
  id: string;
  assigned_agent: string;
  task_type: string;
  status: string;
  priority: number;
  attempt: number;
  objective: string;
  input: unknown;
  result: unknown;
  acceptance_criteria: unknown;
  completed_at: string | null;
};

type ArtifactRow = {
  id: string;
  task_id: string | null;
  artifact_type: string;
  name: string;
  storage_uri: string;
  content_type: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  event_type: string;
  payload: unknown;
  created_at: string;
};

function tone(status: string): string {
  if (status === 'completed' || status === 'done' || status === 'succeeded') {
    return 'text-emerald-400';
  }

  if (status === 'failed' || status === 'error') {
    return 'text-red-400';
  }

  if (status === 'running') {
    return 'text-blue-400';
  }

  if (status === 'blocked' || status === 'waiting_approval') {
    return 'text-purple-400';
  }

  return 'text-slate-400';
}

function preview(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function isExternal(uri: string): boolean {
  return uri.startsWith('http://') || uri.startsWith('https://');
}

export function RunDetail({ jobId }: { jobId: string }) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [tasksResponse, artifactsResponse, eventsResponse] = await Promise.all([
      fetch(`/api/zap/jobs/${encodeURIComponent(jobId)}/tasks`),
      fetch(`/api/zap/jobs/${encodeURIComponent(jobId)}/artifacts`),
      fetch(`/api/zap/jobs/${encodeURIComponent(jobId)}/events`),
    ]);

    const tasksBody = (await tasksResponse.json().catch(() => ({}))) as { tasks?: TaskRow[] };
    const artifactsBody = (await artifactsResponse.json().catch(() => ({}))) as { artifacts?: ArtifactRow[] };
    const eventsBody = (await eventsResponse.json().catch(() => ({}))) as { events?: EventRow[] };

    if (!tasksResponse.ok) {
      setError('Failed to load tasks');
      return;
    }

    setError(null);
    setTasks(Array.isArray(tasksBody.tasks) ? tasksBody.tasks : []);
    setArtifacts(Array.isArray(artifactsBody.artifacts) ? artifactsBody.artifacts : []);
    setEvents(Array.isArray(eventsBody.events) ? eventsBody.events : []);
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const verifierTasks = new Set(
    tasks.filter((task) => task.assigned_agent === 'verifier' && task.status === 'completed').map((task) => task.id),
  );
  const evidence = artifacts.filter(
    (artifact) => verifierTasks.has(artifact.task_id ?? '') || artifact.artifact_type === 'verification_report',
  );

  return (
    <section className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-bolt-elements-textSecondary">Run detail</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-bolt-elements-borderColor px-3 py-1.5 text-sm"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">Tasks</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase text-bolt-elements-textTertiary">
              <th className="py-2">Agent</th>
              <th className="py-2">Type</th>
              <th className="py-2">Status</th>
              <th className="py-2">Try</th>
              <th className="py-2">Objective</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-bolt-elements-textSecondary">
                  No tasks yet.
                </td>
              </tr>
            )}
            {tasks.map((task) => (
              <tr key={task.id} className="border-t border-bolt-elements-borderColor/60 align-top">
                <td className="py-2">{task.assigned_agent}</td>
                <td className="py-2">{task.task_type}</td>
                <td className={`py-2 ${tone(task.status)}`}>{task.status}</td>
                <td className="py-2">{task.attempt}</td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => setOpenTask(openTask === task.id ? null : task.id)}
                    className="text-left text-bolt-elements-textSecondary hover:text-blue-300"
                  >
                    {task.objective || '—'}
                  </button>
                  {openTask === task.id ? (
                    <div className="mt-2 flex max-w-xl flex-col gap-2">
                      {task.result ? (
                        <pre className="max-h-56 overflow-auto rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-2 text-[11px] whitespace-pre-wrap">
                          {preview(task.result)}
                        </pre>
                      ) : null}
                      {task.acceptance_criteria ? (
                        <details className="text-[11px] text-bolt-elements-textSecondary">
                          <summary className="cursor-pointer">acceptance criteria</summary>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">
                            {preview(task.acceptance_criteria)}
                          </pre>
                        </details>
                      ) : null}
                      {task.input ? (
                        <details className="text-[11px] text-bolt-elements-textSecondary">
                          <summary className="cursor-pointer">input</summary>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{preview(task.input)}</pre>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">
        Artifacts ({artifacts.length})
        {evidence.length > 0 ? (
          <span className="ml-2 text-emerald-300">{evidence.length} verification evidence</span>
        ) : null}
      </h3>
      {artifacts.length === 0 ? (
        <p className="text-sm text-bolt-elements-textSecondary">No artifacts.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {artifacts.map((artifact) => (
            <li
              key={artifact.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-bolt-elements-borderColor/60 px-2 py-1.5 text-sm"
            >
              <span className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-[10px] text-indigo-300">
                {artifact.artifact_type}
              </span>
              <span className="min-w-0 flex-1 truncate">{artifact.name}</span>
              {verifierTasks.has(artifact.task_id ?? '') || artifact.artifact_type === 'verification_report' ? (
                <span className="text-[10px] uppercase tracking-wide text-emerald-300">evidence</span>
              ) : null}
              {isExternal(artifact.storage_uri) ? (
                <a href={artifact.storage_uri} target="_blank" rel="noreferrer" className="text-xs text-blue-300">
                  open
                </a>
              ) : (
                <span className="max-w-[220px] truncate text-[11px] text-bolt-elements-textTertiary">
                  {artifact.storage_uri}
                </span>
              )}
              <span className="text-[11px] text-bolt-elements-textTertiary">
                {new Date(artifact.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-bolt-elements-textTertiary">
        Events ({events.length})
      </h3>
      {events.length === 0 ? (
        <p className="text-sm text-bolt-elements-textSecondary">No events.</p>
      ) : (
        <ol className="flex flex-col gap-1 border-l border-bolt-elements-borderColor pl-3">
          {events.map((event) => (
            <li key={event.id} className="text-sm">
              <button
                type="button"
                onClick={() => setOpenEvent(openEvent === event.id ? null : event.id)}
                className="flex w-full flex-wrap items-center gap-2 text-left"
              >
                <span className="text-bolt-elements-textPrimary">{event.event_type}</span>
                {event.agent_id ? (
                  <span className="text-xs text-bolt-elements-textSecondary">{event.agent_id}</span>
                ) : null}
                <span className="text-[11px] text-bolt-elements-textTertiary">
                  {new Date(event.created_at).toLocaleString()}
                </span>
              </button>
              {openEvent === event.id ? (
                <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-2 text-[11px] whitespace-pre-wrap">
                  {preview(event.payload)}
                </pre>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
