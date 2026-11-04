-- Public reading corpus. A queued link is not a read page or an opportunity.
CREATE TABLE IF NOT EXISTS public_page_queue (
 id TEXT PRIMARY KEY,
 url TEXT NOT NULL UNIQUE,
 country TEXT NOT NULL CHECK(country IN ('IT','AU')),
 profile_scope TEXT NOT NULL CHECK(profile_scope IN ('amir','both')),
 data TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 available_at INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0,
 read_at TEXT,
 title TEXT NOT NULL DEFAULT '',
 content_hash TEXT,
 last_error TEXT
);
CREATE INDEX IF NOT EXISTS public_page_due ON public_page_queue(status,available_at,lease_until);
CREATE TABLE IF NOT EXISTS public_page_content (
 page_id TEXT PRIMARY KEY,
 read_at TEXT NOT NULL,
 status TEXT NOT NULL,
 title TEXT NOT NULL,
 content_type TEXT,
 text TEXT NOT NULL,
 content_hash TEXT,
 limitations TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS public_page_evidence (
 page_id TEXT NOT NULL,
 profile_id TEXT NOT NULL CHECK(profile_id IN ('amir','arash')),
 category TEXT NOT NULL,
 sections TEXT NOT NULL,
 analysis TEXT NOT NULL,
 read_at TEXT NOT NULL,
 PRIMARY KEY(page_id,profile_id)
);
CREATE INDEX IF NOT EXISTS public_page_evidence_profile ON public_page_evidence(profile_id,category,read_at);
