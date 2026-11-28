export interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/*
 * The Redis REST API answers a pipeline with one entry per command. The
 * entries are either the plain value (`[7]`) or the value wrapped in an
 * object (`{"result": 7}`), so both shapes are unwrapped here.
 */
function normalizeCommandResult(entry: unknown): unknown {
  if (Array.isArray(entry)) {
    return entry.length > 0 ? entry[entry.length - 1] : undefined;
  }

  if (entry && typeof entry === 'object' && 'result' in entry) {
    return (entry as { result: unknown }).result;
  }

  return entry;
}
export interface RateLimitStore {
  readonly name: string;
  hit(key: string, windowMs: number): Promise<RateLimitEntry>;
}

function readEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) {
    return undefined;
  }

  const value = process.env[name];

  return value && value.length > 0 ? value : undefined;
}

export function createMemoryRateLimitStore(): RateLimitStore {
  const entries = new Map<string, { count: number; resetTime: number }>();

  return {
    name: 'memory',
    async hit(key: string, windowMs: number): Promise<RateLimitEntry> {
      const now = Date.now();

      if (entries.size > 2000) {
        for (const [storedKey, entry] of entries) {
          if (entry.resetTime <= now) {
            entries.delete(storedKey);
          }
        }
      }

      const existing = entries.get(key);
      const entry = existing && existing.resetTime > now ? existing : { count: 0, resetTime: now + windowMs };

      entry.count += 1;
      entries.set(key, entry);

      return { count: entry.count, resetTime: entry.resetTime };
    },
  };
}

export function createKvRateLimitStore(options: {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
}): RateLimitStore {
  const request = options.fetchImpl ?? fetch;
  const baseUrl = options.url.replace(/\/+$/, '');

  async function pipeline(commands: unknown[][]): Promise<unknown[]> {
    const response = await request(`${baseUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });

    if (!response.ok) {
      throw new Error(`the rate limit store answered with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { result?: unknown };
    const results = Array.isArray(payload?.result) ? payload.result : null;

    if (!results) {
      throw new Error('the rate limit store returned an unexpected response');
    }

    return results.map((entry: unknown) => normalizeCommandResult(entry));
  }

  return {
    name: 'vercel-kv',
    async hit(key: string, windowMs: number): Promise<RateLimitEntry> {
      const seconds = Math.max(1, Math.ceil(windowMs / 1000));
      const storeKey = `rl:${key}`;

      const [countResult, ttlResult] = await pipeline([
        ['INCR', storeKey],
        ['PTTL', storeKey],
      ]);

      const count = Number(countResult);

      if (!Number.isFinite(count)) {
        throw new Error('the rate limit store returned an invalid counter');
      }

      if (count === 1) {
        await pipeline([['EXPIRE', storeKey, String(seconds)]]);
      }

      const ttl = Number(ttlResult);
      const resetTime = Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : windowMs);

      return { count, resetTime };
    },
  };
}

let memoryStore: RateLimitStore | undefined;
let kvStore: RateLimitStore | undefined;

export function getRateLimitStore(): RateLimitStore {
  const mode = readEnv('RATE_LIMIT_STORE')?.toLowerCase();

  if (mode === 'memory') {
    memoryStore ??= createMemoryRateLimitStore();

    return memoryStore;
  }

  const url = readEnv('KV_REST_API_URL');
  const token = readEnv('KV_REST_API_TOKEN');

  if (url && token) {
    kvStore ??= createKvRateLimitStore({ url, token });

    return kvStore;
  }

  memoryStore ??= createMemoryRateLimitStore();

  return memoryStore;
}
