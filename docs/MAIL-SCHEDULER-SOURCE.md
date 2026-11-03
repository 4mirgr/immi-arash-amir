# Fresh source guard for scheduled mail

The scheduled-mail adapter accepts only an official listing from a configured executable source in `source-registry.json` or `RURAL_SOURCE_DEFINITIONS`. A locally inserted or merely link-only source cannot be promoted to scheduled transport.

Both approval and dispatch preflight require:

- A valid, nonfuture `last_seen_at` no older than **72 hours** on the exact opportunity edition.
- Valid source publication and deadline values when present; future publication, expired deadlines, malformed dates, closed/future/removed states and inaccessible profile scopes are rejected.
- An existing `registered_source_checks` receipt for the source with status `updated` or `not_modified`, and valid nonfuture `last_success_at` no older than 72 hours. A last failure blocks scheduling even if an older successful snapshot still exists.
- Exactly one published recipient that still matches the frozen reviewed queue. Private contacts, guesses or an email found in a different listing do not establish the recipient.

The same checks run when approving and twice in the scheduled dispatch workflow, before the existing Gmail transport. A failed check blocks the approval or marks an existing approval `blocked`; later runs do not retry it automatically. No network request is made by this source guard. It adds one public D1 query per `checkJob` invocation.

The 72-hour boundary is an operational freshness rule, not a verified application deadline or personal eligibility decision. Missing deadlines remain unknown. This deliberately favors no send over sending against an unverified old listing.

A collector `304 Not Modified` receipt alone does not advance an edition's `last_seen_at`. Under this conservative implementation, an edition older than the window needs a genuine fresh observation/review even if the publisher's ETag has not changed. Historical editions are never silently treated as current because another edition from the same publisher was checked.

Tests: `node --test tests/cloud_mail_scheduler.mjs` uses synthetic SQLite/provider fixtures and covers stale/future/malformed observations, missing/stale/failed/future collector receipts, unregistered sources, changed published recipient, post-approval invalidation and recent unknown-deadline listings. This is not evidence of a real email send.

Application membership is independently checked using `checkAutomationMembership` before the first dispatch preflight and again immediately before Google transport. A valid stored Google grant cannot authorize a removed application owner. False, unavailable, malformed or unconfigured membership checks block without Gmail transport. This adds at most two bounded Supabase RPC calls for a due job; approval requests already pass authenticated membership at the application router.
