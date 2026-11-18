-- Existing installations only; preserve every queue, receipt and credential.
ALTER TABLE google_send_queue ADD COLUMN mail_opportunity_context TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS google_send_private_root_source
ON google_send_queue(json_extract(mail_opportunity_context,'$.rootOwner'),json_extract(mail_opportunity_context,'$.applicationKey'),recipient)
WHERE mail_opportunity_context IS NOT NULL AND status IN ('queued','sending','sent','delivery_unknown');
