-- Owner-private website verification for imported clinic leads. Not vacancies.
CREATE TABLE IF NOT EXISTS clinic_bank_leads (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 profile_id TEXT NOT NULL CHECK(profile_id='arash'),
 url TEXT NOT NULL,
 name TEXT NOT NULL DEFAULT '',
 provenance_json TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 available_at INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0,
 read_at TEXT,
 last_success_at TEXT,
 result_json TEXT NOT NULL DEFAULT '{}',
 new_email_count INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(owner_id,url)
);
CREATE INDEX IF NOT EXISTS clinic_bank_due ON clinic_bank_leads(available_at,lease_until);
CREATE INDEX IF NOT EXISTS clinic_bank_owner ON clinic_bank_leads(owner_id,status,read_at);
