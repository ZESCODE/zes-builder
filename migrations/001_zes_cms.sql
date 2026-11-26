-- ZES Builder CMS schema — Phase 1B
--
-- Website projects only. CMS articles, categories, tags, media and publishing
-- tables belong to later phases and are deliberately absent.
--
-- The slug rule lives in the database: the partial unique index below allows a
-- soft-deleted website to release its slug while still rejecting a duplicate
-- for an active website of the same tenant.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  whop_principal TEXT UNIQUE NOT NULL,
  email TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS website_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  template_id TEXT,
  theme_json TEXT NOT NULL DEFAULT '{}',
  domain TEXT,
  deploy_target TEXT CHECK (deploy_target IN ('cloudflare','netlify','vercel','custom','zes-cms')),
  deploy_config_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_website_projects_user_slug
  ON website_projects(user_id, slug) WHERE deleted_at IS NULL;
