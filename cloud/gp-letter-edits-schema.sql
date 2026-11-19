-- Private manual letter revisions and reusable evidence-gated writing preferences.
-- A saved example is never a vacancy, source claim, credential or send approval.
CREATE TABLE IF NOT EXISTS gp_letter_style_templates (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 profile_id TEXT NOT NULL CHECK(profile_id='arash'),
 name TEXT NOT NULL,
 revision INTEGER NOT NULL,
 variant TEXT NOT NULL CHECK(variant IN ('A','B','C')),
 style_json TEXT NOT NULL,
 example_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(owner_id,name,revision)
);
CREATE INDEX IF NOT EXISTS gp_letter_styles_owner_name ON gp_letter_style_templates(owner_id,name,revision DESC);
CREATE TABLE IF NOT EXISTS gp_letter_edits (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 profile_id TEXT NOT NULL CHECK(profile_id='arash'),
 opportunity_id TEXT NOT NULL,
 cv_version_id TEXT NOT NULL,
 base_hash TEXT NOT NULL,
 selection_json TEXT NOT NULL DEFAULT '{}',
 revision INTEGER NOT NULL,
 subject_index INTEGER NOT NULL CHECK(subject_index BETWEEN 0 AND 2),
 subject TEXT NOT NULL,
 clinic_paragraph TEXT NOT NULL,
 value_paragraph TEXT NOT NULL,
 template_id TEXT,
 previous_id TEXT,
 method TEXT NOT NULL CHECK(method IN ('owner_manual_edit','fresh_adaptive_template')),
 created_at TEXT NOT NULL,
 UNIQUE(owner_id,opportunity_id,revision)
);
CREATE INDEX IF NOT EXISTS gp_letter_edits_owner_source ON gp_letter_edits(owner_id,opportunity_id,created_at DESC);
