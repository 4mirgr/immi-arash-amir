# Explicit LinkedIn text publication scheduling

This feature schedules only the exact text of an existing owner's saved future post. Ordinary calendar/manual schedules are never automatically approved, and existing posts are not migrated or backfilled into approvals. Images are not uploaded or published by this feature. It does not edit profiles, send invitations or read the private connection graph.

## Owner flow

1. Save the post and a future date using the dual calendar.
2. Review the saved text, the connected LinkedIn identity and the displayed time.
3. Select that post's explicit consent checkbox and press its separate text-publication approval button.
4. The post remains unsent until due. The approval can be cancelled before dispatch starts. Once dispatch is claimed/in flight, cancellation is rejected rather than falsely claiming that a remote request was stopped.

LinkedIn must already be connected with the actual `w_member_social` grant, and its token must cover the scheduled date. A shared developer app does not merge identities. Changing text/time or renewing/relinking the grant requires cancelling the old approval and approving again; the old frozen approval will not silently follow the change.

## Runtime integration

- Apply `cloud/linkedin-scheduler-schema.sql` to private `GOOGLE_DB` before deployment.
- Wire `handleLinkedInSchedulerRequest(request,env,{userId,profileId})` after verified membership, before the general LinkedIn router.
- Set `LINKEDIN_SCHEDULER_ENABLED=true` only when the existing publisher is configured. Missing flag/config means no scheduled database access or transport.
- On a separate approximately five-minute cron, call `dispatchScheduledLinkedIn(env,fetcher)`. It claims at most one due post per invocation. Do not combine it with large source jobs in the same free-tier D1 query budget.
- The scheduler reuses the existing publisher's atomic owner/post idempotency and five-attempt daily limit. It pins author, text hash, exact schedule and grant fingerprint, then rechecks them immediately before transport.
- Requests use manual redirects and never forward credentials to another endpoint.
- Ambiguous acceptance, failed transport and crashed dispatch are terminal; there is no automatic retry or lease reclamation. Inspect the provider's own feed/receipt before any manual replacement.
- A schedule more than 24 hours late is marked missed, not published unexpectedly after an outage.

## Authenticated API

- `GET /api/linkedin/scheduler`: own approvals and runtime readiness.
- `POST /api/linkedin/scheduler/approve {postId}`: explicit approval of a saved own future text post; no immediate publication.
- `POST /api/linkedin/scheduler/cancel {postId}`: owner-only cancellation before transport claim (or acknowledgement of a blocked/missed pre-transport approval). Already dispatching/published/ambiguous outcomes cannot be cancelled as if unsent.

No raw authorization codes, grant tokens, secrets or provider error bodies appear in API output. Local statuses distinguish provider-confirmed publication from unknown delivery. Tests use synthetic accounts and mocked providers; no real post was published by development/verification.
