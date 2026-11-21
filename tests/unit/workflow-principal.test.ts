import { afterEach, describe, expect, it, vi } from 'vitest';

import { callerPrincipal, sign } from '~/lib/whop.server';

const originalSecret = process.env.WHOP_SESSION_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.WHOP_SESSION_SECRET;
  } else {
    process.env.WHOP_SESSION_SECRET = originalSecret;
  }

  vi.unstubAllGlobals();
});

async function sessionRequest(userId: string): Promise<Request> {
  process.env.WHOP_SESSION_SECRET = 'test-secret';

  const token = await sign({ userId, username: 'scout', name: 'Scout', exp: Date.now() + 60_000 });

  return new Request('https://app.zes.codes/api/zap/workflows', {
    headers: { cookie: `zesb_session=${token}` },
  });
}

describe('callerPrincipal', () => {
  it('returns null when there is no session', async () => {
    const request = new Request('https://app.zes.codes/api/zap/workflows');

    expect(await callerPrincipal(request)).toBeNull();
  });

  it('derives a lower case principal from the signed session', async () => {
    const request = await sessionRequest('USR_ABC123');

    expect(await callerPrincipal(request)).toBe('whop:usr_abc123');
  });

  it('ignores a forged session cookie', async () => {
    process.env.WHOP_SESSION_SECRET = 'test-secret';

    const request = new Request('https://app.zes.codes/api/zap/workflows', {
      headers: { cookie: 'zesb_session=eyJ1c2VySWQiOiJ4In0.forged' },
    });

    expect(await callerPrincipal(request)).toBeNull();
  });
});

describe('hub principal relay', () => {
  it('sends the caller principal as x-zes-user', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];

    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });

      return new Response(JSON.stringify({ workflows: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    process.env.AGORA_HUB_ADMIN_KEY = 'test-key';
    process.env.HUB_URL = 'https://hub.test';

    const { zapListWorkflows } = await import('~/lib/hub.server');
    await zapListWorkflows(10, 'whop:usr_abc123');

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-ZES-User']).toBe('whop:usr_abc123');
    expect(calls[0].url).toContain('/api/v1/workflows');
  });

  it('omits the header when there is no principal', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];

    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });

      return new Response(JSON.stringify({ workflows: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    process.env.AGORA_HUB_ADMIN_KEY = 'test-key';
    process.env.HUB_URL = 'https://hub.test';

    const { zapListWorkflows } = await import('~/lib/hub.server');
    await zapListWorkflows(10, null);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-ZES-User']).toBeUndefined();
  });
});
