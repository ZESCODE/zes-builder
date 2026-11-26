/**
 * Resolves the Cloudflare D1 binding from a React Router request context.
 *
 * The binding is looked up by name — `D1_BINDING`, default `DB` — because the
 * binding name is a deployment concern, not a code concern. The resolver returns
 * undefined when the binding is missing or does not look like a D1 database, so
 * the storage factory can fail closed instead of crashing.
 */

import type { D1Database } from '~/lib/storage/adapters/d1';

export const DEFAULT_D1_BINDING_NAME = 'DB';

function isD1Database(value: unknown): value is D1Database {
  return typeof value === 'object' && value !== null && typeof (value as D1Database).prepare === 'function';
}

interface BindingContext {
  cloudflare?: { env?: Record<string, unknown> };
}

/**
 * Returns the D1 binding of the current request, or undefined when the
 * deployment has no D1 binding configured.
 */
export function resolveD1Binding(context: unknown): D1Database | undefined {
  const env = (context as BindingContext | undefined)?.cloudflare?.env;

  if (!env) {
    return undefined;
  }

  const bindingName =
    (env.D1_BINDING as string | undefined)?.trim() || process.env.D1_BINDING?.trim() || DEFAULT_D1_BINDING_NAME;

  const binding = env[bindingName];

  return isD1Database(binding) ? binding : undefined;
}
