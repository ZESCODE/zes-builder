/**
 * Environment contract of the CMS API Worker.
 *
 * The Worker is a separate, minimal deployment: it owns the D1 binding and the
 * CMS/website storage API, and nothing else. It never imports the React Router
 * server build, the Hub client, the MCP services or any Node-only module.
 *
 * | Binding / variable | Kind | Purpose |
 * | --- | --- | --- |
 * | `DB` | D1 binding | The `zes-builder` database. |
 * | `STORAGE_BACKEND` | var | Must be `d1`; the adapter factory fails closed otherwise. |
 * | `CMS_SERVICE_TOKEN` | secret | Bearer token that authenticates the calling service. |
 * | `CMS_ASSERTION_SECRET` | secret | HMAC key for the signed tenant assertion. |
 * | `CMS_SERVICE_ID` | var | Identity the caller must present. Defaults to `zes-builder-web`. |
 * | `CMS_ASSERTION_AUDIENCE` | var | Audience the assertion must target. Defaults to `zes-cms-api`. |
 * | `CMS_ASSERTION_WINDOW_MS` | var | Validity window of an assertion. Defaults to 30000. |
 */

import type { D1Database } from '~/lib/storage/adapters/d1';

export interface CmsApiEnv {
  DB: D1Database;
  STORAGE_BACKEND: string;
  CMS_SERVICE_TOKEN: string;
  CMS_ASSERTION_SECRET: string;
  CMS_SERVICE_ID?: string;
  CMS_ASSERTION_AUDIENCE?: string;
  CMS_ASSERTION_WINDOW_MS?: string;
}
