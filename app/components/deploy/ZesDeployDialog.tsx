import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { classNames } from '~/utils/classNames';

type DeployKind = 'free' | 'premium';

interface ZesDeployDialogProps {
  open: boolean;
  kind: DeployKind;
  onClose: () => void;
}

export function ZesDeployDialog({ open, kind, onClose }: ZesDeployDialogProps) {
  const [title, setTitle] = useState('');
  const [niche, setNiche] = useState('');
  const [deployTarget, setDeployTarget] = useState<'vercel' | 'cloudflare'>('vercel');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [qcScore, setQcScore] = useState<number | null>(null);

  async function submit() {
    if (!title.trim() || !niche.trim() || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    setLiveUrl(null);
    setQcScore(null);

    try {
      const response = await fetch('/api/hub/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          niche: niche.trim(),
          deployTarget,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        liveUrl?: string | null;
        qc?: { averageScore?: number; passed?: boolean; recommendation?: string };
      };

      if (!response.ok || payload.error) {
        throw new Error(payload.error || `Deploy failed (${response.status})`);
      }

      if (payload.qc?.averageScore !== undefined) {
        setQcScore(payload.qc.averageScore);
      }

      if (payload.liveUrl) {
        setLiveUrl(payload.liveUrl);
      } else {
        setError('Deploy finished but no live URL was returned. Check the hub logs.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[998] bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[999] w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
          <Dialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary">
            {kind === 'free' ? 'Deploy to ZES (Free)' : 'Deploy to ZES (Premium)'}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[11px] text-bolt-elements-textTertiary">
            The ZES agent hub renders the site, runs image QC and deploys it.
          </Dialog.Description>

          <div className="mt-3 flex flex-col gap-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Site title"
              className="px-3 py-2 text-sm rounded-md bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary outline-none focus:border-accent-500"
            />
            <input
              value={niche}
              onChange={(event) => setNiche(event.target.value)}
              placeholder="Niche (e.g. coffee shop)"
              className="px-3 py-2 text-sm rounded-md bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary outline-none focus:border-accent-500"
            />
            {kind === 'premium' && (
              <select
                value={deployTarget}
                onChange={(event) => setDeployTarget(event.target.value as 'vercel' | 'cloudflare')}
                className="px-3 py-2 text-sm rounded-md bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary outline-none"
              >
                <option value="vercel">Vercel</option>
                <option value="cloudflare">Cloudflare</option>
              </select>
            )}
          </div>

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          {qcScore !== null && <p className="mt-2 text-xs text-bolt-elements-textSecondary">QC score: {qcScore}</p>}
          {liveUrl && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <a href={liveUrl} target="_blank" rel="noreferrer" className="text-accent-500 hover:underline truncate">
                {liveUrl}
              </a>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(liveUrl)}
                className="shrink-0 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
              >
                Copy
              </button>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-md border border-bolt-elements-borderColor text-bolt-elements-textPrimary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={loading || !title.trim() || !niche.trim()}
              className={classNames(
                'px-3 py-1.5 text-xs rounded-md bg-accent-500 text-white',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {loading ? 'Deploying…' : 'Deploy'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
