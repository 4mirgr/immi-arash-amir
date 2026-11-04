-- Public institutional directory and technical scan receipts; never job offers.
CREATE TABLE IF NOT EXISTS university_catalogue (
 id TEXT PRIMARY KEY,
 country TEXT NOT NULL CHECK(country='IT'),
 profile_scope TEXT NOT NULL CHECK(profile_scope='amir'),
 name TEXT NOT NULL,
 url TEXT NOT NULL,
 data TEXT NOT NULL,
 directory_checked_at TEXT NOT NULL,
 scan_status TEXT NOT NULL DEFAULT 'not_checked',
 scan_checked_at TEXT,
 scan_data TEXT
);
CREATE INDEX IF NOT EXISTS university_catalogue_name ON university_catalogue(country,name);
CREATE TABLE IF NOT EXISTS university_related_checks (
 id TEXT PRIMARY KEY,
 institution_id TEXT NOT NULL,
 url TEXT NOT NULL,
 status TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS university_related_institution ON university_related_checks(institution_id);
