-- Explicit migration for the dedicated Chiptunes agent database only.
-- Do not run against another project's database. No scheduled cleanup is
-- installed; retention/purge must be configured before public enablement.
CREATE TABLE IF NOT EXISTS music_agent_sessions (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  record jsonb NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- No browser/anonymous database role should have direct table access.
REVOKE ALL ON music_agent_sessions FROM PUBLIC;
