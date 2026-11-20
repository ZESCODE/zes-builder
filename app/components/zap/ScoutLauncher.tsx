import { useState } from 'react';

import { toHubPayload } from '~/lib/workflows/contract';
import { createScoutDefinition, parseRepoUrl } from '~/lib/workflows/scout';

type Props = {
  onStarted: (jobId: string) => void;
};

export function ScoutLauncher({ onStarted }: Props) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const ref = parseRepoUrl(url);

    if (!ref) {
      setError('Enter a GitHub repository URL, for example https://github.com/ZESCODE/zes-builder');
      return;
    }

    setBusy(true);

    const definition = createScoutDefinition(ref);
    const workflowId = definition.workflowId;

    try {
      const existing = await fetch(`/api/zap/workflows/${encodeURIComponent(workflowId)}`);

      let version = definition.version;

      if (!existing.ok) {
        const created = await fetch('/api/zap/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toHubPayload(definition)),
        });

        const createdBody = (await created.json().catch(() => ({}))) as {
          error?: string;
          workflow?: { version?: number };
        };

        if (!created.ok) {
          setError(createdBody.error || 'Failed to create the scout workflow');
          return;
        }

        version = createdBody.workflow?.version ?? version;

        const published = await fetch(`/api/zap/workflows/${encodeURIComponent(workflowId)}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version }),
        });

        const publishedBody = (await published.json().catch(() => ({}))) as { error?: string };

        if (!published.ok) {
          setError(publishedBody.error || 'Failed to publish the scout workflow');
          return;
        }

        setNotice(`Created and published ${workflowId} v${version}.`);
      } else {
        const existingBody = (await existing.json().catch(() => ({}))) as { workflow?: { version?: number } };
        version = existingBody.workflow?.version ?? version;
      }

      const job = await fetch('/api/zap/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Scout ${ref.owner}/${ref.repo}`,
          objective: `Evaluate the repository ${ref.url}: read it with the GitHub tool, report the findings with evidence, and verify the result independently.`,
          workflowId,
          workflowVersion: version,
        }),
      });

      const jobBody = (await job.json().catch(() => ({}))) as { error?: string; jobId?: string };

      if (!job.ok || !jobBody.jobId) {
        setError(jobBody.error || 'Failed to start the scout run');
        return;
      }

      setUrl('');
      onStarted(jobBody.jobId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-blue-500/40 bg-blue-500/5 p-4">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-blue-300">Scout a repository</h2>
      <p className="mb-3 text-xs text-bolt-elements-textSecondary">
        Castor plans the run, the GitHub tool reads the repository, John evaluates it and the verifier checks the
        findings independently. The report lands in the run detail.
      </p>

      <form onSubmit={start} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://github.com/owner/repository"
          className="min-w-0 flex-1 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Starting…' : 'Start scout'}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
      {notice && (
        <p className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {notice}
        </p>
      )}
    </section>
  );
}
