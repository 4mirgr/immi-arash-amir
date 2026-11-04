# Per-opportunity email and CV

Authenticated opportunity cards expose a direct application composer. Each owner selects their own saved preset revision, saved CV version and authorized Gmail mailbox. Defaults preselect those revisions; changing choices invalidates the previous review. CV attachments use the existing searchable DOCX generator.

`GET /api/opportunities/{opp_id}/mail` returns source-published recipient choices and source readiness. It never guesses addresses or adds a contact to the shared clinic bank. A valid, edition-bound reading may supply the published contact when the original feed lacks body text; stale, mismatched, future, successor-edition or foreign-profile readings cannot. When no address is published, the UI directs the user to the source's application method.

`POST .../mail/preview` accepts `{presetId,cvVersionId,mailbox,recipient}`. The server checks owner, source status/freshness, exact published recipient, owned preset/CV, sender identity, suppression, quota and attachment. It returns the fixed message and a reviewHash bound to owner, provider identity, selected content and source edition/reading receipt. `POST .../mail/queue` requires the same selections, `confirmReviewed:true` and the current reviewHash. It revalidates the snapshot and reuses the existing Google queue through a server-only ephemeral recipient adapter; no public clinic is fabricated. This step does not send.

Actual transport requires a separate explicit UI click, calling the existing `/api/google/mail/dispatch` for the pinned queue item. Reused queue entries are displayed but never borrowed as new send approval. Ambiguous outcomes are not retried automatically. Provider grants, data, defaults, queues and results stay owner/mailbox scoped. No development test sends a real message. No new schema or secret is required.

Frontend: `src/opportunity-mail.jsx`; backend: `cloud/opportunity-mail.mjs`; router order precedes the general opportunity API. Tests cover source/history/recipient isolation, preset/CV ownership, changed snapshots, sender reconnects, suppression, quotas and retry/dedup controls.

Settings contain a wide named-preset editor/library and saved CV defaults. Saving the same preset name creates an immutable revision through the existing RPC; selecting the default remains explicit. Website typography uses the same locally hosted Vazirmatn binaries/weights as intMed; see public/fonts/OFL.txt and SOURCE.txt. Font files are public licensed assets, never private attachments.
