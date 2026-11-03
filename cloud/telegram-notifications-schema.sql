-- Owner-private Telegram destinations and bounded notification receipts.
CREATE TABLE IF NOT EXISTS telegram_accounts (
 owner_id TEXT PRIMARY KEY,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('amir','arash')),
 chat_id TEXT NOT NULL UNIQUE,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 enabled_since TEXT,
 quiet_start INTEGER NOT NULL DEFAULT 22 CHECK(quiet_start BETWEEN 0 AND 23),
 quiet_end INTEGER NOT NULL DEFAULT 8 CHECK(quiet_end BETWEEN 0 AND 23),
 linked_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 last_dispatch_at INTEGER
);
CREATE TABLE IF NOT EXISTS telegram_link_states (
 nonce_hash TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('amir','arash')),
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS telegram_links_owner ON telegram_link_states(owner_id);
CREATE TABLE IF NOT EXISTS telegram_notification_receipts (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 event_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('opportunity','test')),
 status TEXT NOT NULL CHECK(status IN ('sending','sent','failed','delivery_unknown','cancelled')),
 created_at INTEGER NOT NULL,
 created_day TEXT NOT NULL,
 telegram_message_id INTEGER,
 UNIQUE(owner_id,event_key)
);
CREATE INDEX IF NOT EXISTS telegram_receipts_owner_day ON telegram_notification_receipts(owner_id,created_day);
CREATE TABLE IF NOT EXISTS telegram_bot_state (
 id TEXT PRIMARY KEY CHECK(id='bot'),
 username TEXT NOT NULL,
 identity_hash TEXT NOT NULL,
 checked_at INTEGER NOT NULL,
 registration_hash TEXT,
 webhook_registered_at INTEGER
);
