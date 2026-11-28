import type { RouterContextProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loader } from './api.vercel-user';

const clientIP = '203.0.113.10';

const context = {
  clientAddress: clientIP,
  cloudflare: { ctx: { waitUntil: () => undefined } },
} as unknown as Readonly<RouterContextProvider>;

function args(cookieHeader?: string) {
  const url = new URL('http://localhost/api/vercel-user');

  return {
    request: new Request(url, {
      headers: {
        'cf-connecting-ip': clientIP,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    }),
    context,
    url,
    pattern: '/api/vercel-user',
    params: {},
  };
}

describe('Vercel user loader', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('answers 401 when no token is present anywhere', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await loader(args());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Vercel token not found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the standalone cookie the settings tab writes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: '1', name: null, email: 'a@b.c', avatar: null, username: 'u' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await loader(args('VERCEL_ACCESS_TOKEN=cookie-token'));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vercel.com/v2/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer cookie-token' }),
      }),
    );
  });

  it('still accepts the legacy cookie name', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: '1', name: null, email: 'a@b.c', avatar: null, username: 'u' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await loader(args('VITE_VERCEL_ACCESS_TOKEN=legacy-token'));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vercel.com/v2/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer legacy-token' }),
      }),
    );
  });

  it('prefers the apiKeys cookie over the standalone cookie', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: '1', name: null, email: 'a@b.c', avatar: null, username: 'u' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await loader(
      args('VERCEL_ACCESS_TOKEN=cookie-token; apiKeys={"VERCEL_ACCESS_TOKEN":"apikeys-token"}'),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vercel.com/v2/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer apikeys-token' }),
      }),
    );
  });
});
