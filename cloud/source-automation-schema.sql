-- One public operational receipt. Manual refreshes cannot create scheduled-run evidence.
CREATE TABLE IF NOT EXISTS source_scheduler_state (
 id TEXT PRIMARY KEY CHECK(id='public_collector'),
 started_at INTEGER NOT NULL,
 finished_at INTEGER,
 scheduled_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','completed','partial_failure','failed'))
);
