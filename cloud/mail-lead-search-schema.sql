-- Owner-private search receipts. A reserved or failed request still consumes
-- the daily allowance; results remain unverified URL hints until public read.
CREATE TABLE IF NOT EXISTS private_mail_lead_searches (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 query_hash TEXT NOT NULL,
 requested_at INTEGER NOT NULL,
 completed_at INTEGER,
 status TEXT NOT NULL DEFAULT 'reserved',
 result_json TEXT NOT NULL DEFAULT '[]',
 error_code TEXT
);
CREATE INDEX IF NOT EXISTS private_mail_search_due ON private_mail_lead_searches(requested_at);
CREATE INDEX IF NOT EXISTS private_mail_search_cache ON private_mail_lead_searches(owner_id,query_hash,requested_at DESC);
