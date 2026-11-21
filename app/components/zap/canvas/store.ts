/*
 * Canvas state — one store per editor mount. Nodes/edges live in the
 * definition so serialisation is a straight copy, not a reconciliation pass.
 */

import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { create } from 'zustand';

import {
  createDefinition,
  defaultConfigFor,
  nextNodeId,
  toCriterionLines,
  type NodeConfig,
  type NodeType,
  type NodeTypeDescriptor,
  type ValidationIssue,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
  validateDefinition,
} from '~/lib/workflows/contract';

export type FlowNodeData = {
  label: string;
  nodeType: NodeType;
  category: string;
  agentId: string | null;
  taskType: string | null;
  config: NodeConfig;
};

export type FlowNode = Node<FlowNodeData, 'workflowNode'>;

type CanvasState = {
  workflowId: string;
  name: string;
  version: number;
  status: 'draft' | 'published';
  execution: WorkflowDefinition['execution'];
  budget: WorkflowDefinition['budget'];
  acceptanceCriteria: string[];
  nodes: FlowNode[];
  edges: Edge[];
  descriptors: Record<string, NodeTypeDescriptor>;
  selectedNodeId: string | null;
  runStatus: Record<string, string>;
  runJobId: string | null;
  runJobStatus: string | null;
  runJobVersion: number | null;
  issues: ValidationIssue[];
  notice: string | null;
  error: string | null;
  busy: boolean;
  loadDescriptorSet: (descriptors: NodeTypeDescriptor[]) => void;
  loadDefinition: (definition: WorkflowDefinition) => void;
  reset: (name?: string) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  updateNodeConfig: (nodeId: string, config: NodeConfig) => void;
  updateNodeLabel: (nodeId: string, label: string) => void;
  removeNode: (nodeId: string) => void;
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  connect: (connection: { source?: string | null; target?: string | null; sourceHandle?: string | null }) => void;
  select: (nodeId: string | null) => void;
  setRunStatus: (jobId: string | null, status: Record<string, string>) => void;
  setRunJob: (jobId: string | null, status: string | null, version: number | null) => void;
  setName: (name: string) => void;
  setExecution: (execution: Partial<WorkflowDefinition['execution']>) => void;
  setBudget: (budget: Partial<WorkflowDefinition['budget']>) => void;
  setAcceptanceCriteria: (criteria: string[]) => void;
  setStatus: (status: 'draft' | 'published', version: number) => void;
  setBusy: (busy: boolean) => void;
  setNotice: (notice: string | null) => void;
  setError: (error: string | null) => void;
  validate: () => boolean;
  toDefinition: () => WorkflowDefinition;
};

function toFlowNode(node: WorkflowNode, descriptor?: NodeTypeDescriptor): FlowNode {
  return {
    id: node.id,
    type: 'workflowNode',
    position: node.position,
    data: {
      label: descriptor?.label ?? node.type,
      nodeType: node.type,
      category: descriptor?.category ?? 'agent',
      agentId: descriptor?.agentId ?? null,
      taskType: descriptor?.defaultTaskType ?? null,
      config: node.config,
    },
  };
}

function toWorkflowNode(node: FlowNode): WorkflowNode {
  return {
    id: node.id,
    type: node.data.nodeType,
    position: { x: node.position.x, y: node.position.y },
    config: node.data.config,
  };
}

function toWorkflowEdge(edge: Edge): WorkflowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
  };
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  workflowId: '',
  name: 'Untitled workflow',
  version: 1,
  status: 'draft',
  execution: createDefinition({ workflowId: 'placeholder', name: 'x' }).execution,
  budget: createDefinition({ workflowId: 'placeholder', name: 'x' }).budget,
  acceptanceCriteria: [],
  nodes: [],
  edges: [],
  descriptors: {},
  selectedNodeId: null,
  runStatus: {},
  runJobId: null,
  runJobStatus: null,
  runJobVersion: null,
  issues: [],
  notice: null,
  error: null,
  busy: false,

  loadDescriptorSet: (descriptors) =>
    set({
      descriptors: Object.fromEntries(descriptors.map((descriptor) => [descriptor.type, descriptor])),
    }),

  loadDefinition: (definition) => {
    const descriptors = get().descriptors;

    set({
      workflowId: definition.workflowId,
      name: definition.name,
      version: definition.version,
      status: definition.status,
      execution: definition.execution,
      budget: definition.budget,
      acceptanceCriteria: toCriterionLines(definition.acceptanceCriteria),
      nodes: definition.nodes.map((node) => toFlowNode(node, descriptors[node.type])),
      edges: definition.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
      selectedNodeId: null,
      issues: [],
      error: null,
      notice: null,
    });
  },

  reset: (name) => {
    const fresh = createDefinition({ workflowId: '', name: name || 'Untitled workflow' });

    set({
      workflowId: '',
      name: fresh.name,
      version: 1,
      status: 'draft',
      execution: fresh.execution,
      budget: fresh.budget,
      acceptanceCriteria: [],
      nodes: [],
      edges: [],
      selectedNodeId: null,
      issues: [],
      error: null,
      notice: null,
    });
  },

  addNode: (type, position) => {
    const { nodes, descriptors } = get();
    const descriptor = descriptors[type];
    const id = nextNodeId(type, nodes.map(toWorkflowNode));

    set({
      nodes: [
        ...nodes,
        toFlowNode(
          {
            id,
            type,
            position,
            config: defaultConfigFor(type, descriptor),
          },
          descriptor,
        ),
      ],
      selectedNodeId: id,
    });
  },

  updateNodeConfig: (nodeId, config) =>
    set({
      nodes: get().nodes.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, config } } : node)),
    }),

  updateNodeLabel: (nodeId, label) =>
    set({
      nodes: get().nodes.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, label } } : node)),
    }),

  removeNode: (nodeId) =>
    set({
      nodes: get().nodes.filter((node) => node.id !== nodeId),
      edges: get().edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
    }),

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),

  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),

  connect: (connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) {
      return;
    }

    const { edges } = get();

    if (edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) {
      return;
    }

    set({
      edges: [
        ...edges,
        {
          id: `edge_${connection.source}_${connection.target}`,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle ?? undefined,
        },
      ],
    });
  },

  select: (nodeId) => set({ selectedNodeId: nodeId }),

  setRunStatus: (jobId, status) => set({ runJobId: jobId, runStatus: status }),

  setRunJob: (jobId, status, version) => set({ runJobId: jobId, runJobStatus: status, runJobVersion: version }),

  setName: (name) => set({ name }),

  setExecution: (execution) => set({ execution: { ...get().execution, ...execution } }),

  setBudget: (budget) => set({ budget: { ...get().budget, ...budget } }),

  setAcceptanceCriteria: (criteria) => set({ acceptanceCriteria: criteria }),

  setStatus: (status, version) => set({ status, version }),

  setBusy: (busy) => set({ busy }),

  setNotice: (notice) => set({ notice }),

  setError: (error) => set({ error }),

  validate: () => {
    const issues = validateDefinition(get().toDefinition());
    set({ issues });

    return issues.length === 0;
  },

  toDefinition: () => {
    const state = get();

    return {
      workflowId: state.workflowId,
      version: state.version,
      name: state.name,
      status: state.status,
      nodes: state.nodes.map(toWorkflowNode),
      edges: state.edges.map(toWorkflowEdge),
      execution: state.execution,
      approvals: state.nodes
        .filter((node) => node.data.nodeType === 'approval_gate')
        .map((node) => {
          const config = node.data.config as { actionType: string; required: boolean; expiresInMinutes?: number };
          return {
            nodeId: node.id,
            actionType: config.actionType,
            required: config.required,
            ...(config.expiresInMinutes ? { expiresInMinutes: config.expiresInMinutes } : {}),
          };
        }),
      modelPreferences: {
        defaultPolicy: { taskType: 'scout' },
        fallbackEnabled: true,
      },
      budget: state.budget,
      acceptanceCriteria: state.acceptanceCriteria,
    };
  },
}));
