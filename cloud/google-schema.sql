-- Server-only Cloudflare D1 database. No browser DB access or actual credentials.
CREATE TABLE IF NOT EXISTS google_accounts (
  owner_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL CHECK(profile_id IN ('arash','amir')),
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  token_cipher TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('connected','reconnect_required')),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS google_oauth_states (
  state_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  profile_id TEXT NOT NULL CHECK(profile_id IN ('arash','amir')),
  browser_hash TEXT NOT NULL,
  verifier_cipher TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS google_oauth_states_expiry ON google_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS google_oauth_states_owner ON google_oauth_states(owner_id);

-- Safe troubleshooting identifiers only; never provider content or credentials.
CREATE TABLE IF NOT EXISTS google_oauth_diagnostics (
 id TEXT PRIMARY KEY, owner_id TEXT,
 stage TEXT NOT NULL CHECK(stage IN ('configuration','state','browser_binding','state_consume','token_exchange','identity','refresh_grant','account_store')),
 code TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS google_oauth_diagnostics_owner_time ON google_oauth_diagnostics(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS google_oauth_diagnostics_time ON google_oauth_diagnostics(created_at);
