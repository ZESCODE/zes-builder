/*
 * Scout workflow template — the Phase 5 acceptance workflow:
 * SCOUT → ANALYZE → VERIFY → REPORT.
 *
 * Castor plans the run, the GitHub tool reads the repository, John evaluates
 * it, the verifier checks the result independently and the output node
 * collects the report. No model ids are sent: the hub resolves the routing.
 */

import { createDefinition, type WorkflowDefinition, type WorkflowNode } from './contract';

export type RepoRef = {
  owner: string;
  repo: string;
  url: string;
};

export function parseRepoUrl(input: string): RepoRef | null {
  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  const match =
    trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i) ||
    trimmed.match(/^github\.com\/([^/\s]+)\/([^/\s#?]+)/i);

  if (!match) {
    return null;
  }

  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');

  if (!owner || !repo) {
    return null;
  }

  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

export function scoutWorkflowId(ref: RepoRef): string {
  const slug = `${ref.owner}-${ref.repo}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `scout-${slug}`.slice(0, 64);
}

export function createScoutDefinition(ref: RepoRef): WorkflowDefinition {
  const definition = createDefinition({
    workflowId: scoutWorkflowId(ref),
    name: `Scout ${ref.owner}/${ref.repo}`,
  });

  const nodes: WorkflowNode[] = [
    {
      id: 'castor_plan',
      type: 'castor',
      position: { x: 0, y: 0 },
      config: {
        agentId: 'castor',
        routingPolicy: { taskType: 'plan', complexity: 'high' },
        objective: `Plan the evaluation of ${ref.url}`,
      },
    },
    {
      id: 'github_read',
      type: 'github_tool',
      position: { x: 260, y: 0 },
      config: {
        toolName: 'github.repository.read',
        operation: 'read',
        parameters: { owner: ref.owner, repo: ref.repo, url: ref.url },
        requiresApproval: false,
      },
    },
    {
      id: 'john_scout',
      type: 'john',
      position: { x: 520, y: 0 },
      config: {
        agentId: 'john',
        routingPolicy: { taskType: 'scout', complexity: 'medium' },
        objective: `Evaluate ${ref.url} and record the findings as evidence.`,
      },
    },
    {
      id: 'verifier_check',
      type: 'verifier',
      position: { x: 780, y: 0 },
      config: {
        agentId: 'verifier',
        routingPolicy: { taskType: 'verify', complexity: 'high' },
        objective: `Independently verify the findings for ${ref.url} against the acceptance criteria.`,
      },
    },
    {
      id: 'report_output',
      type: 'output',
      position: { x: 1040, y: 0 },
      config: {
        artifactTypes: ['research_report', 'verification_report'],
        reportName: `Scout report — ${ref.owner}/${ref.repo}`,
      },
    },
  ];

  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `e_${node.id}`,
    source: node.id,
    target: nodes[index + 1].id,
  }));

  return {
    ...definition,
    nodes,
    edges,
    execution: {
      ...definition.execution,
      maxParallelTasks: 1,
      requireVerification: true,
      stopOnFailure: true,
    },
    acceptanceCriteria: [
      `The repository ${ref.owner}/${ref.repo} was read through the GitHub tool and the findings cite concrete files.`,
      'The verifier independently checked the findings and recorded a verification report.',
    ],
  };
}
