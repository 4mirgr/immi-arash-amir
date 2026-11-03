# Tasmania physician-listing pilot

This collector is a bounded public-source pilot, not comprehensive Australian coverage or a prediction of eligibility. Code alone does not mean a schedule has been deployed. The coordinator manages the D1 binding, scheduled trigger and live verification.

## Source and evidence

- Official portal: https://www.jobs.tas.gov.au/
- Portal's embedded recruitment platform: https://careers.pageuppeople.com/759/
- Structured source: https://careers.pageuppeople.com/759/cw/en/jobs.json
- Publisher detail URL: `https://careers.pageuppeople.com/759/cw/en/job/{numericId}`

Read-only retrieval checked 2026-11-03: JSON array of 182 listings, 2,405,675 bytes. Current normalization admitted 17 physician listings, including one employment register. Counts are observations at retrieval, not hardcoded production data. Listings, closing dates and source availability may change. Provider `ApplyUrl` is never fetched or used as an automatic action; the collector constructs the verified publisher URL from a numeric source ID.

The official portal links PageUp; PageUp robots retrieval in the feasibility investigation did not disallow `/759/cw/en/`. This is not a permanent terms guarantee. Recheck terms/access before expanding frequency or scope; no private content, login bypass or application submission is involved.

## Runtime and contracts

Separate server-only D1 binding: `OPPORTUNITY_DB`. Apply `cloud/job-opportunities-schema.sql` once. It contains public-source listing data and source-check state, no Google tokens, private mailbox content or CVs.

- `collectOpportunities(env,fetcher=fetch)` fetches only the fixed HTTPS JSON endpoint, with redirects rejected, a 20-second timeout, streaming 3MB bound and maximum 500 array records. Every run has one fetch attempt. HTTP429/failure backs off for 30 minutes; success/304 imposes a 15-minute minimum cooldown. A two-minute lock prevents simultaneous collectors. A scheduled trigger can call this function every three hours after the coordinator deploys it.
- `handleOpportunityRequest(request,env,{userId,profileId},fetcher=fetch)` assumes the coordinator has verified the authenticated membership; only `arash` and `amir` contexts are accepted. A foreign query profile is denied. It returns null for unrelated paths.
- `GET /api/opportunities?state=all|TAS&kind=all|vacancy|employment_register&q=...&includeClosed=false|true&limit=25&offset=0` returns `{opportunities,total,limit,offset,sourceCoverage:'tasmania_pilot_only'}`. Default results exclude future, expired and removed listings. `includeClosed=true` intentionally also exposes future and removed records with explicit status for review.
- `GET /api/opportunities/sources` returns `{sources:[{id,name,state,portalUrl,feedUrl,coverage,status,lastCheckAt,lastSuccessAt,nextCheckAt,lastErrorCode,medicalListings}]}`. It never claims the other seven jurisdictions have live collectors.
- `POST /api/opportunities/refresh {}` makes one bounded collection attempt after authenticated owner/origin checks. It accepts no arbitrary URL or source fields. Response status is `updated`, `not_modified`, `cooldown`, `busy` or `failed`; HTTP200 with status `failed` is a failed source check, not a successful import.

Each opportunity exposes source ID, publisher URL, source URL, title, organization, state/location where supplied, bounded plain-text summary/fullText, advertised publication/deadline, kind, status, first/last seen, `evidenceStatus:'official_source_listing_not_job_offer'`, and explicit null sponsorship/supervision/MMM. Qualification eligibility remains `not_assessed`.

## Conservative interpretation

A record needs both an exact `Medical` category and a physician-role title. Nursing, veterinary, allied-health and administrative examples are excluded even when category tags overlap. Microsoft `/Date(milliseconds)/` values are parsed as UTC; missing/malformed closing dates are not promoted to open listings. Employment registers/expressions of interest/talent pools are labeled `employment_register`; they do not establish a specific available position.

The `match.score` is a small 0–3 count of known title signals for the selected profile, with reasons. It is neither a percentage nor a probability of acceptance. `registrar` describes an employment title, not guaranteed accredited training/RPL; staff-specialist listings still require qualification/registration verification. Match does not evaluate immigration status, degree completion, Iranian board outcomes, supervision or sponsorship.

Imports use source+numeric-ID keys, preserve first-seen time and update last-seen/status atomically with a D1 batch. ETag304 avoids re-downloading unchanged JSON. Failed or unexplained zero-medical snapshots retain the last successful dataset and record a sanitized failure. Missing listings are marked `source_removed` only after a full successful import. Source failures may leave cached listings visible; readers must inspect last-success/check timestamps and the original advert before acting.

The collector never sends email, applies to jobs, modifies Google services or purchases resources.

## Verification

`node --test tests/cloud_job_opportunities.mjs` verifies dates, physician filtering, safe canonical links/plain text, repeat import/first-seen stability, ETag304, future/closed filtering, failure retention, removed records, context/origin validation, cooldown and locks with synthetic records. Read-only live normalization was separately checked against the official feed. No real cloud mutations were performed by this module's author.

Coordinator deployment note: a separate `immi-opportunities` D1 database is provisioned. An initial import was made from the independently retrieved official-feed snapshot (17 physician listings, one employment register); this is not evidence that a scheduled Worker invocation has already succeeded. Cloudflare cron is configured for every three hours; check source last-attempt/status after its first invocation. No email sender is invoked by this schedule.
