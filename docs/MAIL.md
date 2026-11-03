# Private mail preparation

`server/mail.py` is a transport-free local foundation. It never sends messages, creates OAuth tokens or reports a message as sent. Queued messages have `blocked_integration` status until a real authenticated Gmail sender is implemented separately. A queue item is not an email delivery.

Call `init_schema(db)` during startup. All functions require an explicit validated profile (`arash` or `amir`):

- `list_presets(db, profile)` → preset revisions with `isDefault`.
- `save_preset(db, profile, {name, subject, body})` → immutable revision (`id`, `revision`). A repeated name creates a new revision; existing queued content stays unchanged.
- `set_default_preset(db, profile, id)` → marks the profile's own revision as default.
- `preview_queue(db, profile, payload, daily_limit=20)` → read-only selected recipient preview, exclusions, quota, and `sendingEnabled: false`.
- `enqueue(db, profile, payload, daily_limit=20)` → `{items, excluded, sendingEnabled: false}`. Saves under a write lock; repeated mailbox+subject+body+CV-version combinations reuse the existing item.
- `list_queue(db, profile)` → private preparation history.
- `suppress(db, profile, email, reason)` → excludes that mailbox from future batches and marks existing queue entries suppressed.

Payload: `clinicIds` is an explicit array of 1–200 existing clinic IDs, plus either `presetId` or `subject` and `body`. Optional `cvVersionId` must belong to this profile; the CV module validates it. No automatic selection of all contacts or default template occurs. Multiple clinic rows sharing an email become one recipient with all selected source IDs. Missing/invalid email and suppressed recipients are reported as exclusions; unknown clinic IDs reject the batch. Subjects reject newlines.

The preparation quota defaults to 20 new records per profile per UTC day and counts blocked records too. It is deliberately separate from Google's eventual sending quota. Idempotent retries do not consume it twice. Future delivery must recheck suppression and authorization at send time, enforce actual sending quotas, attach the exact CV version and implement provider idempotency/reconciliation, bounded retry and an audit trail. This module has no dispatch function, retry worker or external side effects.
