/**
 * A D1-compatible binding backed by `node:sqlite`.
 *
 * D1 is SQLite, so the binding API (`prepare`, `bind`, `run`, `all`, `first`) can
 * be exercised against the real SQLite engine without a Cloudflare runtime. The
 * shim implements the binding API only; the SQL semantics — including the partial
 * unique index that enforces the slug rule — come from SQLite itself.
 *
 * The migration file is applied to the same engine, so the tests verify the
 * shipped schema instead of a hand-written copy of it.
 */

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { D1Database, D1PreparedStatement, D1ResultSet } from '~/lib/storage/adapters/d1';

export const MIGRATION_PATH = fileURLToPath(new URL('../../../migrations/001_zes_cms.sql', import.meta.url));

/** Every shipped migration, in the order the database applies them. */
export const MIGRATION_PATHS = [
  MIGRATION_PATH,
  fileURLToPath(new URL('../../../migrations/002_cms_assertion_nonces.sql', import.meta.url)),
];

export interface D1Shim {
  db: D1Database;
  sqlite: DatabaseSync;
  close: () => void;
}

function toD1Value(value: unknown): null | number | string | bigint | Uint8Array {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') {
    return value;
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  throw new TypeError(`Unsupported bind value: ${typeof value}`);
}

export function createD1Shim(): D1Shim {
  const sqlite = new DatabaseSync(':memory:');

  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      const statement = sqlite.prepare(query);

      const build = (values: unknown[]): D1PreparedStatement => ({
        bind(...next: unknown[]) {
          return build([...values, ...next]);
        },
        async run() {
          const result = statement.run(...values.map(toD1Value));

          return {
            success: true,
            results: [],
            meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
          };
        },
        async all<T>() {
          const rows = statement.all(...values.map(toD1Value)) as T[];

          return { success: true, results: rows, meta: {} } satisfies D1ResultSet<T>;
        },
        async first<T>() {
          const row = statement.get(...values.map(toD1Value)) as T | undefined;

          return row ?? null;
        },
      });

      return build([]);
    },
  };

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}

/** Applies the shipped migration files to the shim database. */
export function applyMigration(sqlite: DatabaseSync, path: string = MIGRATION_PATH): void {
  sqlite.exec(readFileSync(path, 'utf8'));
}

/** Applies every shipped migration to the shim database, in order. */
export function applyMigrations(sqlite: DatabaseSync, paths: string[] = MIGRATION_PATHS): void {
  for (const path of paths) {
    sqlite.exec(readFileSync(path, 'utf8'));
  }
}
