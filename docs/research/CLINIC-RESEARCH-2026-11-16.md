# Arash's clinic evidence and reading capacity

Implementation review: 2026-11-16. This describes the code and synthetic checks, not a completed reading of every imported clinic or a verified production deployment. Private clinic imports and actual contact records remain outside Git.

## Why context was thin

The previous bank reader retained at most twelve positive service sentences from the first 12,000 visible characters of a clinic's root page. It usually skipped every related page once it found a homepage email. A direct address therefore made the clinic easier to contact but could leave its services, teaching and team almost absent from letter preparation. Navigation extraction also omitted ordinary Services/Training/Careers links.

The reader now retains a bounded evidence dossier from the already fetched root page and up to two explicitly linked pages on the same clinic host. When an email is missing, Contact has first priority. Once an email exists, Services, Team, Training and Recruitment have priority. A contact page can still establish a publicly named manager or recruitment role. Link labels select pages; they are never proof of the services, an available position or a supervisor. No second-depth crawl or authenticated/social-profile harvesting occurs.

Each site still has one shared six-request budget for robots checks, redirects and page retrieval. The robots policy is reused within that site observation. Redirects, denials or a slow/blocked publisher can prevent some linked pages being read. At most three pages and 24 short statements are retained, with eight text statements per page so that a long homepage cannot crowd out linked services/team evidence. The original full-page text is not saved.

## Snapshot contract

`clinic_bank_leads.result_json.research` is private to the bank owner:

```text
version: 2
observedAt: same observation time as contactsReadAt
sourcePages: [{url, sourceURL, status, readAt, kind}]
facts: [{category, text, sourceURL, readAt}]
people: [{name, role, quote, sourceURL, readAt, method}]
organizations: [{name, quote, sourceURL, readAt, method}]
gaps: [explicit missing/unassessed category codes]
scope: bounded_public_publisher_statements_not_full_clinic_due_diligence
```

Fact categories are services, team, training, recruitment, population and history. Every statement is an exact bounded quote from a successfully read public page after visible whitespace normalization. A person's role must be explicitly published and extracted as a labelled practice manager or recruitment contact; names are not derived from an email or a neighbouring staff card. Published aggregate patient/population counts and practice history remain contextual statements. They are never evidence of Arash's familiarity with that clinic, clinical outcomes or actual workload.

Patient narratives, testimonials, individual diagnoses and instruction-like source text are excluded. Missing categories mean no supporting statement was retained from these bounded readings, not that the clinic lacks that service. Crisis history and weaknesses remain explicitly unassessed; the system does not manufacture negative conclusions or patient statistics. The existing `clinicalText`/`clinicalSourceURL` fields remain root-only for older consumers; linked facts keep their own source URL.

The application composer may use only current service/team/training/recruitment evidence that matches the same owner and observation as its clinic contact evidence. It must match those facts to an exact passage from the owner's current selected CV. History/population alone cannot justify claimed treatment experience or a patient-burden narrative. A research dossier, email address or teaching statement does not turn a lead into a live vacancy or prove RACGP/ACRRM supervision, sponsorship, eligibility or permission to send.

A failed root refresh preserves the previous successful dossier and its original timestamps. The row's failed/stale status blocks treating it as current evidence. A successful new observation replaces the old dossier, including when no suitable facts were found; old assertions are not silently carried into a newly read page.

## Old and new records

New pending and normally due records always receive the first of the two per-run slots. Every third five-minute tick, the second slot may upgrade one previously successful snapshot lacking research version 2 even if its ordinary weekly refresh is not yet due. Otherwise it serves the ordinary due queue. Successful version-2 observations no longer qualify for this upgrade; failed upgrades retain normal backoff. This uses the existing atomic claim and completion queries, with no new schema, loop over the whole bank or extra per-item query. The version predicate can scan legacy rows, so D1 rows-read use still needs monitoring as the bank grows.

The reserved upgrade slot cannot starve never-read sites. While both legacy and due backlogs exist, at least five of every six available slots remain ordinary due work. The upgrade is gradual, not an immediate reread of the full bank.

## What the speed limit actually means

The two selected sites are claimed atomically in order, then different clinic hosts can wait for network responses concurrently. This removes the second site's unnecessary wait for the first site's entire crawl. Entries on the same host (including its `www` spelling) remain serial, and related pages within each site remain serial under that site's shared six-request counter and robots policy. The result receipts retain claim order even if the second site finishes first. A fresh active membership check is single-flight per distinct owner within that invocation only; no decision is reused across invocations, and completed inactive/unavailable results are not retained. If the second database claim fails, an already leased first site still finishes. This changes latency, not the number of sites allowed per cycle or the daily ceiling.

The existing background cycle runs every five minutes and attempts at most two bank site observations per cycle. The theoretical ceiling is 576 site observations/day. While legacy upgrade slots are filled, approximately 480 ordinary due observations and up to 96 early legacy upgrades/day can fit, assuming every scheduled invocation runs and no other stage reserves or exhausts its budget. A LinkedIn publication lane, inactive/unavailable membership checks, provider errors, robots restrictions, retries and invocation limits reduce actual throughput. A processed attempt is not necessarily a successful site or email discovery.

This means a first pass over 4,577 never-read candidates would take about 8.0 days at the theoretical two-slot ceiling, or 9.5 days while the reserved legacy slots are all occupied. These are capacity examples, not a live backlog count or completion forecast. Rechecking more than 4,032 sites every seven days cannot fit even the theoretical ceiling; the seven-day value is a due interval, not a promise that every website is refreshed weekly. Better evidence per existing read fixes discarded context without pretending to provide unlimited free crawling.

No new AI/search subscription, paid resource, cron or automatic email transport was introduced by this change. Existing source discovery, approved mail and owner-specific integrations remain separate. Reviewing a newly read clinic may prepare an enquiry; the owner still sees and approves the frozen recipients, sender, selected CV and proposed text through the existing send workflow.

## Verification

Synthetic tests cover homepage-email-plus-service/team reading, six-request/three-page limits, robots denial, same-host and public URL rules, current source/time attribution, public role extraction, patient/instruction exclusions, explicit unknowns, legacy fairness/no hot loop/backoff and preservation of stale receipts. Controlled-promise tests prove simultaneous independent-host progress without timing thresholds, same-host serialization and deterministic receipts. A real reader/membership fixture measures at most twelve public HTTP requests, two distinct-owner checks and four normal-path D1 statements per two-site run (18 physical requests total, or 17 with a shared active owner). The focused clinic-bank/public-contact test set passes; production counters, provider consent and a real send are separate checks.
