import { describe, expect, it } from 'vitest';

import {
  createDefinition,
  defaultConfigFor,
  nextNodeId,
  toHubPayload,
  validateDefinition,
  type WorkflowDefinition,
} from '~/lib/workflows/contract';

function workflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  const base = createDefinition({ workflowId: 'scout-flow', name: 'Scout flow' });

  return {
    ...base,
    nodes: [
      { id: 'castor_1', type: 'castor', position: { x: 0, y: 0 }, config: defaultConfigFor('castor') },
      { id: 'john_2', type: 'john', position: { x: 200, y: 0 }, config: defaultConfigFor('john') },
      { id: 'output_3', type: 'output', position: { x: 400, y: 0 }, config: defaultConfigFor('output') },
    ],
    edges: [
      { id: 'e1', source: 'castor_1', target: 'john_2' },
      { id: 'e2', source: 'john_2', target: 'output_3' },
    ],
    ...overrides,
  };
}

describe('workflow contract', () => {
  it('accepts a valid definition', () => {
    expect(validateDefinition(workflow())).toEqual([]);
  });

  it('rejects a workflow id that is not a slug', () => {
    const issues = validateDefinition(workflow({ workflowId: 'Not A Slug!' }));
    expect(issues.some((issue) => issue.path === 'workflowId')).toBe(true);
  });

  it('rejects model identifiers supplied by the browser', () => {
    const definition = workflow();
    (definition.nodes[0].config as Record<string, unknown>).model = 'openai/gpt-6-astra';

    const issues = validateDefinition(definition);
    expect(issues.some((issue) => /Models are chosen by the hub/.test(issue.message))).toBe(true);
  });

  it('rejects permissions supplied by the browser', () => {
    const definition = workflow();
    (definition.nodes[0].config as Record<string, unknown>).permissions = ['deployment.write'];

    const issues = validateDefinition(definition);
    expect(issues.some((issue) => /Permissions are granted by the hub/.test(issue.message))).toBe(true);
  });

  it('detects cycles', () => {
    const definition = workflow();
    definition.edges.push({ id: 'e3', source: 'output_3', target: 'castor_1' });

    expect(validateDefinition(definition).some((issue) => /cycle/.test(issue.message))).toBe(true);
  });

  it('detects duplicate node ids', () => {
    const definition = workflow();
    definition.nodes.push({ ...definition.nodes[0] });

    expect(validateDefinition(definition).some((issue) => /Duplicate node id/.test(issue.message))).toBe(true);
  });

  it('requires a node on the canvas', () => {
    const issues = validateDefinition(workflow({ nodes: [], edges: [] }));
    expect(issues.some((issue) => issue.path === 'nodes')).toBe(true);
  });

  it('requires a terminal node', () => {
    const definition = workflow({
      nodes: [
        { id: 'castor_1', type: 'castor', position: { x: 0, y: 0 }, config: defaultConfigFor('castor') },
        { id: 'john_2', type: 'john', position: { x: 200, y: 0 }, config: defaultConfigFor('john') },
      ],
      edges: [{ id: 'e1', source: 'castor_1', target: 'john_2' }],
    });

    expect(validateDefinition(definition).some((issue) => /output node/.test(issue.message))).toBe(true);
  });

  it('serialises to the hub payload with rounded positions', () => {
    const definition = workflow();
    definition.nodes[0].position = { x: 12.7, y: -3.2 };

    const payload = toHubPayload(definition);
    expect(payload.nodes[0].position).toEqual({ x: 13, y: -3 });
    expect(payload.execution).toEqual(definition.execution);
    expect(payload.modelPreferences.defaultPolicy.taskType).toBe('scout');
  });

  it('builds default configs per node kind', () => {
    expect(defaultConfigFor('approval_gate')).toMatchObject({ actionType: 'deployment', required: true });
    expect(defaultConfigFor('condition')).toMatchObject({ expression: expect.any(String) });
    expect(defaultConfigFor('output')).toEqual({ artifactTypes: [] });
    expect(defaultConfigFor('deployment_tool')).toMatchObject({ requiresApproval: true });
    expect(defaultConfigFor('castor')).toMatchObject({ agentId: 'castor' });
  });

  it('generates non-colliding node ids', () => {
    const alias = {
      id: 'castor_1',
      type: 'castor' as const,
      position: { x: 0, y: 0 },
      config: defaultConfigFor('castor'),
    };
    expect(nextNodeId('castor', [alias])).toBe('castor_2');
  });

  it('never emits a model or permission in the payload', () => {
    const payload = JSON.stringify(toHubPayload(workflow()));
    expect(payload).not.toMatch(/"model"/);
    expect(payload).not.toMatch(/"permissions"/);
  });
});
