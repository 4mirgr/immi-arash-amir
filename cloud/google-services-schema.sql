-- Server-only Calendar cache; Google identity is part of every owner cache key.
CREATE TABLE IF NOT EXISTS google_calendar_state (
  owner_id TEXT NOT NULL, google_sub TEXT NOT NULL,
  window_min TEXT NOT NULL, window_max TEXT NOT NULL,
  sync_token TEXT, page_token TEXT, checked_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id,google_sub)
);
CREATE TABLE IF NOT EXISTS google_calendar_events (
  owner_id TEXT NOT NULL, google_sub TEXT NOT NULL, event_id TEXT NOT NULL,
  start_time TEXT NOT NULL, end_time TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY(owner_id,google_sub,event_id)
);
CREATE INDEX IF NOT EXISTS google_calendar_owner_time ON google_calendar_events(owner_id,google_sub,start_time);
CREATE TABLE IF NOT EXISTS google_calendar_locks (
  owner_id TEXT NOT NULL, google_sub TEXT NOT NULL, lease TEXT NOT NULL,
  expires_at INTEGER NOT NULL, PRIMARY KEY(owner_id,google_sub)
);
