-- Private, owner-reported preparation progress. Never a registration decision,
-- verified CV achievement, send approval or shared clinic annotation.
CREATE TABLE IF NOT EXISTS gp_workflow_settings (
 owner_id TEXT PRIMARY KEY,
 profile_id TEXT NOT NULL CHECK(profile_id='arash'),
 goal_mode TEXT NOT NULL CHECK(goal_mode IN ('pesci_readiness','employment')),
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gp_opportunity_progress (
 owner_id TEXT NOT NULL,
 opportunity_id TEXT NOT NULL,
 profile_id TEXT NOT NULL CHECK(profile_id='arash'),
 stage TEXT NOT NULL CHECK(stage IN ('clinic_identified','contact_identified','supervision_confirmed','position_documents','application_ready')),
 note TEXT NOT NULL DEFAULT '',
 evidence_url TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,opportunity_id)
);
