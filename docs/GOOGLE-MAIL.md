# Private Gmail synchronization and triage

`cloud/google-mail.mjs` uses the site's separately authorized Google account, never the chat connector. It is a Worker/D1 module; the coordinator wires its router and applies `cloud/google-mail-schema.sql` to the server-only `GOOGLE_DB` binding. No Gmail connection or live synchronization is claimed by adding this module.

Every mailbox query includes both authenticated application `userId` and verified Google `subject`. Changing Google accounts cannot expose the previous account's cached messages; disconnected/revoked accounts fail closed. Inputs cannot select another owner. OAuth tokens remain internal to `getGoogleAccess` and are never returned or logged. D1 holds the private message cache; no mail-derived contacts are automatically added to shared clinics.

## API

- `GET /api/google/mail/messages?priority=all|strong|medium|weak&q=...&limit=50&offset=0` returns `{messages,sync,analysis:'rule_based',sendingEnabled:false,limit,offset}`. Maximum page size is 100. Each message includes `id,threadId,from,subject,date,dateTimestamp,snippet,plainBody,hasPlainBody,labels,direction,priority,reasons,extractedEmails`. Sorting favors strong then medium then weak, newest first within each group. Render all values as ordinary text, never HTML.
- `POST /api/google/mail/sync {}` explicitly runs one bounded pass. It returns `{synced,deleted,pendingCount,moreHistory,coverage,resetUsed,sendingEnabled:false}`. Only 20 full messages are read per pass; repeat when pending work remains. This endpoint never sends email.
- `POST /api/google/mail/sync {reset:true}` deliberately resets to the latest 20 Inbox/Sent messages. It does not scan every historical message or delete the existing private cache. Use after an expired history cursor or if the historical change page exceeds the 2,000-ID safety limit.
- `POST /api/google/mail/extract-contact {id}` returns private extracted addresses from an owned cached message, `{messageId,emails,scope:'private_mailbox_only',shared:false}`. No public sharing or clinic mutation occurs.

The router accepts `(request,env,{userId,profileId},fetcher=fetch)` and returns `null` for unknown routes. Unit tests may provide a fifth internal access-provider dependency; callers must never expose that dependency to browser input. Authentication and valid workspace membership must be established by the main Worker before calling this router.

## Coverage and bounds

The first pass records a Gmail history checkpoint before fetching at most the 20 latest Inbox/Sent entries. Older mail is not imported; the returned coverage is `recent20_initial_then_incremental`. Later passes use Gmail history, retaining pending message IDs and page tokens so a 20-read limit does not silently discard the remainder of a change page. A history 404 clears the stale checkpoint and returns `history_expired_retry_sync`; the next explicit sync makes a bounded recent-mail reset. Deletions remove owned cached records. A per-owner-and-Google-subject lease prevents simultaneous sync; it expires after five minutes and is released by matching lock token.

Gmail JSON is bounded at 1.5 MB per response with a 12-second timeout. Stored text/plain body content is bounded at 32 KiB, MIME traversal at ten levels and thirty parts per node, snippet at 2,000 bytes, headers at 2,000 characters, extracted email addresses at 50. HTML-only messages have empty `plainBody`; HTML and attachments are not downloaded or rendered. Attachment retrieval needs a separate authorized feature. Errors contain stable sanitized codes, not Google response bodies, messages, tokens or secrets.

## Analysis limits

Priority is a transparent local keyword heuristic, not an AI model, an eligibility decision or acceptance probability. Explicit rejection/unavailable-position signals take precedence over interview/offer wording; outgoing mail is not classified as a positive employer response. Unknown responses are weak rather than fabricated matches. Ranking excludes recognized quoted reply/history blocks and signature delimiters while preserving the full stored body for reading and extraction. Snippets are not appended to a complete plain-text body for ranking, preventing an old quoted snippet from reintroducing discarded signals. Negated interview/offer/call invitations take precedence over positive keywords. Each result includes reasons and requires human review; sarcasm, unusual quote formats and complex negations can still mislead the rule-based classifier. No provider, fee or API quota is promised unlimited.

## Verification

`node --test tests/cloud_google_mail.mjs` uses synthetic MIME and an in-memory real SQLite-backed D1 adapter. It checks bounded plain-text extraction, rejection precedence, incremental history checkpoints, retained overflow, expired history, concurrency lease, owner and changed-Google-identity isolation, private extraction, filtering and sanitized failures. This is not proof of live Google consent or Gmail API enablement; those require the actual owner's connection and a live smoke test after setup.

## Safe reply context

`getOwnedMailReplyContext(env,userId,{messageId,threadId?,to?},fetcher)` validates a cached incoming message against the current Google subject and derives its single reply address from `Reply-To` or `From`. Caller-supplied thread or recipient mismatches are rejected. Returned fields are `{messageId,threadId,to,subject,rfcMessageId,googleSubject}`; Gmail's message ID and the optional RFC `Message-ID` are different fields. This helper prepares a private draft context, not delivery. Gmail read scope is required even for cached message access; no permission fallback occurs.
