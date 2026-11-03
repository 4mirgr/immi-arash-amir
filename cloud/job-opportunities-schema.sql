-- Public-source job listings only. Server-only D1, separate from private Google data.
CREATE TABLE IF NOT EXISTS job_source_checks (
 source_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'not_checked',
 etag TEXT, last_attempt_at INTEGER, last_success_at INTEGER,
 next_check_at INTEGER NOT NULL DEFAULT 0, lock_token TEXT, lock_until INTEGER NOT NULL DEFAULT 0,
 last_error_code TEXT, medical_listings INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS job_opportunities (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL, title TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('vacancy','employment_register')),
 state TEXT NOT NULL, published_at TEXT, closing_at TEXT,
 first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('open','future','closed','source_removed')),
 data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_opportunities_source_seen ON job_opportunities(source_id,last_seen_at);
CREATE INDEX IF NOT EXISTS job_opportunities_state_kind_closing ON job_opportunities(state,kind,closing_at);
