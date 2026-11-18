-- Private progressive Sent/clinic-thread reader. Never copy this data to the
-- shared opportunity bank. Replacing a Google subject cannot expose old rows.
CREATE TABLE IF NOT EXISTS google_mail_correspondence_scan (
 owner_id TEXT NOT NULL, google_sub TEXT NOT NULL,
 page_token TEXT, pending_sent_ids TEXT NOT NULL DEFAULT '[]',
 backfill_complete INTEGER NOT NULL DEFAULT 0,
 cycle_complete INTEGER NOT NULL DEFAULT 0,
 scan_started_at INTEGER NOT NULL, scan_after INTEGER NOT NULL DEFAULT 0,
 scanned_count INTEGER NOT NULL DEFAULT 0, matched_sent_count INTEGER NOT NULL DEFAULT 0,
 last_synced_at INTEGER, next_scan_at INTEGER NOT NULL DEFAULT 0,
 next_lane INTEGER NOT NULL DEFAULT 0,
 pending_thread_id TEXT, pending_thread_messages TEXT NOT NULL DEFAULT '[]',
 pending_snapshot_ids TEXT NOT NULL DEFAULT '[]',
 pending_checked_at INTEGER, last_error TEXT,
 lock_token TEXT, lock_until INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(owner_id,google_sub)
);
CREATE TABLE IF NOT EXISTS google_mail_correspondence_threads (
 owner_id TEXT NOT NULL, google_sub TEXT NOT NULL, thread_id TEXT NOT NULL,
 discovered_at INTEGER NOT NULL, last_checked_at INTEGER,
 complete INTEGER NOT NULL DEFAULT 0, last_error TEXT,
 PRIMARY KEY(owner_id,google_sub,thread_id)
);
CREATE INDEX IF NOT EXISTS google_mail_correspondence_threads_due
 ON google_mail_correspondence_threads(owner_id,google_sub,last_checked_at);
