-- Public-source opportunities only. Private doctor profiles and contacts stay elsewhere.
CREATE TABLE IF NOT EXISTS opportunity_organizations (
 id TEXT PRIMARY KEY,
 normalized_name TEXT NOT NULL,
 domain TEXT NOT NULL,
 country TEXT NOT NULL CHECK(country IN ('AU','IT')),
 state TEXT NOT NULL,
 data TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(normalized_name,domain,country,state)
);
CREATE TABLE IF NOT EXISTS opportunity_editions (
 id TEXT PRIMARY KEY,
 source_id TEXT NOT NULL,
 external_id TEXT NOT NULL,
 organization_id TEXT NOT NULL REFERENCES opportunity_organizations(id),
 edition_key TEXT NOT NULL,
 profile_scope TEXT NOT NULL CHECK(profile_scope IN ('both','amir')),
 trust TEXT NOT NULL CHECK(trust IN ('official','unofficial')),
 opportunity_type TEXT NOT NULL CHECK(opportunity_type IN ('job','university','grant','funding','scholarship')),
 country TEXT NOT NULL CHECK(country IN ('AU','IT')),
 state TEXT NOT NULL,
 title TEXT NOT NULL,
 url TEXT NOT NULL,
 published_at TEXT,
 closing_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('open','future','closed','unknown','source_removed')),
 data TEXT NOT NULL,
 first_seen_at TEXT NOT NULL,
 last_seen_at TEXT NOT NULL,
 UNIQUE(source_id,external_id,edition_key)
);
CREATE INDEX IF NOT EXISTS opportunity_editions_scope_filters ON opportunity_editions(profile_scope,country,trust,opportunity_type,state,closing_at);
CREATE INDEX IF NOT EXISTS opportunity_editions_org_history ON opportunity_editions(organization_id,published_at DESC,first_seen_at DESC);
CREATE INDEX IF NOT EXISTS opportunity_editions_source_external ON opportunity_editions(source_id,external_id);
