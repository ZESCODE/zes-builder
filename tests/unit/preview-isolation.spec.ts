/**
 * Tests of the preview isolation guard.
 *
 * The guard is the last line of defence against a preview deployment that
 * touches production data. The tests run the script against the shipped
 * configurations and against fixtures that reproduce the two dangerous
 * mistakes: an environment that does not exist and an environment that shares
 * the production database.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = resolve(REPO_ROOT, 'scripts/check-preview-isolation.mjs');
const FIXTURE_DIR = resolve(REPO_ROOT, '.wrangler/tmp/preview-isolation');

interface GuardResult {
  status: number;
  output: string;
}

function runGuard(...configPaths: string[]): GuardResult;
function runGuard(options: { configPaths?: string[]; env?: NodeJS.ProcessEnv }): GuardResult;
function runGuard(first: string | { configPaths?: string[]; env?: NodeJS.ProcessEnv }, ...rest: string[]): GuardResult {
  const isOptions = typeof first === 'object' && first !== null;
  const configPaths = first === undefined ? [] : isOptions ? (first.configPaths ?? []) : [first, ...rest];
  const env = isOptions ? (first.env ?? {}) : {};

  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...configPaths], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });

    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };

    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

function writeFixture(name: string, content: string): string {
  const path = resolve(FIXTURE_DIR, name);

  writeFileSync(path, content, 'utf8');

  return path;
}

const ISOLATED_CONFIG = `{
  "name": "bolt",
  "main": "./workers/app.ts",
  "d1_databases": [
    { "binding": "DB", "database_name": "zes-builder", "database_id": "production-id" }
  ],
  "env": {
    "preview": {
      "name": "bolt-preview",
      "d1_databases": [
        { "binding": "DB", "database_name": "zes-builder-preview", "database_id": "preview-id" }
      ]
    }
  }
}
`;

describe('preview isolation guard', () => {
  beforeAll(() => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it('accepts the shipped configurations', () => {
    const result = runGuard();

    expect(result.status).toBe(0);
    expect(result.output).toContain('preview isolation verified');
  });

  it('rejects a configuration without a preview environment', () => {
    const path = writeFixture(
      'missing-preview.jsonc',
      `{
        "name": "bolt",
        "d1_databases": [
          { "binding": "DB", "database_name": "zes-builder", "database_id": "production-id" }
        ]
      }
      `,
    );

    const result = runGuard(path);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('env.preview');
  });

  it('rejects a preview environment that uses the production database', () => {
    const path = writeFixture(
      'shared-database.jsonc',
      `{
        "name": "bolt",
        "d1_databases": [
          { "binding": "DB", "database_name": "zes-builder", "database_id": "production-id" }
        ],
        "env": {
          "preview": {
            "name": "bolt-preview",
            "d1_databases": [
              { "binding": "DB", "database_name": "zes-builder", "database_id": "production-id" }
            ]
          }
        }
      }
      `,
    );

    const result = runGuard(path);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('production database id');
  });

  it('rejects a preview environment that reuses the production worker name', () => {
    const path = writeFixture(
      'shared-name.jsonc',
      `{
        "name": "bolt",
        "d1_databases": [
          { "binding": "DB", "database_name": "zes-builder", "database_id": "production-id" }
        ],
        "env": {
          "preview": {
            "name": "bolt",
            "d1_databases": [
              { "binding": "DB", "database_name": "zes-builder-preview", "database_id": "preview-id" }
            ]
          }
        }
      }
      `,
    );

    const result = runGuard(path);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('production worker name');
  });

  it('accepts an isolated configuration', () => {
    const path = writeFixture('isolated.jsonc', ISOLATED_CONFIG);

    const result = runGuard(path);

    expect(result.status).toBe(0);
  });

  it('accepts the shipped CMS configuration with the expected preview values', () => {
    const result = runGuard({
      configPaths: ['workers/cms-api/wrangler.jsonc'],
      env: {
        PREVIEW_ISOLATION_EXPECTATIONS: JSON.stringify({
          'workers/cms-api/wrangler.jsonc': {
            workerName: 'zes-cms-api-preview',
            databaseId: '0062fbf8-5cd3-4552-9115-ec3edd3e933c',
          },
        }),
      },
    });

    expect(result.status).toBe(0);
  });

  it('rejects a preview worker name that differs from the expected worker name', () => {
    const result = runGuard({
      configPaths: ['workers/cms-api/wrangler.jsonc'],
      env: {
        PREVIEW_ISOLATION_EXPECTATIONS: JSON.stringify({
          'workers/cms-api/wrangler.jsonc': { workerName: 'zes-cms-api-preview-wrong' },
        }),
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('expected worker name');
  });

  it('rejects a preview database id that differs from the expected database id', () => {
    const result = runGuard({
      configPaths: ['workers/cms-api/wrangler.jsonc'],
      env: {
        PREVIEW_ISOLATION_EXPECTATIONS: JSON.stringify({
          'workers/cms-api/wrangler.jsonc': { databaseId: '00000000-0000-0000-0000-000000000000' },
        }),
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('expected database id');
  });

  it('rejects an expected preview worker name that is the production worker name', () => {
    const result = runGuard({
      configPaths: ['workers/cms-api/wrangler.jsonc'],
      env: {
        PREVIEW_ISOLATION_EXPECTATIONS: JSON.stringify({
          'workers/cms-api/wrangler.jsonc': { workerName: 'zes-cms-api' },
        }),
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('production worker name');
  });

  it('rejects malformed expectations', () => {
    const result = runGuard({
      configPaths: ['workers/cms-api/wrangler.jsonc'],
      env: { PREVIEW_ISOLATION_EXPECTATIONS: '{not json' },
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('PREVIEW_ISOLATION_EXPECTATIONS');
  });
});
