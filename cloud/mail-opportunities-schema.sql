-- Owner-private Gmail opportunity findings. These are never shared clinic rows.
CREATE TABLE IF NOT EXISTS private_mail_opportunity_inputs (
 owner_id TEXT NOT NULL,
 root_owner_id TEXT NOT NULL,
 profile_id TEXT NOT NULL CHECK(profile_id='arash'),
 google_sub TEXT NOT NULL,
 gmail_id TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','completed','source_removed')),
 candidate_offset INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,google_sub,gmail_id)
);
CREATE INDEX IF NOT EXISTS private_mail_inputs_due ON private_mail_opportunity_inputs(owner_id,google_sub,status,lease_until,created_at);
CREATE TABLE IF NOT EXISTS private_mail_opportunities (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 root_owner_id TEXT NOT NULL,
 profile_id TEXT NOT NULL CHECK(profile_id='arash'),
 google_sub TEXT NOT NULL,
 gmail_id TEXT NOT NULL,
 thread_id TEXT NOT NULL,
 source_url TEXT,
 title TEXT NOT NULL,
 clinic_name TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested','reviewed','source_removed','dismissed')),
 fit_json TEXT NOT NULL DEFAULT '{}',
 data_json TEXT NOT NULL DEFAULT '{}',
 draft_json TEXT,
 received_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 read_at INTEGER,
 notification_eligible INTEGER NOT NULL DEFAULT 0,
 notification_claimed_at INTEGER,
 notification_sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS private_mail_opportunities_owner ON private_mail_opportunities(owner_id,google_sub,received_at DESC);
CREATE INDEX IF NOT EXISTS private_mail_opportunities_source ON private_mail_opportunities(owner_id,google_sub,gmail_id);
CREATE INDEX IF NOT EXISTS private_mail_opportunities_alerts ON private_mail_opportunities(notification_eligible,notification_sent_at,received_at);
