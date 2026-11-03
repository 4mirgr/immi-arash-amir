-- Server-only D1 mailbox cache. Every key and query includes authenticated owner
-- plus verified Google subject; account replacement cannot expose an old mailbox.
CREATE TABLE IF NOT EXISTS google_mail_messages (
 owner_id TEXT NOT NULL, google_sub TEXT NOT NULL, gmail_id TEXT NOT NULL,
 thread_id TEXT NOT NULL, message_date INTEGER NOT NULL, priority TEXT NOT NULL,
 data TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,google_sub,gmail_id)
);
CREATE INDEX IF NOT EXISTS google_mail_owner_priority_date ON google_mail_messages(owner_id,google_sub,priority,message_date DESC);
CREATE TABLE IF NOT EXISTS google_mail_sync (
 owner_id TEXT NOT NULL, google_sub TEXT NOT NULL, history_id TEXT,
 page_token TEXT, pending_ids TEXT NOT NULL DEFAULT '[]', pending_history_id TEXT,
 last_synced_at INTEGER, coverage TEXT NOT NULL DEFAULT 'not_synced',
 lock_token TEXT, lock_until INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(owner_id,google_sub)
);
