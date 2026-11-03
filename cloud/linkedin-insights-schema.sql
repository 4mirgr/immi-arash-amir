-- Actual provider measurements, strictly separate from manual snapshots and pinned to LinkedIn identity.
CREATE TABLE IF NOT EXISTS linkedin_insight_snapshots (
 owner_id TEXT NOT NULL,
 linkedin_sub TEXT NOT NULL,
 measured_at INTEGER NOT NULL,
 followers INTEGER NOT NULL CHECK(followers >= 0),
 PRIMARY KEY(owner_id,linkedin_sub,measured_at)
);
CREATE TABLE IF NOT EXISTS linkedin_insight_checks (
 owner_id TEXT PRIMARY KEY,
 linkedin_sub TEXT NOT NULL,
 next_check_at INTEGER NOT NULL
);
