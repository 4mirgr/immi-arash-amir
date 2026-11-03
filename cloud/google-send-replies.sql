-- Apply only to an existing google_send_queue created before reply support.
-- New databases already have this column in google-send-schema.sql.
ALTER TABLE google_send_queue ADD COLUMN reply_thread_id TEXT;
