# Arash workflow review — 17 November 2026

This pass preserves the existing GP/PESCI workflow and separate owners. No provider message, schedule, inference or live database operation was performed by the frontend audit.

## Concrete findings and corrections

1. Bulk draft preparation waited serially for the advertisement contact view and GP package for every selected practice. It now prepares at most two practices concurrently, with two independent GETs per Arash practice: at most four client requests in flight in this preparation stage. Final canonical review, deduplication, queueing and sending remain sequential and unchanged. Completed drafts retain selection order, including when a later practice finishes first. This reduces network waiting, not server quotas or factual requirements.
2. Read-only preparation could not be stopped. It now has an explicit stop control that aborts outstanding browser reads, stops launching new ones and keeps completed drafts. Restarting creates a new operation; late old responses cannot restore cancelled results. There is no new cancellation/retry path for sending or scheduling.
3. Bulk setup and individual mail converted a failed Google status request to `connected:false`, then sent the user toward OAuth setup. A failed status lookup now has a distinct unknown state and an explicit metadata retry. It cannot authorize sending. The retry keeps the user's sender, CV and recipient choices and does not start OAuth.
4. An ordinary individual-mail reload reset the sender to primary, CV to default and every published recipient to selected. It now retains still-valid choices for the same scope and intersects recipients with the current published list. Review/send consent still resets. An owner or advertisement change does not reuse this form.
5. A bulk component could retain the preceding scope's state until replacement setup finished. Its owner/advertisement session now remounts immediately, with reads aborted on unmount. The browser test holds the new owner's setup and verifies the old owner's drafts disappear before it completes.
6. Required signature or source blockers could surface only after all bulk drafts had been reviewed. Blocking package fields now appear during draft preparation, while the normal unconfirmed-quote fields remain part of explicit per-draft review.
7. The academic editor now reads the selected CV candidate's server-classified `cvScope`. Training, research and limitation excerpts keep their ordinary source-bound draft visible, but cannot invoke clinical-experience AI editing. The backend remains authoritative and returns `academic_clinical_evidence_required` if evidence changes. Old responses lacking candidate scope remain compatible; top-level scope is reused only when exact current provenance matches the selected quote.

## Verification

- New controlled browser regression: `tests/browser/check_bulk_draft_preparation.py`. It verifies two-clinic/four-GET bounds before releasing any response, out-of-order progress, cancellation/restart, late response rejection, immediate owner reset, metadata retry without OAuth, preserved individual sender/CV/recipient choices, early missing-signature guidance, English labels, mobile width and zero transport writes. It also runs with `AbortSignal.any` unavailable, while per-request deadlines and abort-listener cleanup remain enforced.
- Extended `check_gp_academic_writing.py` covers nonclinical-scope exclusion in full and compact editors while retaining ordinary drafts.
- Existing full bulk transport/deduplication/review, setup guidance, sync continuity, send action docks and English census remain part of the verification. The English census covers both owners in 66 screens and seven additional views.
- `npm run build` passed before parent integration and deployment (existing translation-chunk size warning only). All tests use synthetic endpoints and data; no live email delivery or production UI login is claimed.

New human translations are in `src/locales/en-arash-workflow-audit.mjs` (`EN_ARASH_WORKFLOW_AUDIT`), merged into the root catalog by the coordinator.
