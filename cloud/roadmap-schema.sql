-- Private action progress is isolated from public, source-reviewed evidence.
CREATE TABLE IF NOT EXISTS roadmap_actions (
 owner_id TEXT NOT NULL,
 action_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('todo','doing','done','blocked')),
 note TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,action_id)
);
