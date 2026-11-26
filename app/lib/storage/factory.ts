/**
 * Storage adapter factory.
 *
 * The backend is selected exclusively by the `STORAGE_BACKEND` environment
 * variable:
 *
 * | STORAGE_BACKEND | Adapter                                        | Use          |
 * | --------------- | ---------------------------------------------- | ------------ |
 * | `local`         | Node.js filesystem JSON (`adapters/local.ts`)   | development  |
 * | `memory`        | In-memory Map (`adapters/memory.ts`)            | tests        |
 * | `d1`            | Cloudflare D1 (`adapters/d1.ts`)                | production   |
 *
 * The factory never falls back silently. An unset or unknown backend fails
 * closed with `unavailable`, so a production deployment without a working
 * backend returns 503 instead of storing data somewhere unexpected. The D1
 * backend also fails closed when the binding is missing.
 *
 * `local` imports `node:fs`. It is therefore loaded through a specifier the
 * bundler cannot analyse, which keeps the filesystem adapter — and the
 * filesystem dependency — out of the Cloudflare Worker bundle. The Worker
 * never resolves that import: it fails closed before it gets there.
 */

import { D1StorageAdapter } from '~/lib/storage/adapters/d1';
import type { D1Database } from '~/lib/storage/adapters/d1';
import { InMemoryStorageAdapter } from '~/lib/storage/adapters/memory';
import { StorageError } from '~/lib/storage/contract';
import type { StorageAdapter } from '~/lib/storage/contract';

export const LOCAL_BACKEND = 'local';
export const MEMORY_BACKEND = 'memory';
export const D1_BACKEND = 'd1';

/**
 * Kept in a variable on purpose: a literal specifier would make the bundler
 * include the filesystem adapter in the Worker build.
 */
const LOCAL_ADAPTER_MODULE = './adapters/local.js';

export interface StorageFactoryOptions {
  /** The D1 binding, required when `STORAGE_BACKEND` is `d1`. */
  d1?: D1Database;
}

let cachedAdapter: StorageAdapter | null = null;

function resolveBackend(): string {
  const backend = process.env.STORAGE_BACKEND?.trim();

  if (!backend) {
    throw new StorageError('unavailable', 'STORAGE_BACKEND is not configured');
  }

  if (backend !== LOCAL_BACKEND && backend !== MEMORY_BACKEND && backend !== D1_BACKEND) {
    throw new StorageError('unavailable', `Unknown storage backend '${backend}'`);
  }

  return backend;
}

async function createLocalAdapter(): Promise<StorageAdapter> {
  const module = (await import(/* @vite-ignore */ LOCAL_ADAPTER_MODULE)) as {
    NodeLocalStorageAdapter: new (dataDir?: string) => StorageAdapter;
  };

  return new module.NodeLocalStorageAdapter();
}

/**
 * Returns the adapter for the configured backend.
 *
 * @throws StorageError with code `unavailable` when the backend is unset,
 * unknown, or when the D1 backend is selected without a binding.
 */
export async function createStorageAdapter(options: StorageFactoryOptions = {}): Promise<StorageAdapter> {
  if (cachedAdapter) {
    return cachedAdapter;
  }

  const backend = resolveBackend();

  if (backend === LOCAL_BACKEND) {
    cachedAdapter = await createLocalAdapter();

    return cachedAdapter;
  }

  if (backend === MEMORY_BACKEND) {
    cachedAdapter = new InMemoryStorageAdapter();

    return cachedAdapter;
  }

  if (!options.d1) {
    throw new StorageError('unavailable', 'The D1 storage binding is not available');
  }

  cachedAdapter = new D1StorageAdapter(options.d1);

  return cachedAdapter;
}

/** Test seam: drops the cached adapter so a test can start from a clean store. */
export function resetStorageAdapterForTesting(): void {
  cachedAdapter = null;
}
