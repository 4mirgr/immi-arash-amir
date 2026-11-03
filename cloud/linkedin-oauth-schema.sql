-- Server-only owner-bound LinkedIn grants, separate from Google identities.
CREATE TABLE IF NOT EXISTS linkedin_accounts (
 owner_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL CHECK(profile_id IN ('arash','amir')),
 linkedin_sub TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT,
 scopes_json TEXT NOT NULL, token_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('connected','reconnect_required')), updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS linkedin_oauth_states (
 state_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, profile_id TEXT NOT NULL,
 browser_hash TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS linkedin_oauth_states_expiry ON linkedin_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS linkedin_publish_attempts (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, post_id TEXT NOT NULL,
 author_sub TEXT NOT NULL, content_hash TEXT NOT NULL, status TEXT NOT NULL,
 created_at TEXT NOT NULL, created_day TEXT NOT NULL, provider_urn TEXT,
 UNIQUE(owner_id,post_id)
);
CREATE INDEX IF NOT EXISTS linkedin_publish_owner_day ON linkedin_publish_attempts(owner_id,created_day);
