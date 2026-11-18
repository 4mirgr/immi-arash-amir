-- Existing installations only. New installations use google-send-schema.sql.
-- Holds the owned Sent anchor, never a transport approval or Google credential.
ALTER TABLE google_send_queue ADD COLUMN follow_up_context TEXT;
