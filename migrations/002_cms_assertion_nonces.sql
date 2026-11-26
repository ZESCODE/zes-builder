-- ZES Builder CMS schema — Phase 1C.1
--
-- Replay protection for the signed tenant assertions of the CMS API Worker.
--
-- Every assertion carries a random nonce. The Worker records the nonce before
-- it executes the request, so a captured assertion cannot be replayed — not on
-- another isolate, not on another edge location and not after a restart.
--
-- The table is shared by every request of the deployment, which is why the
-- nonce is stored in D1 instead of in the memory of a Worker isolate.

CREATE TABLE IF NOT EXISTS cms_assertion_nonces (
  nonce TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cms_assertion_nonces_expires_at
  ON cms_assertion_nonces(expires_at);
