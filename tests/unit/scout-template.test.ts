import { describe, expect, it } from 'vitest';

import { validateDefinition } from '~/lib/workflows/contract';
import { createScoutDefinition, parseRepoUrl, scoutWorkflowId } from '~/lib/workflows/scout';

describe('scout template', () => {
  it('parses GitHub repository URLs', () => {
    expect(parseRepoUrl('https://github.com/ZESCODE/zes-builder')).toEqual({
      owner: 'ZESCODE',
      repo: 'zes-builder',
      url: 'https://github.com/ZESCODE/zes-builder',
    });

    expect(parseRepoUrl('github.com/owner/repo.git')?.repo).toBe('repo');
    expect(parseRepoUrl('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseRepoUrl('')).toBeNull();
  });

  it('derives a stable workflow id', () => {
    const ref = parseRepoUrl('https://github.com/ZESCODE/zes-builder');

    expect(scoutWorkflowId(ref!)).toBe('scout-zescode-zes-builder');
  });

  it('builds a valid definition without model ids', () => {
    const ref = parseRepoUrl('https://github.com/ZESCODE/zes-builder');
    const definition = createScoutDefinition(ref!);

    expect(validateDefinition(definition)).toEqual([]);
    expect(definition.nodes.map((node) => node.type)).toEqual([
      'castor',
      'github_tool',
      'john',
      'verifier',
      'output',
    ]);

    const payload = JSON.stringify(definition);

    expect(payload).not.toContain('deepseek');
    expect(payload).not.toContain('gpt-');
    expect(payload).not.toContain('permissions');
  });

  it('routes the GitHub read to a read-only tool without approval', () => {
    const ref = parseRepoUrl('https://github.com/ZESCODE/zes-builder');
    const definition = createScoutDefinition(ref!);
    const tool = definition.nodes.find((node) => node.type === 'github_tool');

    expect(tool?.config).toMatchObject({
      toolName: 'github.repository.read',
      operation: 'read',
      requiresApproval: false,
      parameters: { owner: 'ZESCODE', repo: 'zes-builder' },
    });
  });

  it('requires a verifier and acceptance criteria', () => {
    const ref = parseRepoUrl('https://github.com/ZESCODE/zes-builder');
    const definition = createScoutDefinition(ref!);

    expect(definition.nodes.some((node) => node.type === 'verifier')).toBe(true);
    expect(definition.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(definition.execution.requireVerification).toBe(true);
  });
});
