-- Public official program/project readings; exposed only through Amir's authenticated funding menu.
CREATE TABLE IF NOT EXISTS au_funding_pages (
 source_id TEXT PRIMARY KEY,
 url TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('program','open','closed','unknown')),
 read_at TEXT NOT NULL,
 data TEXT NOT NULL,
 content_text TEXT NOT NULL DEFAULT '',
 content_hash TEXT
);
