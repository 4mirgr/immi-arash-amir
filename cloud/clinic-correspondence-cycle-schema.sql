-- Safe read receipts only. No tokens, sender bodies or transport approvals.
CREATE TABLE IF NOT EXISTS google_mail_correspondence_activity (
  owner_id TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  code TEXT,
  receipt_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(owner_id,google_sub)
);
