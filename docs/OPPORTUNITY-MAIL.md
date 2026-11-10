# Per-opportunity email and CV

Authenticated opportunity cards expose a direct application composer. Each owner selects their own saved preset revision, saved CV version and authorized Gmail mailbox. Defaults preselect those revisions; changing choices invalidates the previous review. CV attachments use the existing searchable DOCX generator.

`GET /api/opportunities/{opp_id}/mail` returns source-published recipient choices and source readiness. It never guesses addresses or adds a contact to the shared clinic bank. A valid, edition-bound reading may supply the published contact when the original feed lacks body text; stale, mismatched, future, successor-edition or foreign-profile readings cannot. When no address is published, the UI directs the user to the source's application method.

`POST .../mail/preview` accepts `{presetId,cvVersionId,mailbox,recipient}`. The server checks owner, source status/freshness, exact published recipient, owned preset/CV, sender identity, suppression, quota and attachment. It returns the fixed message and a reviewHash bound to owner, provider identity, selected content and source edition/reading receipt. `POST .../mail/queue` requires the same selections, `confirmReviewed:true` and the current reviewHash. It revalidates the snapshot and reuses the existing Google queue through a server-only ephemeral recipient adapter; no public clinic is fabricated. This step does not send.

Actual transport requires a separate explicit UI click, calling the existing `/api/google/mail/dispatch` for the pinned queue item. Reused queue entries are displayed but never borrowed as new send approval. Ambiguous outcomes are not retried automatically. Provider grants, data, defaults, queues and results stay owner/mailbox scoped. No development test sends a real message. No new schema or secret is required.

Frontend: `src/opportunity-mail.jsx`; backend: `cloud/opportunity-mail.mjs`; router order precedes the general opportunity API. Tests cover source/history/recipient isolation, preset/CV ownership, changed snapshots, sender reconnects, suppression, quotas and retry/dedup controls.

Settings contain a wide named-preset editor/library and saved CV defaults. Saving the same preset name creates an immutable revision through the existing RPC; selecting the default remains explicit. Website typography uses the same locally hosted Vazirmatn binaries/weights as intMed; see public/fonts/OFL.txt and SOURCE.txt. Font files are public licensed assets, never private attachments.

## Arash inline application flow — 2026-11-10
Arash lands on opportunities. Each compact row expands its own letter, CV and A/B/C choices; only one row is open. Final preview, sender/recipient selection, send and scheduling stay in that row. Evidence and planning controls are closed disclosures. Amir retains the existing card layout. Owner/filter/row changes discard reviews and confirmations; returning from mail may restore only valid owned draft choices.

The GP GET package exposes `previewBody`/`previewParagraphs` as an explicitly unreviewed suggestion from the currently suggested exact public-source and owned-CV quotes. This never changes canonical readiness, saves a template or authorizes sending. Canonical generation and final mail review remain explicit.

`POST .../mail/schedule` accepts the same reviewed selections and hash as queue, plus `sendAfter` (ISO instant) and `confirmSend:true`. It freezes the exact source edition/evidence digest, message, CV attachment, Gmail identity and published recipient in the existing scheduler tables. Existing different jobs are rejected rather than overwritten. A failed approval must not leave a newly created queue item available for an unintended later send. GET adds `scheduling` with actual source/policy readiness and this opportunity's own approvals. No new schema or secret.

Scheduling uses the existing five-minute cron, up to one send per run and owner quotas; the chosen instant must be within 23.5 hours and authorization expires 30 minutes later. It may block/expire instead of sending if source, membership, sender, evidence or authorization changes. Official executable source IDs use the same static registries as collection; unofficial/unregistered/stale sources remain blocked. No automatic retry of uncertain transport.

The form uses the existing Tehran/Jalali and Australian/Gregorian calendar. If the account is draft-only, an explicit account-level scheduling enable action is offered, with an active-approval check first; opening the panel never changes policy. Every message still needs separate frozen-message approval. Manual dispatch cannot bypass active scheduling: the whole batch is checked before transport and the queue claim repeats the approval condition atomically. Cancellation is owner-bound and does not recall a message already being sent.

Reference namechee.vercel.app was reviewed for visual flow only; no contacts, sent statuses, letters or private data were imported. Browser verification uses synthetic fixtures and mocked transport, never real mail.
