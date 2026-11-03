-- Private preparation records. No background sends are enabled by these tables.
CREATE TABLE IF NOT EXISTS mail_automation_settings (
 owner_id TEXT PRIMARY KEY,
 requested_mode TEXT NOT NULL DEFAULT 'draft_only',
 mailbox TEXT NOT NULL DEFAULT 'primary',
 daily_limit INTEGER NOT NULL DEFAULT 3 CHECK(daily_limit BETWEEN 1 AND 3),
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_automation_jobs (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 opportunity_id TEXT NOT NULL,
 recipient TEXT NOT NULL,
 mailbox TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','preparing','queued','blocked','suppressed')),
 snapshot_json TEXT NOT NULL,
 queue_id TEXT,
 created_at TEXT NOT NULL,
 created_day TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(owner_id,opportunity_id),
 UNIQUE(owner_id,recipient)
);
CREATE INDEX IF NOT EXISTS mail_automation_jobs_owner_day ON mail_automation_jobs(owner_id,created_day);
CREATE TABLE IF NOT EXISTS mail_automation_suppressions (
 owner_id TEXT NOT NULL,
 email TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,email)
);
CREATE TABLE IF NOT EXISTS mail_automation_events (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 opportunity_id TEXT,
 action TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_automation_events_owner_time ON mail_automation_events(owner_id,created_at DESC);
