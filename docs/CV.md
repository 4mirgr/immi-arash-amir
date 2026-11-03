# Private CV snapshots

`server/cv.py` stores immutable named versions in the private SQLite database. A version snapshots the existing profile's imported `cvText`; the API cannot inject new achievements or arbitrary CV content. Source filename, SHA-256 hash, timestamp and original verification label travel with the snapshot. Saving a version does not verify credentials. Default selection is separate for each profile and never crosses owners.

Module contract (coordinator wires HTTP routes):

- `init_schema(db)` creates tables; call during server initialization.
- `list_versions(db, profile)` returns newest-first metadata objects: `id`, `profileId`, `version`, `name`, `sourceHash`, `sourceFilename`, `verification`, `createdAt`, `isDefault`.
- `create_version(db, profile, {name, expectedSourceHash?})` creates a named snapshot and returns metadata. No client CV text accepted. Empty source is rejected. Optional hash prevents saving a stale source.
- `get_version(db, profile, id)` returns owner-validated metadata without the CV text.
- `set_default(db, profile, id)` verifies ownership, changes that profile's default, returns metadata.
- `export_version(db, profile, id, format)` returns `(content_bytes, mime_type, safe_filename)` for `txt` or minimal `docx`. XML is escaped and exports contain the selected snapshot only. Unsupported formats are rejected; PDF is not implemented.

All public helpers validate profile IDs; missing and foreign version IDs produce the same `ValueError`. Local profile IDs alone are not authentication: HTTP callers must use the authenticated owner's profile once production identity is implemented. Versions contain private data and must never enter git. No automatic achievements, certificate validation, background CV updates or external storage are claimed.

Checks: `python -m unittest discover -s tests -p 'test_cv.py' -v`.
