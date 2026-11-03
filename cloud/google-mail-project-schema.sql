-- Independent bounded historic Gmail search. Private by owner + provider subject.
CREATE TABLE IF NOT EXISTS google_mail_project_search (
 owner_id TEXT NOT NULL,
 google_sub TEXT NOT NULL,
 page_token TEXT,
 completed INTEGER NOT NULL DEFAULT 0,
 scanned_count INTEGER NOT NULL DEFAULT 0,
 last_synced_at INTEGER,
 lock_token TEXT,
 lock_until INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(owner_id,google_sub)
);
