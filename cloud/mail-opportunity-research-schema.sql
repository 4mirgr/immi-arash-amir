-- Private progress only. Public page readings here must never enter shared
-- opportunity/clinic tables merely because a private Gmail message linked them.
CREATE TABLE IF NOT EXISTS private_mail_opportunity_research (
 opportunity_id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 google_sub TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0,
 source_updated_at INTEGER NOT NULL DEFAULT 0,
 last_read_at INTEGER,
 last_error TEXT,
 receipt_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS private_mail_research_due
 ON private_mail_opportunity_research(next_attempt_at,lease_until,source_updated_at);
