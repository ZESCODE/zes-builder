import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import type { FlowNode } from './store';

const CATEGORY_TONE: Record<string, string> = {
  agent: 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-3',
  control: 'border-amber-500/40 bg-amber-500/10',
  tool: 'border-indigo-500/40 bg-indigo-500/10',
  output: 'border-emerald-500/40 bg-emerald-500/10',
};

export const WorkflowNodeView = memo(({ data, selected }: NodeProps<FlowNode>) => {
  const tone = CATEGORY_TONE[data.category] ?? CATEGORY_TONE.agent;
  const isCondition = data.nodeType === 'condition';

  return (
    <div
      className={`min-w-[190px] rounded-xl border px-3 py-2 shadow-md ${tone} ${
        selected ? 'ring-2 ring-accent-500' : ''
      }`}
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
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-bolt-elements-textTertiary" />
      {isCondition ? (
        <>
          <Handle id="true" type="source" position={Position.Bottom} style={{ left: '30%' }} />
          <Handle id="false" type="source" position={Position.Bottom} style={{ left: '70%' }} />
        </>
      ) : null}
    </div>
  );
});
