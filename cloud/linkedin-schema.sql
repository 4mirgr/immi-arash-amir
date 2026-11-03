-- Private LinkedIn planning only. No provider credentials, scraped graphs or fake analytics.
CREATE TABLE IF NOT EXISTS linkedin_sections (
 owner_id TEXT NOT NULL, section TEXT NOT NULL,
 current_text TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,section)
);
CREATE TABLE IF NOT EXISTS linkedin_drafts (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL,
 name TEXT NOT NULL, text TEXT NOT NULL, revision INTEGER NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(owner_id,kind,name,revision)
);
CREATE INDEX IF NOT EXISTS linkedin_drafts_owner_time ON linkedin_drafts(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS linkedin_posts (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
 text TEXT NOT NULL, scheduled_for TEXT, timezone TEXT,
 status TEXT NOT NULL CHECK(status IN ('draft','scheduled_for_manual_publication','published_by_user')),
 created_at TEXT NOT NULL, published_url TEXT, reported_published_at TEXT
);
CREATE INDEX IF NOT EXISTS linkedin_posts_owner_schedule ON linkedin_posts(owner_id,scheduled_for);
CREATE TABLE IF NOT EXISTS linkedin_metrics (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, as_of TEXT NOT NULL,
 data TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS linkedin_metrics_owner_date ON linkedin_metrics(owner_id,as_of DESC);
CREATE TABLE IF NOT EXISTS linkedin_contacts (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, data TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS linkedin_contacts_owner_time ON linkedin_contacts(owner_id,created_at DESC);

CREATE INDEX IF NOT EXISTS linkedin_contacts_owner_profile ON linkedin_contacts(owner_id,rtrim(json_extract(data,'$.profileUrl'),'/'));
