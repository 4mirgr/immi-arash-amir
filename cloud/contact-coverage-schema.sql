-- Keep universal contact-coverage checks and edition joins indexed. Public data
-- only; this changes no opportunity, reading receipt or owner information.
CREATE INDEX IF NOT EXISTS opportunity_editions_contact_url_country
 ON opportunity_editions(url,country);
