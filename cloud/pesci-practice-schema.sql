-- Private self-reflection, not official examination scores or verified credentials.
CREATE TABLE IF NOT EXISTS pesci_practice_sessions (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 case_id TEXT NOT NULL,
 case_version INTEGER NOT NULL,
 answer TEXT NOT NULL,
 reflections_json TEXT NOT NULL,
 elapsed_seconds INTEGER NOT NULL CHECK(elapsed_seconds BETWEEN 0 AND 7200),
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pesci_practice_owner_history ON pesci_practice_sessions(owner_id,created_at DESC);
