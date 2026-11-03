-- Durable, explicit per-job authorization for a frozen Gmail queue item.
CREATE TABLE IF NOT EXISTS mail_scheduled_approvals (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('amir','arash')),
 job_id TEXT NOT NULL,
 queue_id TEXT NOT NULL,
 queue_digest TEXT NOT NULL,
 mailbox TEXT NOT NULL CHECK(mailbox IN ('primary','secondary')),
 google_subject TEXT NOT NULL,
 sender TEXT NOT NULL,
 recipient TEXT NOT NULL,
 cv_version_id TEXT NOT NULL,
 consent_version TEXT NOT NULL,
 send_after INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('approved','sending','sent','delivery_unknown','failed','blocked','cancelled','expired')),
 reason TEXT,
 gmail_message_id TEXT,
 attempted_at INTEGER,
 attempt_day TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_scheduled_active_job ON mail_scheduled_approvals(owner_id,job_id) WHERE status IN ('approved','sending');
CREATE INDEX IF NOT EXISTS mail_scheduled_due ON mail_scheduled_approvals(status,send_after,expires_at);
CREATE INDEX IF NOT EXISTS mail_scheduled_owner_day ON mail_scheduled_approvals(owner_id,attempt_day);
