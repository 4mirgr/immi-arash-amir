-- A small shared inference budget for public source text only; no CV/mail/account data.
CREATE TABLE IF NOT EXISTS public_discovery_ai_runs (
 id TEXT PRIMARY KEY,
 page_id TEXT NOT NULL,
 read_at TEXT NOT NULL,
 day TEXT NOT NULL,
 status TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(page_id,read_at)
);
CREATE INDEX IF NOT EXISTS public_discovery_ai_budget ON public_discovery_ai_runs(day);
