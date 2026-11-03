# Owner-scoped mail preparation

The preparation module turns explicitly selected public opportunity editions into reviewable private draft jobs. It does not dispatch Gmail messages or send the clinic import bank. A separate scheduler can dispatch an already-reviewed queued job only after a new explicit per-job timed authorization. An automatic preference alone never activates a prior draft or queue entry. See the scheduled-dispatch section below.

## Preparation rules

- Authenticate through the main Worker membership gate; pass the real root user ID and owner-scoped REST closure. A caller cannot choose another owner or mailbox encryption identity.
- Select one to three existing public opportunity IDs. Arash cannot select Italy/Amir-only records. Closed, removed, future and unofficial listings are blocked.
- Read only the owner's explicitly selected default preset and immutable default CV version. Missing defaults produce recorded blockers. An unreviewed CV draft is never selected automatically.
- Find a unique email in that publication's bounded public content. Missing or ambiguous contacts are blockers. This is evidence that an address appears in a public advertisement, not verification of the recipient's identity or authority. Unresolved template placeholders and invalid subject/body are blocked.
- Freeze subject, body, preset/CV IDs, source URL and recipient in an owner-private job. New defaults do not change old jobs.
- Deduplicate by root owner + recipient and root owner + opportunity, across both Amir mailbox slots. This deliberately blocks repeated automatic contact for another edition; an intentional follow-up must be reviewed outside this initial pilot.
- Reserve at most three new jobs per root owner per UTC day with a conditional atomic insert. Blocked attempts do not consume a draft slot; they retain audit events. Repeated requests reuse the existing job.

## Explicit queue preparation

`POST /jobs/:id/queue {confirmReviewed:true}` is an explicit human review action. It rechecks publication status and owner/root suppressions, resolves the public email to an exact existing clinic email, then calls the existing Google queue-preparation handler with the frozen content/CV. Sender scope comes from the job's stored authorized mailbox. A secondary failure never falls back to the primary sender.

This operation prepares a queue record only. It never calls Gmail `/messages/send`. The actual queue and transport status remain visible in the selected mailbox's mail center. A terminal or ambiguous preparation error is not automatically retried. An existing queued/sent record is not sent again by this endpoint.

## Root suppression integration

`mail_automation_suppressions(owner_id,email,reason,created_at)` stores root-owner exclusions for both mailboxes. The module checks this plus both original per-mailbox Google suppression tables. Its exported `rootSuppressed` helper is also available; the existing Google send module should check the same root table during preparation and atomic dispatch claim so manual queues respect the root exclusion as well. Existing per-mailbox suppressions still apply.

An exclusion recorded here suppresses future draft/queue preparation and marks its draft jobs suppressed. It is not provider-level unsubscribe confirmation. The application does not send unsubscribe, verification or other external messages as part of this feature.

## API

Wire `handleMailAutomationRequest(request,env,{userId,profileId,rest},fetcher)` before generic body parsing; routes return null when unrelated. Apply `cloud/mail-automation-schema.sql` to private `GOOGLE_DB`. Public selected source records come from `OPPORTUNITY_DB`.

- `GET /api/mail-automation?profile=...`: settings, effective mode, selected-default presence, separate sender states, bounded public choices, own jobs/events/suppressions and readiness limitations.
- `POST /settings {mode?,mailbox?,dailyLimit?}`: valid modes `draft_only`, `approval_required`, `automatic`; daily limit 1–3, secondary Amir only.
- `POST /run {opportunityIds:[...]}`: bounded private preparation; returns results, blockers and reuse evidence.
- `POST /suppress {email,reason?}`: record an owner exclusion.
- `POST /jobs/:id/queue {confirmReviewed:true}`: prepare the stored mailbox queue after review, no dispatch.

`src/mail-automation.jsx` exports `MailAutomation({person,notify})`. The UI labels requested automatic mode, effective review requirements, evidence gaps, bounded quota and lack of background sending. All response content is inert text. Source links accept HTTPS only. Private actions and stale responses are guarded by owner identity/generation.

## Validation

Seven synthetic SQLite regressions exercise frozen defaults, missing/ambiguous source data, cross-mailbox root dedup/suppression, concurrent quota claims, foreign-owner/Italy/origin denial, and explicit queue preparation using the secondary sender. No test performs a real email send. Tests: `node --test tests/cloud_mail_automation.mjs`.

## Optional explicitly approved scheduled dispatch

`cloud/mail-automation-scheduler.mjs` adds a separate, default-disabled operation. Apply `cloud/mail-automation-scheduler-schema.sql` to private GOOGLE_DB. Wire `handleMailSchedulerRequest` **before** the general mail-automation router because the paths share a prefix. The scheduled worker may call `dispatchScheduledMail(env,fetcher)` only when `MAIL_SCHEDULER_ENABLED=true`. A mode preference, prepared draft or queued Gmail record does not create authorization to send.

The owner must first review and queue a specific job, store requested mode `automatic`, select an actual future instant using the dual calendar, then separately confirm that **this exact email will really be sent**. `POST /api/mail-automation/scheduler/approve {jobId,sendAfter,confirmSend:true}` creates a durable, owner-private authorization. It snapshots the queue digest, raw MIME content hash, selected immutable CV ID, sender, Google subject, mailbox and root owner. A matching existing active approval is idempotent; a different time requires cancelling the old authorization first. The UI offers the exact immutable CV version for review.

Schedule at most 23.5 hours ahead. The authorization expires 30 minutes after the requested instant, within 24 hours of approval. A missed window does not become a late surprise send. `POST /cancel {approvalId}` cancels an owned authorization only before claim/transport starts. An in-flight send cannot be recalled by this control. `GET /api/mail-automation/scheduler` returns only the owner's active/history records and real enablement state.

At most one due job is processed per scheduled invocation and at most three attempts per root owner/UTC day, across both senders. The scheduler rechecks the official publication, its unique published recipient, deadline, suppression in both mailbox slots, root suppression, frozen body/attachment digest, selected CV ID, Google identity/email and the current requested mode. It rechecks again after the atomic attempt claim, then reuses the existing Gmail dispatcher. It never invents a sender or uses the other mailbox as fallback. Dispatch does not read Supabase REST or need an exposed service-role credential. No approvals means zero transport calls.

Known rejection, changed source/content/identity, expiry, cancellation and ambiguous transport are terminal for that approval. There is no automatic retry; ambiguous Gmail acceptance requires checking the same account's Sent mailbox. Queue suppression is checked atomically by the existing send handler as well. Existing manual drafts/queues have no scheduling approval and remain manual.

A future approved action is intentionally durable beyond the browser login session. Administrative membership removal/account deletion must cancel pending approvals and remove/revoke the provider grant as part of account teardown; there is no privileged membership lookup inside this scheduler. Owner cancellation or disconnection blocks pending work. This is not an autonomous discovery-to-bulk-send campaign.

Validation: seven scheduler regressions cover no implicit authorization, own sender, concurrent single claim, cancellation/expiry, content/CV/source/identity/suppression changes, quota and terminal unknown outcomes. All network transports are synthetic. No real email was sent during development.
