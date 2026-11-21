import type { ValidationIssue } from '~/lib/workflows/contract';

type Props = {
  issues: ValidationIssue[];
  version: number;
  status: 'draft' | 'published';
  busy?: boolean;
  onCancel: () => void;
  onPublish: () => void;
};

type Check = {
  label: string;
  passed: boolean;
  detail: string;
};

export function validationChecks(issues: ValidationIssue[]): Check[] {
  const has = (pattern: RegExp) => issues.some((issue) => pattern.test(issue.message));

  return [
    {
      label: 'Graph shape',
      passed: !has(/cycle|Edge points at a node|loop onto its own node/),
      detail: 'Every edge connects two nodes that exist and the graph has no cycle.',
    },
    {
      label: 'Entry and orchestration',
      passed: !has(/castor|start node/),
      detail: 'The workflow has one castor node and at most one start node.',
    },
    {
      label: 'Result node',
      passed: !has(/output or report node/),
      detail: 'The workflow ends in an output or report node.',
    },
    {
      label: 'Permissions',
      passed: !has(/permission|granted by the hub/),
      detail: 'No browser supplied permission or model is part of the definition.',
    },
    {
      label: 'Budget',
      passed: !has(/budget/),
      detail: 'The definition carries a cost or call budget.',
    },
  ];
}

export function ValidationPreview({ issues, version, status, busy, onCancel, onPublish }: Props) {
  const checks = validationChecks(issues);
  const blocking = issues.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-2xl">
        <header className="flex items-center justify-between border-b border-bolt-elements-borderColor px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Validation preview</h2>
            <p className="text-[11px] text-bolt-elements-textTertiary">
              The hub validates the same rules again when the version is stored.
            </p>
          </div>
          <span className="rounded-full border border-bolt-elements-borderColor px-2 py-0.5 text-[11px] text-bolt-elements-textSecondary">
            {status} v{version}
          </span>
        </header>

        <div className="max-h-80 overflow-y-auto px-4 py-3">
          <ul className="flex flex-col gap-1.5">
            {checks.map((check) => (
              <li key={check.label} className="flex items-start gap-2 text-xs">
                <span
                  className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    check.passed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                  }`}
                >
                  {check.passed ? '✓' : '×'}
                </span>
                <span className="flex flex-col">
                  <span className="font-medium text-bolt-elements-textPrimary">{check.label}</span>
                  <span className="text-[11px] text-bolt-elements-textTertiary">{check.detail}</span>
                </span>
              </li>
            ))}
          </ul>

          {blocking ? (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5">
              <p className="mb-1 text-[11px] font-semibold text-red-300">
                {issues.length} issue{issues.length === 1 ? '' : 's'} to fix before publishing
              </p>
              <ul className="flex flex-col gap-1">
                {issues.map((issue) => (
                  <li key={`${issue.path}-${issue.message}`} className="text-[11px] text-red-200">
                    <span className="font-mono">{issue.path}</span>: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-200">
              The definition passes the local checks. Publishing stores a new immutable version on the hub.
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-bolt-elements-borderColor px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-bolt-elements-borderColor px-3 py-1.5 text-xs text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={blocking || busy}
            className="rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-600 disabled:opacity-40"
          >
            {busy ? 'Publishing…' : 'Publish version'}
          </button>
        </footer>
      </div>
    </div>
  );
}
