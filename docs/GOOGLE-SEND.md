# Owned Gmail send queue

`cloud/google-send.mjs` exports `handleGoogleSendRequest(request, env, context, fetcher=fetch)`. The authenticated Worker supplies `{userId,profileId,rest}`; `rest` uses the current owner's verified Supabase JWT. `GOOGLE_DB` is server-only Cloudflare D1. Apply `cloud/google-send-schema.sql` alongside Google OAuth schema before using routes.

The coordinator must route these endpoints after authentication and membership validation:

- `GET /api/google/mail/queue` → `{items,automaticSending:false,dailyLimit:20}`; metadata only, no MIME or access tokens.
- `POST /api/google/mail/preview` → `{sender,recipients,excluded,dailyLimit,reservedToday,newCount,quotaTimezone:'UTC',sendingAutomatic:false}`. Read-only; connection and Gmail send consent are required.
- `POST /api/google/mail/queue` → `{items,excluded,dailyLimit:20,automaticSending:false}`. Payload `{clinicIds,subject,body,cvVersionId?}` or `{clinicIds,presetId,cvVersionId?}`. IDs are checked server-side and private preset/CV selection is owner-scoped. Each recipient gets an individual MIME message. `cvVersionId` is explicit: omission means no attachment, not an implied CV.
- `POST /api/google/mail/dispatch {ids:[1–5 queue IDs]}` sends only those explicitly selected prepared items. A prepared queue does not send on its own, on connection or on reconnect.
- `POST /api/google/mail/suppress {email}` adds a private suppression and marks that owner's currently queued matching items suppressed.

Arash and Amir have separate credentials, queues, quotas, suppressions and sender identities. Recipient email is resolved from selected clinic records, never trusted from browser `to`/`sender`/`owner` fields. MIME includes only the connected owner's verified email and an immutable snapshot of selected content and optional DOCX. The prepared Google subject **and email** are pinned; changing either blocks dispatch until an explicitly re-prepared message. The connection is revalidated before each item, so disconnecting mid-batch prevents later items using a cached token. This does not cancel a Gmail request already in flight.

Fingerprints are unique per owner and normalized recipient/content/CV hash/Google identity. Atomic conditional inserts reserve a maximum of 20 preparations per owner per UTC day, and dispatch separately caps attempts at 20 per day. Atomic `queued → sending` claims prevent concurrent double-dispatch. Suppression and quota checks occur again at claim time. Quotas are conservative preparation/attempt limits, not Gmail's provider quotas.

Only a Gmail acknowledgment containing a message ID produces `sent`. Explicit 4xx rejection is terminal `failed`. Timeout, 5xx, malformed acknowledgment or an ambiguous lost response is terminal `delivery_unknown`; no automatic retry is performed. If the process dies or result persistence fails, `sending` is also never automatically retried. Reconcile such records against that owner's Gmail Sent folder before any deliberate new send. A previously terminal fingerprint remains deduplicated. Provider error text, tokens and full MIME never appear in the API response.

This module has **no cron sender**, no automatic outreach to imported leads, and no claim that Google credentials are configured. Imported clinic contacts remain unverified leads. Gmail/Google account setup and consent are separate prerequisites. Tests use only synthetic accounts, SQLite and mocked fetch; no real email was sent during development.


## Replies in the original Gmail thread

Preview/queue also accept `{replyContext:{messageId,threadId?,to?},subject,body,cvVersionId?}`. Do not include `clinicIds` or `presetId` for replies. The server derives the single recipient from the authenticated owner’s current Google mailbox cache (Reply-To, otherwise From); optional browser `threadId`/`to` are consistency checks only and cannot redirect the response. Outgoing originals, another owner/account’s cached message, ambiguous recipient, missing/malformed original RFC Message-ID, or a changed subject are rejected. The subject must match the original after stripping repeated English `Re:` prefixes; this preserves Gmail’s documented thread criteria.

Prepared reply records expose `replyThreadId` in metadata and freeze verified `In-Reply-To`/`References` headers in MIME. Only a verified prepared reply supplies `threadId` to Gmail’s send JSON; ordinary clinic messages do not. Reply fingerprints additionally include the original message/thread/RFC identifiers, keeping ordinary clinic idempotency keys unchanged. Replaying enqueue/dispatch does not resend terminal items. As with other mail, adding a reply to the queue never sends it automatically.

New D1 databases use the final `google-send-schema.sql`. For a database created before reply support, apply `cloud/google-send-replies.sql` exactly once to add the nullable `reply_thread_id` column. Do not apply the ALTER to a fresh database whose CREATE already contains that column.
