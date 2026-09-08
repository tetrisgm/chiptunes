-- Explicit migration AFTER music-agent-schema.sql, dedicated database only.
-- No startup migration, cleanup timer, credentials, or public database access.
CREATE TABLE IF NOT EXISTS music_agent_connection_owners (
  issuer text NOT NULL,
  subject text NOT NULL,
  PRIMARY KEY (issuer, subject)
);
CREATE TABLE IF NOT EXISTS music_agent_connections (
  issuer text NOT NULL,
  subject text NOT NULL,
  client_id text NOT NULL,
  scopes jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  session_id text UNIQUE REFERENCES music_agent_sessions(id),
  PRIMARY KEY (issuer, subject, client_id),
  FOREIGN KEY (issuer, subject) REFERENCES music_agent_connection_owners(issuer, subject)
);
REVOKE ALL ON music_agent_connection_owners, music_agent_connections FROM PUBLIC;
