/*
 * zes.workflow/v1 client contract — mirrors the hub's definition schema.
 * The hub is authoritative: this module only shapes the payload and catches
 * obvious editing mistakes before a round trip.
 */

export const CONTRACT_VERSION = 'zes.workflow/v1';

export type NodeType =
  | 'castor'
  | 'john'
  | 'siti'
  | 'laurent'
  | 'labu'
  | 'verifier'
  | 'approval_gate'
  | 'condition'
  | 'github_tool'
  | 'research_tool'
  | 'builder_tool'
  | 'deployment_tool'
  | 'output';

export type RoutingPolicy = {
  taskType: string;
  complexity?: 'low' | 'medium' | 'high';
  requiresVision?: boolean;
  requiresCoding?: boolean;
  providerTier?: 'preferred' | 'any';
};

export type AgentNodeConfig = {
  agentId: string;
  routingPolicy: RoutingPolicy;
  objective?: string;
  timeoutMs?: number;
};

export type ApprovalNodeConfig = {
  actionType: string;
  required: boolean;
  expiresInMinutes?: number;
  approvers?: string[];
  description?: string;
};

export type ConditionNodeConfig = {
  expression: string;
  trueHandle: string;
  falseHandle: string;
};

export type ToolNodeConfig = {
  toolName: string;
  operation: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
};

export type OutputNodeConfig = {
  artifactTypes: string[];
  reportName?: string;
};

export type NodeConfig = AgentNodeConfig | ApprovalNodeConfig | ConditionNodeConfig | ToolNodeConfig | OutputNodeConfig;

export type WorkflowNode = {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  config: NodeConfig;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

export type WorkflowExecution = {
  maxParallelTasks: number;
  leaseSeconds: number;
  defaultMaxAttempts: number;
  defaultBackoffMs: number;
  maxBackoffMs: number;
  requireVerification: boolean;
  stopOnFailure: boolean;
};

export type WorkflowDefinition = {
  workflowId: string;
  version: number;
  name: string;
  status: 'draft' | 'published';
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  execution: WorkflowExecution;
  approvals: Array<{
    nodeId: string;
    actionType: string;
    required: boolean;
    expiresInMinutes?: number;
  }>;
  modelPreferences: {
    defaultPolicy: RoutingPolicy;
    fallbackEnabled: boolean;
  };
  budget: {
    maxTotalCostUsd: number;
    maxModelCalls: number;
  };
  acceptanceCriteria: string[];
};

export type NodeTypeDescriptor = {
  type: NodeType;
  label: string;
  category: 'agent' | 'control' | 'tool' | 'output' | string;
  description: string;
  agentId: string | null;
  defaultTaskType: string | null;
  defaultRoutingPolicy: RoutingPolicy | null;
  requiredPermissions: string[];
  protected: boolean;
};

export const DEFAULT_EXECUTION: WorkflowExecution = {
  maxParallelTasks: 2,
  leaseSeconds: 120,
  defaultMaxAttempts: 3,
  defaultBackoffMs: 1000,
  maxBackoffMs: 30000,
  requireVerification: true,
  stopOnFailure: true,
};

export function createDefinition(input: { workflowId: string; name: string }): WorkflowDefinition {
  return {
    workflowId: input.workflowId,
    version: 1,
    name: input.name,
    status: 'draft',
    nodes: [],
    edges: [],
    execution: { ...DEFAULT_EXECUTION },
    approvals: [],
    modelPreferences: {
      defaultPolicy: { taskType: 'scout' },
      fallbackEnabled: true,
    },
    budget: {
      maxTotalCostUsd: 5,
      maxModelCalls: 200,
    },
    acceptanceCriteria: [],
  };
}

export function defaultConfigFor(type: NodeType, descriptor?: NodeTypeDescriptor): NodeConfig {
  if (type === 'approval_gate') {
    return { actionType: 'deployment', required: true } satisfies ApprovalNodeConfig;
  }

  if (type === 'condition') {
    return {
      expression: 'inputs.ok === true',
      trueHandle: 'true',
      falseHandle: 'false',
    } satisfies ConditionNodeConfig;
  }

  if (type === 'output') {
    return { artifactTypes: [] } satisfies OutputNodeConfig;
  }

  if (descriptor?.category === 'tool' || type.endsWith('_tool')) {
    return {
      toolName: type,
      operation: 'read',
      parameters: {},
      requiresApproval: type === 'deployment_tool',
    } satisfies ToolNodeConfig;
  }

  return {
    agentId: descriptor?.agentId ?? type,
    routingPolicy: descriptor?.defaultRoutingPolicy ?? { taskType: descriptor?.defaultTaskType ?? 'scout' },
  } satisfies AgentNodeConfig;
}

export type ValidationIssue = { path: string; message: string };

export function validateDefinition(definition: WorkflowDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(definition.workflowId)) {
    issues.push({
      path: 'workflowId',
      message: 'Use 3-64 characters: lowercase letters, numbers and hyphens.',
    });
  }

  if (!definition.name.trim()) {
    issues.push({ path: 'name', message: 'Give the workflow a name.' });
  }

  const ids = new Set<string>();

  definition.nodes.forEach((node, index) => {
    if (!node.id.trim()) {
      issues.push({ path: `nodes[${index}].id`, message: 'Node needs an id.' });
    }

    if (ids.has(node.id)) {
      issues.push({ path: `nodes[${index}].id`, message: `Duplicate node id "${node.id}".` });
    }

    ids.add(node.id);

    const config = node.config as Record<string, unknown>;

    if ('model' in config || 'provider' in config) {
      issues.push({
        path: `nodes[${index}].config`,
        message: 'Models are chosen by the hub; remove model/provider fields.',
      });
    }

    if ('permissions' in config) {
      issues.push({
        path: `nodes[${index}].config`,
        message: 'Permissions are granted by the hub; remove permissions fields.',
      });
    }
  });

  if (definition.nodes.length === 0) {
    issues.push({ path: 'nodes', message: 'Add at least one node.' });
  }

  for (const edge of definition.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      issues.push({
        path: `edges.${edge.id}`,
        message: 'Edge points at a node that is not on the canvas.',
      });
    }

    if (edge.source === edge.target) {
      issues.push({ path: `edges.${edge.id}`, message: 'An edge cannot loop onto its own node.' });
    }
  }

  if (
    hasCycle(
      definition.nodes.map((node) => node.id),
      definition.edges,
    )
  ) {
    issues.push({ path: 'edges', message: 'The graph contains a cycle.' });
  }

  if (!hasTerminalNode(definition)) {
    issues.push({ path: 'nodes', message: 'Add an output node so the run has a result.' });
  }

  if (definition.acceptanceCriteria.length > 0 && !definition.nodes.some((node) => node.type === 'verifier')) {
    issues.push({
      path: 'acceptanceCriteria',
      message: 'Acceptance criteria need a verifier node to check them.',
    });
  }

  return issues;
}

function hasCycle(nodeIds: string[], edges: WorkflowEdge[]): boolean {
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (id: string): boolean => {
    const current = state.get(id);

    if (current === 'visiting') {
      return true;
    }

    if (current === 'done') {
      return false;
    }

    state.set(id, 'visiting');

    for (const next of adjacency.get(id) ?? []) {
      if (visit(next)) {
        return true;
      }
    }

    state.set(id, 'done');

    return false;
  };

  return nodeIds.some((id) => visit(id));
}

function hasTerminalNode(definition: WorkflowDefinition): boolean {
  return definition.nodes.some((node) => node.type === 'output');
}

export function toHubPayload(definition: WorkflowDefinition) {
  return {
    workflowId: definition.workflowId,
    version: definition.version,
    name: definition.name,
    status: definition.status,
    nodes: definition.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      config: node.config,
    })),
    edges: definition.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    })),
    execution: definition.execution,
    approvals: definition.approvals,
    modelPreferences: definition.modelPreferences,
    budget: definition.budget,
    acceptanceCriteria: definition.acceptanceCriteria.map((description, index) => ({
      id: `criterion_${index + 1}`,
      description,
      verifierAgentId: 'verifier',
      required: true,
    })),
  };
}

export function nextNodeId(type: NodeType, existing: WorkflowNode[]): string {
  let index = existing.length + 1;
  let id = `${type}_${index}`;

  while (existing.some((node) => node.id === id)) {
    index += 1;
    id = `${type}_${index}`;
  }

  return id;
}
