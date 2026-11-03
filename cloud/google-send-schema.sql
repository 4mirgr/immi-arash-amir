-- Server-only D1 data. Every statement is explicitly owner-scoped.
CREATE TABLE IF NOT EXISTS google_send_queue (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  profile_id TEXT NOT NULL CHECK(profile_id IN ('arash','amir')),
  google_subject TEXT NOT NULL,
  google_email TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  raw_mime TEXT NOT NULL,
  cv_version_id TEXT,
  attachment_name TEXT,
  reply_thread_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','sending','sent','delivery_unknown','failed','suppressed')),
  created_at TEXT NOT NULL,
  created_day TEXT NOT NULL,
  attempt_day TEXT,
  attempted_at TEXT,
  gmail_message_id TEXT,
  UNIQUE(owner_id,fingerprint)
);
CREATE INDEX IF NOT EXISTS google_send_queue_owner_created ON google_send_queue(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS google_send_queue_owner_day ON google_send_queue(owner_id,created_day);
CREATE INDEX IF NOT EXISTS google_send_queue_attempt_day ON google_send_queue(owner_id,attempt_day);
CREATE TABLE IF NOT EXISTS google_send_suppressions (
  owner_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,email)
);
