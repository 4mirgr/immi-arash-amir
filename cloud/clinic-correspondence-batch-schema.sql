CREATE INDEX IF NOT EXISTS google_mail_owner_thread
ON google_mail_messages(owner_id,google_sub,thread_id);
