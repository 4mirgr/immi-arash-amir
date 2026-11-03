-- Rebuild only owner preparation jobs, preserving IDs, snapshots and provider queue references.
-- Execute ALL statements in a single transaction. In D1 use one db.batch([...]) call;
-- explicit BEGIN/COMMIT SQL is not supported by D1. Do not submit separately.
-- No provider queue, scheduled approval, suppression, event or credential table is changed.
CREATE TABLE mail_automation_jobs_rebuild_v2 (
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
 UNIQUE(owner_id,opportunity_id,recipient)
);
INSERT INTO mail_automation_jobs_rebuild_v2(id,owner_id,opportunity_id,recipient,mailbox,status,snapshot_json,queue_id,created_at,created_day,updated_at)
 SELECT id,owner_id,opportunity_id,recipient,mailbox,status,snapshot_json,queue_id,created_at,created_day,updated_at FROM mail_automation_jobs;
DROP TABLE mail_automation_jobs;
ALTER TABLE mail_automation_jobs_rebuild_v2 RENAME TO mail_automation_jobs;
CREATE INDEX mail_automation_jobs_owner_day ON mail_automation_jobs(owner_id,created_day);
