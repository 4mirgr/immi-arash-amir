# Local development API

Python 3 standard library, no paid service required. Run from repository root:

```sh
python scripts/import_documents.py /absolute/path/to/attachment-folder
python -m server.app
python -m unittest discover -s tests -v
```

The importer reads `.xlsx` and `.docx` directly using ZIP/XML and writes only to ignored `private/immi.sqlite3`. It never copies originals. Imports are repeatable; valid email addresses are normalized and deduplicated; contacts without an email use normalized name/address/city identity. Source file/sheet/row provenance is retained. Contact records are unverified imports, **not verified vacancies**. Shared mailboxes may represent several locations; inspect source provenance before outreach. Additional DOCX documents are preserved with file provenance in Arash's private profile; no achievements are inferred.

The API binds only `127.0.0.1:8787`. It is a local prototype with a profile selector, **not account authentication**. Do not publish it through a tunnel or reverse proxy. Implement real identity, sessions and row-level authorization before deployment. Gmail, Calendar, Drive, Telegram, AI and external crawlers are disconnected. Draft saving never sends email. `emailPolicy=auto_after_connection` stores the user's preferred future automation policy; it cannot activate a sender that does not exist.

Endpoints: `GET /api/health`, `/api/bootstrap`, `/api/clinics`, `/api/profiles`, `/api/stations`, `/api/drafts?profile=arash`, `/api/settings?profile=arash`; `POST /api/drafts` with `{profileId, clinicIds, subject, body}`; `PUT /api/settings?profile=arash` with `{emailPolicy,defaultTemplate,notifications}`. Profile IDs: `arash`, `amir`. No CV or contacts are bundled into the frontend build.

Additional local routes: `/api/public-config`, GET/POST `/api/cv/versions?profile=...`, POST `/api/cv/default`, GET `/api/cv/export?id=...&format=docx`, GET/POST `/api/presets`, POST `/api/presets/default`, GET/POST `/api/mail/queue`, POST `/api/mail/preview`, POST `/api/mail/suppress`, GET `/api/opportunities` and `/api/sources`. Supply `?profile=arash` or `amir` on every owner-scoped request. These local routes are development selectors, not authorization. Cloud has a distinct authenticated implementation; see docs/CLOUD.md.
