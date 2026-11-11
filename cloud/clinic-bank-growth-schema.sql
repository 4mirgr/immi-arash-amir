-- Private discovery cursor. Only public ad metadata enters new unverified leads.
CREATE TABLE IF NOT EXISTS clinic_bank_growth_state (
 owner_id TEXT PRIMARY KEY,
 observed_at TEXT NOT NULL DEFAULT '',
 opportunity_id TEXT NOT NULL DEFAULT '',
 last_run_at TEXT,
 scanned_count INTEGER NOT NULL DEFAULT 0,
 added_count INTEGER NOT NULL DEFAULT 0
);
