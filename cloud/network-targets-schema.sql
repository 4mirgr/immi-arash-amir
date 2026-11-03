-- Owner-private follow-up state derived from public opportunity records only.
CREATE TABLE IF NOT EXISTS linkedin_network_targets (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 opportunity_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('to_research','shortlisted','reviewed','contacted','follow_up','archived')),
 goal TEXT NOT NULL CHECK(goal IN ('job','research','training','funding')),
 notes TEXT NOT NULL DEFAULT '',
 snapshot_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(owner_id,opportunity_id)
);
CREATE INDEX IF NOT EXISTS linkedin_network_targets_owner_updated ON linkedin_network_targets(owner_id,updated_at DESC);
