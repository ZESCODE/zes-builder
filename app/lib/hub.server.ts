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
