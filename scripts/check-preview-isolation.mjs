#!/usr/bin/env node
/**
 * Preview isolation guard.
 *
 * A preview deployment must never be able to touch production data. Two
 * mistakes made that possible:
 *
 * 1. `wrangler deploy --env <name>` with an environment that does not exist in
 *    the configuration silently falls back to the top-level configuration —
 *    which points at the production database.
 * 2. An environment section that repeats the production database id, which
 *    looks isolated but is not.
 *
 * The guard reads the Wrangler configurations and fails when
 *
 * - an environment `preview` section is missing,
 * - the preview database id equals the production database id,
 * - the preview database name equals the production database name,
 * - the preview worker name equals the production worker name,
 * - the preview database id differs from `PREVIEW_D1_DATABASE_ID`, when that
 *   variable is set, or
 * - the preview worker name or database id differs from the expected value of
 *   the configuration, when one is configured.
 *
 * Usage:
 *
 * ```
 * node scripts/check-preview-isolation.mjs [config ...]
 * ```
 *
 * The expected values are read from the environment:
 *
 * - `PREVIEW_D1_DATABASE_ID` — the database id every preview environment has to
 *   use.
 * - `PREVIEW_ISOLATION_EXPECTATIONS` — a JSON object that maps a configuration
 *   path to its expected values:
 *
 *   ```json
 *   {
 *     "workers/cms-api/wrangler.jsonc": {
 *       "workerName": "zes-cms-api-preview",
 *       "databaseId": "0062fbf8-5cd3-4552-9115-ec3edd3e933c"
 *     }
 *   }
 *   ```
 *
 *   The keys are matched against the configuration path as it was passed on the
 *   command line. A configuration without an entry is only checked against the
 *   global rules.
 *
 * The exit code is `0` when every configuration is isolated and `1` otherwise.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIGS = ['wrangler.jsonc', 'workers/cms-api/wrangler.jsonc'];

/**
 * Normalises a JSONC document to plain JSON.
 *
 * Comments are removed and the trailing commas of the last property are
 * dropped, because `JSON.parse` accepts neither of them while the Wrangler
 * configuration format allows both.
 */
export function normalizeJsonc(text) {
  let result = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (character === '\n') {
        inLineComment = false;
        result += character;
      }

      continue;
    }

    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }

      continue;
    }

    if (inString) {
      result += character;

      if (character === '\\') {
        result += next ?? '';
        index += 1;
        continue;
      }

      if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }

    if (character === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (character === ',') {
      let lookahead = index + 1;

      while (lookahead < text.length && /\s/.test(text[lookahead])) {
        lookahead += 1;
      }

      if (text[lookahead] === '}' || text[lookahead] === ']') {
        continue;
      }
    }

    result += character;
  }

  return result;
}

function readConfig(path) {
  return JSON.parse(normalizeJsonc(readFileSync(path, 'utf8')));
}

function databaseIds(databases) {
  if (!Array.isArray(databases)) {
    return [];
  }

  return databases.map((database) => ({
    id: database?.database_id,
    name: database?.database_name,
    binding: database?.binding,
  }));
}

/** The values a configuration has to match. */
export function normalizeExpectations(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const workerName = typeof value.workerName === 'string' ? value.workerName.trim() : '';
  const databaseId = typeof value.databaseId === 'string' ? value.databaseId.trim() : '';

  return {
    ...(workerName ? { workerName } : {}),
    ...(databaseId ? { databaseId } : {}),
  };
}

/** Reads the per-configuration expectations from the environment. */
export function readExpectations(raw) {
  if (!raw || !raw.trim()) {
    return {};
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PREVIEW_ISOLATION_EXPECTATIONS is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PREVIEW_ISOLATION_EXPECTATIONS has to be a JSON object');
  }

  const expectations = {};

  for (const [path, value] of Object.entries(parsed)) {
    expectations[path] = normalizeExpectations(value);
  }

  return expectations;
}

/** Returns the list of isolation problems of one configuration. */
export function checkIsolation(config, label, expectedPreviewId, expectations = {}) {
  const problems = [];
  const production = databaseIds(config?.d1_databases);
  const previewSection = config?.env?.preview;

  if (!previewSection) {
    problems.push(`${label}: the environment section "env.preview" is missing`);

    return problems;
  }

  const preview = databaseIds(previewSection.d1_databases);

  if (preview.length === 0) {
    problems.push(`${label}: the environment section "env.preview" has no database binding`);
  }

  for (const productionDatabase of production) {
    for (const previewDatabase of preview) {
      if (productionDatabase.id && previewDatabase.id && productionDatabase.id === previewDatabase.id) {
        problems.push(
          `${label}: the preview database id ${previewDatabase.id} is the production database id (${productionDatabase.name})`,
        );
      }

      if (productionDatabase.name && previewDatabase.name && productionDatabase.name === previewDatabase.name) {
        problems.push(`${label}: the preview database name "${previewDatabase.name}" is the production database name`);
      }
    }
  }

  if (previewSection.name && config?.name && previewSection.name === config.name) {
    problems.push(`${label}: the preview worker name "${previewSection.name}" is the production worker name`);
  }

  const expectedDatabaseId = expectations.databaseId ?? expectedPreviewId;

  if (expectedDatabaseId) {
    const matches = preview.some((database) => database.id === expectedDatabaseId);

    if (!matches) {
      problems.push(
        `${label}: the preview database id does not match the expected database id (${expectedDatabaseId})`,
      );
    }
  }

  if (expectations.workerName) {
    if (!previewSection.name) {
      problems.push(`${label}: the environment section "env.preview" has no worker name`);
    } else if (previewSection.name !== expectations.workerName) {
      problems.push(
        `${label}: the preview worker name "${previewSection.name}" is not the expected worker name (${expectations.workerName})`,
      );
    }

    if (config?.name && config.name === expectations.workerName) {
      problems.push(
        `${label}: the expected preview worker name (${expectations.workerName}) is the production worker name`,
      );
    }
  }

  return problems;
}

function main(argv) {
  const paths = argv.length > 0 ? argv : DEFAULT_CONFIGS;
  const expectedPreviewId = process.env.PREVIEW_D1_DATABASE_ID?.trim() || '';
  const problems = [];

  let expectationsByPath;

  try {
    expectationsByPath = readExpectations(process.env.PREVIEW_ISOLATION_EXPECTATIONS);
  } catch (error) {
    console.error(`❌ preview isolation check failed`);
    console.error(`   - ${error instanceof Error ? error.message : String(error)}`);

    process.exit(1);
  }

  for (const path of paths) {
    const absolute = resolve(path);

    let config;

    try {
      config = readConfig(absolute);
    } catch (error) {
      problems.push(
        `${path}: the configuration could not be read (${error instanceof Error ? error.message : String(error)})`,
      );

      continue;
    }

    const expectations = expectationsByPath[path] ?? expectationsByPath[absolute] ?? {};

    problems.push(...checkIsolation(config, path, expectedPreviewId, expectations));
  }

  if (problems.length > 0) {
    console.error('❌ preview isolation check failed');

    for (const problem of problems) {
      console.error(`   - ${problem}`);
    }

    process.exit(1);
  }

  console.log(`✅ preview isolation verified for ${paths.join(', ')}`);

  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
