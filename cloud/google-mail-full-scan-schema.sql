-- All folders are read progressively; only relevant content is retained privately.
CREATE TABLE IF NOT EXISTS google_mail_full_scan (
 owner_id TEXT NOT NULL, google_sub TEXT NOT NULL,
 archive_page_token TEXT, archive_pending_ids TEXT NOT NULL DEFAULT '[]',
 archive_complete INTEGER NOT NULL DEFAULT 0, archive_started_at INTEGER NOT NULL,
 archive_scanned_count INTEGER NOT NULL DEFAULT 0,
 archive_sent_count INTEGER NOT NULL DEFAULT 0, archive_received_count INTEGER NOT NULL DEFAULT 0,
 related_count INTEGER NOT NULL DEFAULT 0, related_sent_count INTEGER NOT NULL DEFAULT 0,
 ignored_label_count INTEGER NOT NULL DEFAULT 0, has_analysis_limits INTEGER NOT NULL DEFAULT 0,
 history_id TEXT, history_page_token TEXT,
 history_pending_ids TEXT NOT NULL DEFAULT '[]', history_deleted_ids TEXT NOT NULL DEFAULT '[]',
 history_pending_target TEXT, history_caught_up INTEGER NOT NULL DEFAULT 0,
 history_last_synced_at INTEGER, history_reviewed_count INTEGER NOT NULL DEFAULT 0,
 history_gap_since INTEGER, history_recovery_after INTEGER NOT NULL DEFAULT 0,
 history_recovery_page_token TEXT, history_recovery_active INTEGER NOT NULL DEFAULT 0,
 gap_rescan_active INTEGER NOT NULL DEFAULT 0, last_full_scan_at INTEGER,
 last_synced_at INTEGER, next_lane INTEGER NOT NULL DEFAULT 0,
 pending_thread_id TEXT, pending_thread_messages TEXT NOT NULL DEFAULT '[]',
 pending_snapshot_ids TEXT NOT NULL DEFAULT '[]', pending_checked_at INTEGER,
 last_error TEXT, lock_token TEXT, lock_until INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(owner_id,google_sub)
);
-- Unsupported messages are explicit errors, never silently counted as fully read.
CREATE TABLE IF NOT EXISTS google_mail_full_scan_errors (
 owner_id TEXT NOT NULL, google_sub TEXT NOT NULL, gmail_id TEXT NOT NULL,
 source TEXT NOT NULL, code TEXT NOT NULL, checked_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,google_sub,gmail_id)
);
