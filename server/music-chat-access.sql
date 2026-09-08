-- Explicit migration on the dedicated chat database only. Never run at startup.
-- No prompts, source, passwords, cookies, or provider credentials are stored.
CREATE TABLE IF NOT EXISTS music_chat_budget (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  day_start bigint NOT NULL DEFAULT 0,
  day_count integer NOT NULL DEFAULT 0 CHECK (day_count BETWEEN 0 AND 20),
  minute_start bigint NOT NULL DEFAULT 0,
  minute_count integer NOT NULL DEFAULT 0 CHECK (minute_count BETWEEN 0 AND 2),
  last_time bigint NOT NULL DEFAULT 0,
  active_request text,
  lease_until bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS music_chat_requests (
  request_id text PRIMARY KEY CHECK (request_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  subject text NOT NULL CHECK (subject = 'chat-owner'),
  reserved_at bigint NOT NULL,
  lease_until bigint NOT NULL,
  released_at bigint,
  CHECK (lease_until = reserved_at + 45000)
);
INSERT INTO music_chat_budget (singleton) VALUES (true) ON CONFLICT DO NOTHING;
-- Request IDs remain as minimal replay tombstones indefinitely. Deleting them
-- would permit a previously charged request to call a provider again.
REVOKE ALL ON music_chat_budget, music_chat_requests FROM PUBLIC;
