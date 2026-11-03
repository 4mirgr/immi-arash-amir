-- Runtime receipts for fixed public feeds; no profile credentials or private correspondence.
CREATE TABLE IF NOT EXISTS registered_source_checks (
 source_id TEXT PRIMARY KEY,
 status TEXT NOT NULL DEFAULT 'not_checked',
 etag TEXT,
 last_attempt_at INTEGER,
 last_success_at INTEGER,
 next_check_at INTEGER NOT NULL DEFAULT 0,
 last_error_code TEXT,
 imported_records INTEGER NOT NULL DEFAULT 0,
 record_cursor INTEGER NOT NULL DEFAULT 0,
 partial INTEGER NOT NULL DEFAULT 0,
 lock_token TEXT,
 lock_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS source_collector_state (
 id TEXT PRIMARY KEY CHECK(id='rotation'),
 position INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO source_collector_state(id,position) VALUES('rotation',0);
