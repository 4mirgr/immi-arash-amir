-- Minimal durable owner-private stop receipts. Raw mail cache maintenance must
-- not erase a recorded refusal, failed delivery or request to stop contacting.
-- These receipts block suggested/unattended follow-up only; they do not grant
-- or revoke permission for a separately reviewed manual reply.
CREATE TABLE IF NOT EXISTS clinic_correspondence_stops (
 owner_id TEXT NOT NULL,
 google_sub TEXT NOT NULL,
 recipient TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN ('do_not_contact','bounced','rejected')),
 gmail_id TEXT NOT NULL,
 thread_id TEXT NOT NULL,
 recorded_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,google_sub,recipient)
);
