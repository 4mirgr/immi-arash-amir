-- Explicit per-post approval only; existing manual schedules never enter this table.
CREATE TABLE IF NOT EXISTS linkedin_scheduled_approvals (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('amir','arash')),
 post_id TEXT NOT NULL,
 author_sub TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 grant_fingerprint TEXT NOT NULL,
 scheduled_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('approved','dispatching','published','delivery_unknown','failed','cancelled','blocked','missed')),
 reason TEXT,
 provider_urn TEXT,
 approved_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(owner_id,post_id)
);
CREATE INDEX IF NOT EXISTS linkedin_scheduled_due ON linkedin_scheduled_approvals(status,scheduled_at);
CREATE INDEX IF NOT EXISTS linkedin_scheduled_owner ON linkedin_scheduled_approvals(owner_id,updated_at DESC);
