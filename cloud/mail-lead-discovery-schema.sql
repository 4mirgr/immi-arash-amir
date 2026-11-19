-- Apply after clinic-bank-schema.sql. Exact owner/name and owner/URL lookups
-- use these indexes instead of repeatedly scanning a private imported bank.
CREATE INDEX IF NOT EXISTS clinic_bank_owner_name_nocase
 ON clinic_bank_leads(owner_id,profile_id,name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS clinic_bank_owner_url_nocase
 ON clinic_bank_leads(owner_id,profile_id,url COLLATE NOCASE);
