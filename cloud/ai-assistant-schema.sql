-- Owner-private AI drafts. Counts include failed attempts to bound inference cost.
CREATE TABLE IF NOT EXISTS ai_assistant_runs (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('amir','arash')),
 day TEXT NOT NULL,
 input_hash TEXT NOT NULL,
 task TEXT NOT NULL CHECK(task IN ('pathway','cv','email','pesci')),
 question TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
 answer TEXT,
 usage_json TEXT,
 created_at TEXT NOT NULL,
 UNIQUE(owner_id,day,input_hash)
);
CREATE INDEX IF NOT EXISTS ai_assistant_owner_history ON ai_assistant_runs(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ai_assistant_day_budget ON ai_assistant_runs(day,owner_id);
