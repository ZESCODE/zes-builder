import type { FlowNode } from './store';
import type { NodeConfig, WorkflowDefinition } from '~/lib/workflows/contract';

type Props = {
  node: FlowNode | null;
  execution: WorkflowDefinition['execution'];
  budget: WorkflowDefinition['budget'];
  acceptanceCriteria: string[];
  onConfig: (config: NodeConfig) => void;
  onLabel: (label: string) => void;
  onDelete: () => void;
  onExecution: (patch: Partial<WorkflowDefinition['execution']>) => void;
  onBudget: (patch: Partial<WorkflowDefinition['budget']>) => void;
  onCriteria: (criteria: string[]) => void;
};

const inputClass =
  'w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-xs text-bolt-elements-textPrimary outline-none focus:border-accent-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-bolt-elements-textTertiary">{label}</span>
      {children}
    </label>
  );
}

export function ConfigPanel({
  node,
  execution,
  budget,
  acceptanceCriteria,
  onConfig,
  onLabel,
  onDelete,
  onExecution,
  onBudget,
  onCriteria,
}: Props) {
  const config = (node?.data.config ?? {}) as Record<string, unknown>;

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-3">
      {node ? (
        <>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">{node.data.label}</h2>
              <p className="text-[11px] text-bolt-elements-textTertiary">
                {node.data.nodeType} · {node.id}
              </p>
            </div>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md border border-red-500/40 px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/10"
            >
              Delete
            </button>
          </div>

          <Field label="Label">
            <input className={inputClass} value={node.data.label} onChange={(event) => onLabel(event.target.value)} />
          </Field>

          {node.data.category === 'agent' ? (
            <>
              <Field label="Agent">
                <input className={inputClass} value={String(config.agentId ?? '')} readOnly />
              </Field>
              <Field label="Task type">
                <input
                  className={inputClass}
                  value={String((config.routingPolicy as { taskType?: string } | undefined)?.taskType ?? '')}
                  onChange={(event) =>
                    onConfig({
                      ...(config as { agentId: string; routingPolicy: { taskType: string } }),
                      routingPolicy: {
                        ...(config.routingPolicy as object),
                        taskType: event.target.value,
                      },
                    } as NodeConfig)
                  }
                />
              </Field>
              <Field label="Objective override">
                <textarea
                  className={`${inputClass} min-h-16 resize-y`}
                  value={String(config.objective ?? '')}
                  onChange={(event) => onConfig({ ...config, objective: event.target.value } as NodeConfig)}
                />
              </Field>
              <p className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-[11px] text-bolt-elements-textTertiary">
                The hub picks the model and grants permissions for this agent. Model and permission fields are not
                accepted from the browser.
              </p>
            </>
          ) : null}

          {node.data.nodeType === 'approval_gate' ? (
            <>
              <Field label="Action type">
                <input
                  className={inputClass}
                  value={String(config.actionType ?? '')}
                  onChange={(event) => onConfig({ ...config, actionType: event.target.value } as NodeConfig)}
                />
              </Field>
              <Field label="Expires in minutes">
                <input
                  type="number"
                  className={inputClass}
                  value={Number(config.expiresInMinutes ?? 0)}
                  onChange={(event) =>
                    onConfig({
                      ...config,
                      expiresInMinutes: Number(event.target.value) || undefined,
                    } as NodeConfig)
                  }
                />
              </Field>
              <Field label="Description">
                <textarea
                  className={`${inputClass} min-h-16 resize-y`}
                  value={String(config.description ?? '')}
                  onChange={(event) => onConfig({ ...config, description: event.target.value } as NodeConfig)}
                />
              </Field>
            </>
          ) : null}

          {node.data.nodeType === 'condition' ? (
            <>
              <Field label="Expression">
                <input
                  className={inputClass}
                  value={String(config.expression ?? '')}
                  onChange={(event) => onConfig({ ...config, expression: event.target.value } as NodeConfig)}
                />
              </Field>
              <p className="text-[11px] text-bolt-elements-textTertiary">
                Bottom handles are <code>true</code> and <code>false</code>.
              </p>
            </>
          ) : null}

          {node.data.category === 'tool' ? (
            <>
              <Field label="Tool">
                <input className={inputClass} value={String(config.toolName ?? '')} readOnly />
              </Field>
              <Field label="Operation">
                <input
                  className={inputClass}
                  value={String(config.operation ?? '')}
                  onChange={(event) => onConfig({ ...config, operation: event.target.value } as NodeConfig)}
                />
              </Field>
              <label className="flex items-center gap-2 text-[11px] text-bolt-elements-textSecondary">
                <input
                  type="checkbox"
                  checked={Boolean(config.requiresApproval)}
                  onChange={(event) => onConfig({ ...config, requiresApproval: event.target.checked } as NodeConfig)}
                />
                Requires operator approval
              </label>
            </>
          ) : null}

          {node.data.nodeType === 'output' ? (
            <Field label="Artifact types (comma separated)">
              <input
                className={inputClass}
                value={(config.artifactTypes as string[] | undefined)?.join(', ') ?? ''}
                onChange={(event) =>
                  onConfig({
                    ...config,
                    artifactTypes: event.target.value
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  } as NodeConfig)
                }
              />
            </Field>
          ) : null}
        </>
      ) : (
        <>
          <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Run settings</h2>

          <Field label="Max parallel tasks">
            <input
              type="number"
              min={1}
              max={16}
              className={inputClass}
              value={execution.maxParallelTasks}
              onChange={(event) => onExecution({ maxParallelTasks: Number(event.target.value) || 1 })}
            />
          </Field>

          <Field label="Max attempts per task">
            <input
              type="number"
              min={1}
              max={10}
              className={inputClass}
              value={execution.defaultMaxAttempts}
              onChange={(event) => onExecution({ defaultMaxAttempts: Number(event.target.value) || 1 })}
            />
          </Field>

          <Field label="Lease seconds">
            <input
              type="number"
              min={30}
              max={3600}
              className={inputClass}
              value={execution.leaseSeconds}
              onChange={(event) => onExecution({ leaseSeconds: Number(event.target.value) || 120 })}
            />
          </Field>

          <label className="flex items-center gap-2 text-[11px] text-bolt-elements-textSecondary">
            <input
              type="checkbox"
              checked={execution.requireVerification}
              onChange={(event) => onExecution({ requireVerification: event.target.checked })}
            />
            Require verification evidence
          </label>

          <div className="my-1 h-px bg-bolt-elements-borderColor" />

          <Field label="Budget (USD)">
            <input
              type="number"
              min={0}
              step={0.5}
              className={inputClass}
              value={budget.maxTotalCostUsd}
              onChange={(event) => onBudget({ maxTotalCostUsd: Number(event.target.value) || 0 })}
            />
          </Field>

          <Field label="Max model calls">
            <input
              type="number"
              min={1}
              className={inputClass}
              value={budget.maxModelCalls}
              onChange={(event) => onBudget({ maxModelCalls: Number(event.target.value) || 1 })}
            />
          </Field>

          <div className="my-1 h-px bg-bolt-elements-borderColor" />

          <Field label="Acceptance criteria (one per line)">
            <textarea
              className={`${inputClass} min-h-24 resize-y`}
              value={acceptanceCriteria.join('\n')}
              onChange={(event) =>
                onCriteria(
                  event.target.value
                    .split('\n')
                    .map((value) => value.trim())
                    .filter(Boolean),
                )
              }
            />
          </Field>

          <p className="text-[11px] text-bolt-elements-textTertiary">
            Select a node to edit it. Click a node types in the palette to add one.
          </p>
        </>
      )}
    </aside>
  );
}
