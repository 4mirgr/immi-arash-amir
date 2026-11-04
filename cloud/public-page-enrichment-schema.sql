-- Public facts extracted from an actually fetched page; never private mailbox data.
CREATE TABLE IF NOT EXISTS public_page_enrichment (
 page_id TEXT PRIMARY KEY REFERENCES public_page_queue(id),
 read_at TEXT NOT NULL,
 country TEXT NOT NULL CHECK(country IN ('AU','IT')),
 data TEXT NOT NULL CHECK(json_valid(data))
);
