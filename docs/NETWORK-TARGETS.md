# Target organizations and private follow-up

This module builds bounded, automatic candidate suggestions from the existing **public opportunity cache**, not from a private LinkedIn connections graph. Refreshing a panel reads current stored public editions; it does not scrape private sessions or send anything. It remains useful while LinkedIn graph/analytics approvals are unavailable.

## Scope and evidence

- The trusted authenticated context supplies `userId` and `profileId`; query/body ownership cannot replace them.
- Public editions/organizations are read from `OPPORTUNITY_DB`. Only editions visible to that profile are considered. Italy and Amir-only source scope are blocked for Arash on list/filter/direct save.
- At most 300 recent, non-expired, non-future, non-removed public candidates are examined; at most 50 organizations are returned. One highest-text-signal edition represents each organization. The count of permitted historical editions is included, not a claim of additional headcount.
- Priority is a transparent rule from titles, opportunity type, optional text mentions and official-source status. It is not qualification assessment or acceptance probability. An unknown deadline stays unknown; an employment register is not a specific job offer.
- LinkedIn URLs are standard **search links** using the public organization's name. No supervisor, recruiter, profile identity, contact relationship or account authorization is invented or marked verified.
- Manual private targets may retain a historically closed source snapshot for follow-up. This does not reopen a vacancy or renew its checked date.

## Integration

Apply `cloud/network-targets-schema.sql` to private `GOOGLE_DB`. After verified membership and before the general LinkedIn workspace router, call:

```js
await handleNetworkTargetsRequest(request, env, {userId, profileId, rest});
```

No provider token or external API call is needed. An unknown route returns null.

- `GET /api/linkedin/targets?profile=amir`: `{profileId,generatedAt,source,liveLinkedInGraph:false,targets,savedTargets,coverage,limitations}`. Optional `country=all|AU|IT`, `type=all|job|university|grant|funding|scholarship`, `q` ≤200. An Arash Italy filter is 403.
- `POST /api/linkedin/targets/save` with `{opportunityId,goal?}` derives its snapshot from the permitted server record, never caller text/URL. Goals: `job|research|training|funding`. Repeating the same owner+edition keeps existing progress/notes/goal.
- `POST /api/linkedin/targets/:uuid` with `{status?,notes?}` changes only that owner's record. Statuses: `to_research|shortlisted|reviewed|contacted|follow_up|archived`; notes ≤2,000 characters. A foreign ID is 404. `contacted` is explicitly user-reported, not provider-verified.

Every response is no-store. Browser writes reject foreign Origin. No invitations, messages, email, application, CV update or course registration occurs. Before any future transport feature, reuse the verified sender/recipient/permission/idempotency controls rather than attaching transport to a status selector.

## Verification

`tests/cloud_network_targets.mjs` uses separate in-memory public/private SQLite databases and synthetic source records. Eight tests cover grouping/re-publication counts, lexical priority, Italy direct/list restrictions, owner-isolated follow-up, deduplication, source status/deadlines, strict payload/origin checks and bounded result size. No real correspondence or connection requests are sent by these checks.
