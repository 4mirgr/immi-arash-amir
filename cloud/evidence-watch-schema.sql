-- Public source availability/change receipts; never user profile or credentials.
CREATE TABLE IF NOT EXISTS evidence_source_checks (
 source_url TEXT PRIMARY KEY,
 status TEXT NOT NULL,
 content_hash TEXT,
 etag TEXT,
 last_modified TEXT,
 last_attempt_at INTEGER NOT NULL,
 last_success_at INTEGER,
 next_check_at INTEGER NOT NULL,
 change_detected_at INTEGER,
 error_code TEXT
);
