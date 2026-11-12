-- Private preparation progress, never credential verification or an application.
CREATE TABLE IF NOT EXISTS research_funding_plans (
 owner_id TEXT PRIMARY KEY,
 profile_id TEXT NOT NULL CHECK(profile_id='amir'),
 preferred_degree TEXT NOT NULL DEFAULT 'either' CHECK(preferred_degree IN ('either','phd','research_masters')),
 tasks_json TEXT NOT NULL DEFAULT '[]',
 updated_at TEXT NOT NULL
);
