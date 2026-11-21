import { describe, expect, it } from 'vitest';

import { validationChecks } from '~/components/zap/canvas/ValidationPreview';
import { createDefinition, defaultConfigFor, validateDefinition } from '~/lib/workflows/contract';

function definition(overrides: Partial<ReturnType<typeof createDefinition>> = {}) {
  const base = createDefinition({ workflowId: 'scout-flow', name: 'Scout flow' });

  return {
    ...base,
    nodes: [
      { id: 'castor_1', type: 'castor' as const, position: { x: 0, y: 0 }, config: defaultConfigFor('castor') },
      { id: 'john_2', type: 'john' as const, position: { x: 200, y: 0 }, config: defaultConfigFor('john') },
      { id: 'output_3', type: 'output' as const, position: { x: 400, y: 0 }, config: defaultConfigFor('output') },
    ],
    edges: [
      { id: 'e1', source: 'castor_1', target: 'john_2' },
      { id: 'e2', source: 'john_2', target: 'output_3' },
    ],
    ...overrides,
  };
}

describe('validation preview', () => {
  it('passes every check for a valid definition', () => {
    const checks = validationChecks(validateDefinition(definition()));

    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it('fails the result check when the workflow has no output or report node', () => {
    const withoutSink = definition({
      nodes: [
        { id: 'castor_1', type: 'castor' as const, position: { x: 0, y: 0 }, config: defaultConfigFor('castor') },
      ],
      edges: [],
    });

    const checks = validationChecks(validateDefinition(withoutSink));
    const result = checks.find((check) => check.label === 'Result node');

    expect(result?.passed).toBe(false);
  });

  it('fails the orchestration check when castor is missing', () => {
    const withoutCastor = definition({
      nodes: [
        { id: 'john_2', type: 'john' as const, position: { x: 200, y: 0 }, config: defaultConfigFor('john') },
        { id: 'output_3', type: 'output' as const, position: { x: 400, y: 0 }, config: defaultConfigFor('output') },
      ],
      edges: [{ id: 'e2', source: 'john_2', target: 'output_3' }],
    });

    const checks = validationChecks(validateDefinition(withoutCastor));
    const orchestration = checks.find((check) => check.label === 'Entry and orchestration');

    expect(orchestration?.passed).toBe(false);
  });

  it('fails the permissions check when the browser sends permissions', () => {
    const withPermissions = definition();
    (withPermissions.nodes[0].config as Record<string, unknown>).permissions = ['deployment.write'];

    const checks = validationChecks(validateDefinition(withPermissions));
    const permissions = checks.find((check) => check.label === 'Permissions');

    expect(permissions?.passed).toBe(false);
  });

  it('fails the graph shape check when the graph has a cycle', () => {
    const cyclic = definition();
    cyclic.edges.push({ id: 'e3', source: 'output_3', target: 'castor_1' });

    const checks = validationChecks(validateDefinition(cyclic));
    const shape = checks.find((check) => check.label === 'Graph shape');

    expect(shape?.passed).toBe(false);
  });

  it('accepts a report node as the result node', () => {
    const withReport = definition({
      nodes: [
        { id: 'castor_1', type: 'castor' as const, position: { x: 0, y: 0 }, config: defaultConfigFor('castor') },
        { id: 'report_2', type: 'report' as const, position: { x: 200, y: 0 }, config: defaultConfigFor('report') },
      ],
      edges: [{ id: 'e1', source: 'castor_1', target: 'report_2' }],
    });

    expect(validateDefinition(withReport)).toEqual([]);
  });
});
