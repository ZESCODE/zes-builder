import { afterEach, describe, expect, it } from 'vitest';

import { requireAccess } from '~/lib/whop.server';

const original = process.env.WHOP_GATE_ENABLED;

afterEach(() => {
  if (original === undefined) {
    delete process.env.WHOP_GATE_ENABLED;
  } else {
    process.env.WHOP_GATE_ENABLED = original;
  }
});

describe('requireAccess', () => {
  it('allows everything when the gate is disabled', async () => {
    delete process.env.WHOP_GATE_ENABLED;

    const request = new Request('https://app.zes.codes/api/zap/jobs');
    expect(await requireAccess(request)).toBeNull();
  });

  it('rejects an anonymous request when the gate is enabled', async () => {
    process.env.WHOP_GATE_ENABLED = 'true';

    const request = new Request('https://app.zes.codes/api/zap/jobs');
    const response = await requireAccess(request);

    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({ error: 'sign_in_required' });
  });

  it('rejects a forged session cookie', async () => {
    process.env.WHOP_GATE_ENABLED = 'true';
    process.env.WHOP_SESSION_SECRET = 'test-secret';

    const request = new Request('https://app.zes.codes/api/zap/jobs', {
      headers: { cookie: 'zesb_session=eyJ1c2VySWQiOiJ4In0.forged' },
    });

    expect((await requireAccess(request))?.status).toBe(401);
  });
});
