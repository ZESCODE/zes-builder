import { describe, it, expect, afterEach, vi } from 'vitest';
import { createKvRateLimitStore, createMemoryRateLimitStore, getRateLimitStore } from './rate-limit-store';

describe('rate limit store', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('the memory store', () => {
    it('counts every hit and keeps one window per key', async () => {
      const store = createMemoryRateLimitStore();

      const first = await store.hit('192.0.2.1:/api/chat', 60_000);
      const second = await store.hit('192.0.2.1:/api/chat', 60_000);
      const other = await store.hit('192.0.2.2:/api/chat', 60_000);

      expect(first.count).toBe(1);
      expect(second.count).toBe(2);
      expect(second.resetTime).toBe(first.resetTime);
      expect(other.count).toBe(1);
    });

    it('starts a new window after the old one expired', async () => {
      const store = createMemoryRateLimitStore();

      await store.hit('192.0.2.3:/api/chat', 1);
      await new Promise((resolve) => setTimeout(resolve, 5));

      const entry = await store.hit('192.0.2.3:/api/chat', 60_000);

      expect(entry.count).toBe(1);
    });
  });

  describe('the Vercel KV store', () => {
    it('increments the counter and reads the remaining window', async () => {
      const calls: unknown[][] = [];

      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)));

        return new Response(JSON.stringify({ result: [[7], [42_000]] }), { status: 200 });
      });

      const store = createKvRateLimitStore({
        url: 'https://kv.example.test/',
        token: 'secret-token',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const entry = await store.hit('192.0.2.4:/api/chat', 60_000);

      expect(entry.count).toBe(7);
      expect(entry.resetTime).toBeGreaterThan(Date.now());
      expect(calls[0]).toEqual([
        ['INCR', 'rl:192.0.2.4:/api/chat'],
        ['PTTL', 'rl:192.0.2.4:/api/chat'],
      ]);
    });

    it('sets the expiry when the counter starts a new window', async () => {
      const calls: unknown[][] = [];

      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)));

        if (calls.length === 1) {
          return new Response(JSON.stringify({ result: [[1], [-1]] }), { status: 200 });
        }

        return new Response(JSON.stringify({ result: [[1]] }), { status: 200 });
      });

      const store = createKvRateLimitStore({
        url: 'https://kv.example.test',
        token: 'secret-token',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const entry = await store.hit('192.0.2.5:/api/chat', 90_000);

      expect(entry.count).toBe(1);
      expect(calls[1]).toEqual([['EXPIRE', 'rl:192.0.2.5:/api/chat', '90']]);
    });

    it('never sends the token outside the authorization header', async () => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: [[1, 1000]] }), { status: 200 }));

      const store = createKvRateLimitStore({
        url: 'https://kv.example.test',
        token: 'secret-token',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await store.hit('192.0.2.6:/api/chat', 60_000);

      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(String(url)).not.toContain('secret-token');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    });

    it('fails loudly when the store answers with an error', async () => {
      const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));

      const store = createKvRateLimitStore({
        url: 'https://kv.example.test',
        token: 'secret-token',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await expect(store.hit('192.0.2.7:/api/chat', 60_000)).rejects.toThrow('HTTP 500');
    });

    it('also accepts a flat pipeline answer', async () => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: [3, 30_000] }), { status: 200 }));

      const store = createKvRateLimitStore({
        url: 'https://kv.example.test',
        token: 'secret-token',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const entry = await store.hit('192.0.2.8:/api/chat', 60_000);

      expect(entry.count).toBe(3);
      expect(entry.resetTime).toBeGreaterThan(Date.now());
    });
  });

  describe('the store selection', () => {
    it('uses the memory store when no KV connection is configured', () => {
      vi.stubEnv('KV_REST_API_URL', '');
      vi.stubEnv('KV_REST_API_TOKEN', '');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');

      expect(getRateLimitStore().name).toBe('memory');
    });

    it('uses the KV store when the connection is configured', () => {
      vi.stubEnv('KV_REST_API_URL', 'https://kv.example.test');
      vi.stubEnv('KV_REST_API_TOKEN', 'secret-token');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');

      expect(getRateLimitStore().name).toBe('vercel-kv');
    });

    it('uses the KV store with the Upstash environment variable names', () => {
      vi.stubEnv('KV_REST_API_URL', '');
      vi.stubEnv('KV_REST_API_TOKEN', '');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://kv.example.test');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'secret-token');

      expect(getRateLimitStore().name).toBe('vercel-kv');
    });

    it('can be forced back to the memory store', () => {
      vi.stubEnv('KV_REST_API_URL', 'https://kv.example.test');
      vi.stubEnv('KV_REST_API_TOKEN', 'secret-token');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
      vi.stubEnv('RATE_LIMIT_STORE', 'memory');

      expect(getRateLimitStore().name).toBe('memory');
    });
  });
});
