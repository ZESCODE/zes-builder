import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { useCanvasStore, type FlowNode } from './store';

const CATEGORY_TONE: Record<string, string> = {
  agent: 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-3',
  control: 'border-amber-500/40 bg-amber-500/10',
  tool: 'border-indigo-500/40 bg-indigo-500/10',
  output: 'border-emerald-500/40 bg-emerald-500/10',
};

const STATUS_TONE: Record<string, string> = {
  completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  running: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  failed: 'bg-red-500/20 text-red-300 border-red-500/40',
  blocked: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  skipped: 'bg-slate-500/20 text-slate-400 border-slate-500/40',
  waiting_approval: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  pending: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
};

export const WorkflowNodeView = memo(({ id, data, selected }: NodeProps<FlowNode>) => {
  const tone = CATEGORY_TONE[data.category] ?? CATEGORY_TONE.agent;
  const isCondition = data.nodeType === 'condition';
  const runStatus = useCanvasStore((state) => state.runStatus[id]);

  return (
    <div
      className={`min-w-[190px] rounded-xl border px-3 py-2 shadow-md ${tone} ${
        selected ? 'ring-2 ring-accent-500' : ''
      } ${runStatus === 'skipped' ? 'opacity-50' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-bolt-elements-textTertiary" />
      <p className="text-[10px] font-semibold tracking-wide text-bolt-elements-textTertiary uppercase">
        {data.category}
      </p>
      <p className="mt-0.5 text-sm font-medium text-bolt-elements-textPrimary">{data.label}</p>
      <p className="mt-0.5 text-[11px] text-bolt-elements-textSecondary">
        {data.agentId ?? data.nodeType}
        {data.taskType ? ` · ${data.taskType}` : ''}
      </p>
      {runStatus ? (
        <span
          className={`mt-1 inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
            STATUS_TONE[runStatus] ?? STATUS_TONE.pending
          }`}
        >
          {runStatus.replace('_', ' ')}
        </span>
      ) : null}
      {isCondition ? (
        <>
          <p className="mt-1 text-[11px] text-amber-300">
            when: {String((data.config as { expression?: string } | undefined)?.expression ?? '—')}
          </p>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            className="!h-2 !w-2 !bg-emerald-400"
            style={{ top: '35%' }}
          />
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            className="!h-2 !w-2 !bg-red-400"
            style={{ top: '70%' }}
          />
        </>
      ) : (
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-bolt-elements-textTertiary" />
      )}
    </div>
  );
});
