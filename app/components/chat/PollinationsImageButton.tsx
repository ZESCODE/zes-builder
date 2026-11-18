import { useState } from 'react';
import { classNames } from '~/utils/classNames';

export function PollinationsImageButton() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [qc, setQc] = useState<{ passed: boolean; averageScore: number } | null>(null);

  async function generate() {
    if (!prompt.trim() || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    setQc(null);

    try {
      const response = await fetch('/api/image/pollinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), width: 1024, height: 1024 }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Request failed (${response.status})`);
      }

      const blob = await response.blob();
      const sourceUrl = response.headers.get('X-Pollinations-Image-Url');

      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }

      setImageUrl(URL.createObjectURL(blob));

      void fetch('/api/hub/qc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: sourceUrl, prompt: prompt.trim() }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((value) => {
          const payload = value as { averageScore?: number; passed?: boolean } | null;

          if (payload && typeof payload.averageScore === 'number') {
            setQc({ passed: Boolean(payload.passed), averageScore: payload.averageScore });
          }
        })
        .catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-bolt-elements-borderColor text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive"
        title="Generate an image with Pollinations"
      >
        <div className="i-ph:image" />
        <span className="hidden sm:inline">Image</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Generate image</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
                aria-label="Close"
              >
                <div className="i-ph:x text-lg" />
              </button>
            </div>

            <div className="flex gap-2">
              <input
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void generate();
                  }
                }}
                placeholder="A frost-blue hero illustration for a gardening app"
                className="flex-1 px-3 py-2 text-sm rounded-md bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary outline-none focus:border-accent-500"
              />
              <button
                type="button"
                onClick={() => void generate()}
                disabled={loading || !prompt.trim()}
                className={classNames(
                  'px-3 py-2 text-xs rounded-md bg-accent-500 text-white',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {loading ? 'Generating…' : 'Generate'}
              </button>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            {imageUrl && (
              <div className="flex flex-col gap-2">
                <img
                  src={imageUrl}
                  alt={prompt}
                  className="w-full rounded-lg border border-bolt-elements-borderColor"
                />
                <a
                  href={imageUrl}
                  download="zes-image.png"
                  className="text-xs text-accent-500 hover:underline self-start"
                >
                  Download
                </a>
              </div>
            )}

            {qc && (
              <span
                className={classNames(
                  'self-start rounded-full px-2 py-0.5 text-[11px]',
                  qc.passed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
                )}
              >
                {qc.passed ? `QC passed · ${qc.averageScore}` : `QC failed · ${qc.averageScore} — Regenerate?`}
              </span>
            )}

            <p className="text-[11px] text-bolt-elements-textTertiary">
              Images are generated server-side through image.pollinations.ai.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
