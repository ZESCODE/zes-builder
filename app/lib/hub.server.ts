const DEFAULT_HUB_URL = 'https://hub.zes.codes';

function hubUrl(): string {
  return (process.env.HUB_URL || DEFAULT_HUB_URL).replace(/\/+$/, '');
}

function hubKey(): string {
  const key = process.env.AGORA_HUB_ADMIN_KEY;

  if (!key) {
    throw new Error('AGORA_HUB_ADMIN_KEY is not configured on the builder');
  }

  return key;
}

async function hubFetch(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${hubUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hubKey()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  const data = await response.json().catch(() => ({ error: `Hub returned ${response.status}` }));

  return { status: response.status, data };
}

async function hubGet(path: string): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${hubUrl()}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${hubKey()}`,
    },
    signal: AbortSignal.timeout(60_000),
  });

  const data = await response.json().catch(() => ({ error: `Hub returned ${response.status}` }));

  return { status: response.status, data };
}

export type FreeDeployInput = {
  title: string;
  niche: string;
  templateId?: string;
};

export type PremiumDeployInput = {
  title?: string;
  niche?: string;
  framework?: string;
  deployTarget?: 'vercel' | 'cloudflare';
};

export async function deployFree(input: FreeDeployInput) {
  return hubFetch('/api/pipeline/free', input);
}

export async function deployPremium(input: PremiumDeployInput) {
  return hubFetch('/api/pipeline/premium', input);
}

export async function qcCheck(imageUrl: string, prompt?: string) {
  return hubFetch('/api/qc/check', { imageUrl, prompt });
}

export function hubConfigured(): boolean {
  return Boolean(process.env.AGORA_HUB_ADMIN_KEY);
}

export type ZapJobInput = {
  title: string;
  objective: string;
  workflowType?: string;
  workflowId?: string;
  workflowVersion?: number;
  ownerEmail?: string;
};

export async function zapCreateJob(input: ZapJobInput) {
  return hubFetch('/api/v1/jobs', input);
}

export async function zapListJobs(limit = 25) {
  return hubGet(`/api/v1/jobs?limit=${encodeURIComponent(limit)}`);
}

export async function zapGetJob(jobId: string) {
  return hubGet(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
}

export async function zapPlanJob(jobId: string, template?: string) {
  return hubFetch(`/api/v1/jobs/${encodeURIComponent(jobId)}/plan`, template ? { template } : {});
}

export async function zapRunNext(jobId: string, workerId?: string) {
  return hubFetch(`/api/v1/jobs/${encodeURIComponent(jobId)}/run-next`, workerId ? { workerId } : {});
}

export async function zapJobUsage(jobId: string) {
  return hubGet(`/api/v1/jobs/${encodeURIComponent(jobId)}/usage`);
}

export async function zapListAgents() {
  return hubGet('/api/v1/agents');
}

export async function zapListWorkflows() {
  return hubGet('/api/v1/workflows');
}

export async function zapGetWorkflow(workflowId: string) {
  return hubGet(`/api/v1/workflows/${encodeURIComponent(workflowId)}`);
}

export async function zapWorkflowVersions(workflowId: string) {
  return hubGet(`/api/v1/workflows/${encodeURIComponent(workflowId)}/versions`);
}

export async function zapCreateWorkflow(definition: unknown) {
  return hubFetch('/api/v1/workflows', definition);
}

export async function zapUpdateWorkflow(workflowId: string, definition: unknown) {
  const response = await fetch(`${hubUrl()}/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hubKey()}`,
    },
    body: JSON.stringify(definition),
    signal: AbortSignal.timeout(60_000),
  });

  const data = await response.json().catch(() => ({ error: `Hub returned ${response.status}` }));

  return { status: response.status, data };
}

export async function zapPublishWorkflow(workflowId: string, version?: number) {
  return hubFetch(`/api/v1/workflows/${encodeURIComponent(workflowId)}/publish`, version ? { version } : {});
}

export async function zapNodeTypes() {
  return hubGet('/api/v1/node-types');
}

export async function zapJobGraph(jobId: string) {
  return hubGet(`/api/v1/jobs/${encodeURIComponent(jobId)}/graph`);
}

export async function zapPauseJob(jobId: string, reason?: string) {
  return hubFetch(`/api/v1/jobs/${encodeURIComponent(jobId)}/pause`, reason ? { reason } : {});
}

export async function zapResumeJob(jobId: string) {
  return hubFetch(`/api/v1/jobs/${encodeURIComponent(jobId)}/resume`, {});
}
