import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
} from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

import { ConfigPanel } from './ConfigPanel';
import { NodePalette } from './NodePalette';
import { ValidationPreview } from './ValidationPreview';
import { WorkflowNodeView } from './WorkflowNodeView';
import { useCanvasStore, type FlowNode } from './store';
import { toHubPayload } from '~/lib/workflows/contract';
import type { NodeTypeDescriptor, WorkflowDefinition } from '~/lib/workflows/contract';
import { parseRunState } from '~/lib/workflows/run-state';

const nodeTypes = { workflowNode: WorkflowNodeView };

const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled'];

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? (value as JsonRecord) : {};
}

type Props = {
  descriptors: NodeTypeDescriptor[];
  workflowId?: string;
  jobId?: string;
};

export function WorkflowCanvas({ descriptors, workflowId, jobId }: Props) {
  const store = useCanvasStore();
  const { screenToFlowPosition } = useReactFlow();
  const loaded = useRef(false);
  const [creatingJob, setCreatingJob] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    store.loadDescriptorSet(descriptors);
  }, [descriptors]);

  useEffect(() => {
    if (loaded.current) {
      return;
    }

    loaded.current = true;

    if (!workflowId) {
      store.reset();
      useCanvasStore.setState({ workflowId: '' });

      return;
    }

    fetch(`/api/zap/workflows/${encodeURIComponent(workflowId)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Workflow not found'))))
      .then((raw) => {
        const data = asRecord(raw);
        const record = asRecord(data.workflow);
        const body = asRecord(record.definition ?? data.definition ?? data);

        const definition = {
          ...body,
          workflowId: String(record.workflowId ?? record.workflow_id ?? body.workflowId ?? workflowId),
          version: Number(record.version ?? body.version ?? 1),
          status: String(record.status ?? body.status ?? 'draft'),
          name: String(body.name ?? record.name ?? ''),
        } as unknown as WorkflowDefinition;

        if (definition && Array.isArray(definition.nodes)) {
          useCanvasStore.setState({ workflowId });
          store.loadDefinition(definition);
        } else {
          toast.error('The hub returned an unexpected workflow shape.');
        }
      })
      .catch((error: Error) => toast.error(error.message));
  }, [workflowId]);

  const runJob = store.runJobId ?? jobId ?? null;

  useEffect(() => {
    if (!runJob) {
      return undefined;
    }

    let stopped = false;

    const refresh = async () => {
      try {
        const [jobResponse, tasksResponse] = await Promise.all([
          fetch(`/api/zap/jobs/${encodeURIComponent(runJob)}`),
          fetch(`/api/zap/jobs/${encodeURIComponent(runJob)}/tasks`),
        ]);

        if (stopped || !jobResponse.ok || !tasksResponse.ok) {
          return;
        }

        const jobBody = asRecord(await jobResponse.json());
        const tasksBody = asRecord(await tasksResponse.json());
        const state = parseRunState(jobBody, tasksBody);

        useCanvasStore.getState().setRunJob(runJob, state.jobStatus, state.workflowVersion);
        useCanvasStore.getState().setRunStatus(runJob, state.nodeStatus);
      } catch {
        // the run view keeps the last persisted state
      }
    };

    void refresh();

    const timer = setInterval(refresh, 3000);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [runJob]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }

    useCanvasStore.setState({
      edges: addEdge(
        { ...connection, id: `edge_${connection.source}_${connection.target}` },
        useCanvasStore.getState().edges,
      ),
    });
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/x-zap-node');

      if (!type) {
        return;
      }

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      useCanvasStore.getState().addNode(type as NodeTypeDescriptor['type'], position);
    },
    [screenToFlowPosition],
  );

  const selectedNode = store.nodes.find((node) => node.id === store.selectedNodeId) ?? null;

  async function save(publish: boolean) {
    const state = useCanvasStore.getState();

    if (!state.validate()) {
      toast.error('Fix the highlighted issues before saving.');
      return;
    }

    const definition = state.toDefinition();

    if (!definition.workflowId) {
      toast.error('Set a workflow id before saving.');
      return;
    }

    state.setBusy(true);
    state.setError(null);

    try {
      const exists = state.status
        ? await fetch(`/api/zap/workflows/${encodeURIComponent(definition.workflowId)}`).then((r) => r.ok)
        : false;

      const payload = toHubPayload(definition);

      const response = await fetch(
        exists ? `/api/zap/workflows/${encodeURIComponent(definition.workflowId)}` : '/api/zap/workflows',
        {
          method: exists ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      const data = asRecord(await response.json());

      if (!response.ok) {
        throw new Error(String(data.error || 'The hub rejected the workflow.'));
      }

      const saved = asRecord(data.workflow ?? data) as { version?: number };

      useCanvasStore.setState({ version: saved.version ?? definition.version });

      if (publish) {
        const publishResponse = await fetch(`/api/zap/workflows/${encodeURIComponent(definition.workflowId)}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: saved.version ?? definition.version }),
        });

        const publishData = asRecord(await publishResponse.json());

        if (!publishResponse.ok) {
          throw new Error(String(publishData.error || 'Publish failed.'));
        }

        const publishedVersion =
          (asRecord(publishData.workflow).version as number | undefined) ?? saved.version ?? definition.version;

        state.setStatus('published', publishedVersion);
        toast.success(`Published v${publishedVersion}.`);
      } else {
        state.setStatus('draft', saved.version ?? definition.version);
        toast.success(`Saved draft v${saved.version ?? definition.version}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed.';
      state.setError(message);
      toast.error(message);
    } finally {
      state.setBusy(false);
    }
  }

  async function runWorkflow() {
    const state = useCanvasStore.getState();
    const definition = state.toDefinition();

    if (!definition.workflowId) {
      toast.error('Save the workflow first.');
      return;
    }

    if (state.status !== 'published') {
      toast.error('Publish the workflow before running it.');
      return;
    }

    setCreatingJob(true);

    try {
      const response = await fetch('/api/zap/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: state.name,
          objective: state.acceptanceCriteria.join('\n') || state.name,
          workflowId: definition.workflowId,
          workflowVersion: state.version,
        }),
      });

      const data = asRecord(await response.json());

      if (!response.ok) {
        throw new Error(String(data.error || 'Could not start the run.'));
      }

      const startedJobId = String(data.jobId ?? '');
      const attached = asRecord(data.workflow) as { version?: number };

      useCanvasStore.getState().setRunJob(startedJobId, 'requested', attached.version ?? state.version);
      useCanvasStore.getState().setRunStatus(startedJobId, {});
      toast.success('Run started — the hub owns the execution.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start the run.');
    } finally {
      setCreatingJob(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-bolt-elements-background-depth-1">
      <header className="flex flex-wrap items-center gap-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2">
        <input
          className="w-48 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-sm text-bolt-elements-textPrimary outline-none focus:border-accent-500"
          placeholder="Workflow name"
          value={store.name}
          onChange={(event) => store.setName(event.target.value)}
        />
        <input
          className="w-44 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 font-mono text-xs text-bolt-elements-textPrimary outline-none focus:border-accent-500 disabled:opacity-60"
          placeholder="workflow-id"
          value={store.workflowId}
          disabled={store.status === 'published' || store.workflowId !== ''}
          onChange={(event) =>
            useCanvasStore.setState({ workflowId: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })
          }
        />
        <span className="rounded-full border border-bolt-elements-borderColor px-2 py-0.5 text-[11px] text-bolt-elements-textSecondary">
          {store.status} v{store.version}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => save(false)}
            disabled={store.busy}
            className="rounded-lg border border-bolt-elements-borderColor px-3 py-1.5 text-xs text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3 disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={() => {
              useCanvasStore.getState().validate();
              setPreviewOpen(true);
            }}
            disabled={store.busy}
            className="rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-600 disabled:opacity-50"
          >
            Publish
          </button>
          <button
            type="button"
            onClick={runWorkflow}
            disabled={creatingJob || store.status !== 'published'}
            title={store.status !== 'published' ? 'Publish before running' : 'Start a run'}
            className="rounded-lg border border-emerald-500/50 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
          >
            Run
          </button>
        </div>
      </header>

      {store.runJobId ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-1.5 text-[11px] text-bolt-elements-textSecondary">
          <span className="font-mono text-bolt-elements-textTertiary">job {store.runJobId.slice(0, 8)}</span>
          <span>
            status:{' '}
            <span className="font-medium text-bolt-elements-textPrimary">{store.runJobStatus ?? 'unknown'}</span>
          </span>
          {store.runJobVersion ? <span>workflow version: {store.runJobVersion}</span> : null}
          {store.runJobStatus && TERMINAL_JOB_STATUSES.includes(store.runJobStatus) ? (
            <a
              href={`/zap?job=${encodeURIComponent(store.runJobId)}`}
              className="text-accent-400 underline-offset-2 hover:underline"
            >
              Open the run report
            </a>
          ) : null}
        </div>
      ) : null}

      {store.issues.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300">
          {store.issues.map((issue) => (
            <li key={`${issue.path}-${issue.message}`}>
              <span className="font-mono">{issue.path}</span>: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <NodePalette descriptors={descriptors} />

        <div className="relative min-w-0 flex-1" onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
          <ReactFlow
            nodes={store.nodes}
            edges={store.edges}
            nodeTypes={nodeTypes}
            onNodesChange={store.onNodesChange}
            onEdgesChange={store.onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => store.select(node.id)}
            onPaneClick={() => store.select(null)}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ animated: true, style: { stroke: '#64748b' } }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#334155" />
            <Controls />
            <MiniMap pannable zoomable className="!bg-bolt-elements-background-depth-2" />
          </ReactFlow>
        </div>

        <ConfigPanel
          node={selectedNode}
          execution={store.execution}
          budget={store.budget}
          acceptanceCriteria={store.acceptanceCriteria}
          onConfig={(config) => selectedNode && store.updateNodeConfig(selectedNode.id, config)}
          onLabel={(label) => selectedNode && store.updateNodeLabel(selectedNode.id, label)}
          onDelete={() => selectedNode && store.removeNode(selectedNode.id)}
          onExecution={store.setExecution}
          onBudget={store.setBudget}
          onCriteria={store.setAcceptanceCriteria}
        />
      </div>

      <footer className="flex items-center gap-3 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-1.5 text-[11px] text-bolt-elements-textTertiary">
        {store.runJobId ? <span className="text-blue-300">run overlay on</span> : null}
        <span>{store.nodes.length} nodes</span>
        <span>{store.edges.length} edges</span>
        {store.error ? <span className="text-red-400">{store.error}</span> : null}
      </footer>

      {previewOpen ? (
        <ValidationPreview
          issues={store.issues}
          version={store.version}
          status={store.status}
          busy={store.busy}
          onCancel={() => setPreviewOpen(false)}
          onPublish={() => {
            setPreviewOpen(false);
            void save(true);
          }}
        />
      ) : null}
    </div>
  );
}

export function WorkflowCanvasRoot(props: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas {...props} />
    </ReactFlowProvider>
  );
}

export type { FlowNode };
