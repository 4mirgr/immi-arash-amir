# Opportunity editions, organizations and filters

This module stores public-source listings, not private Google mail, clinical records or personal CV data. It does not discover sites, scrape profiles, submit applications or send messages.

## Coordinator integration

1. Apply `cloud/opportunity-v2-schema.sql` to the dedicated `OPPORTUNITY_DB` database.
2. Call `upsertOpportunityBatch(db, registeredSource, normalizedRecords, now)` from a server-controlled collector. Source configurations are trusted code/registry inputs; no public endpoint accepts a source or fetch URL.
3. Call `ingestLegacyTasmania(db)` once (repeatable) to bring existing `job_opportunities` rows into the edition store. This reads the legacy table's separate `status` column so a source-removed listing is not promoted back to open.
4. After authenticated app membership validation, route `handleOpportunityV2Request` before the legacy opportunity handler. It handles listing and organization paths only. Collector `/sources` and `/refresh` remain separate.

No cloud mutation or scheduler installation is performed by this module itself.

## Source and record contract

`source` requires `id`, `country` (`AU` or `IT`), `trust` (`official` or `unofficial`) and `allowedHosts` (exact HTTPS record-host allowlist). Optional fields: `name`, `state`, `profileScope` (`both` or `amir`), `opportunityType`, `feedUrl`, `portalUrl`, `organizationName`.

A record requires `externalId` (or `id`), `title` and an HTTPS `url` on the source allowlist. Optional ISO `publishedAt`/`closingAt`, `organization` string or `{name}`, `organizationDomain`/`organizationWebsite`, `state`, `opportunityType`, `kind` (`vacancy` or `employment_register`), `summary`, `fullText`/`description`, `location`, `city`. Explicit malformed dates reject the batch; absent dates stay unknown. An absent deadline is shown as `unknown`, not a verified open vacancy.

Types: `job`, `university`, `grant`, `funding`, `scholarship`. Australia has the eight state/territory codes plus `UNKNOWN`; Italian region labels normalize to `IT-<region>` (or `UNKNOWN`).

Source classification supplies trust and profile scope; external record claims cannot promote an unofficial source to official or open Italy to the other doctor. Sponsorship, supervision, Monash and individual eligibility remain unknown until a separate verified enrichment process establishes them.

## Recurrence and organization grouping

Organization IDs derive from normalized organization name, domain, country and state. If a source does not identify an organization domain, the publisher domain is a labelled fallback; it is not proof that the publisher is a particular clinic. Cross-source aliases or later clinic-master merging require a separate provenance-preserving process.

An edition key includes normalized title, publication timestamp, closing timestamp, opportunity type and register/vacancy kind. The stable source/external ID plus that key determines the edition ID:

- Repeated identical polling creates no extra edition.
- Summary/overview correction updates the existing edition while preserving first-seen time.
- A changed recruitment title, publication date or deadline creates a separate edition under the same known organization, and older editions remain available.

An edition is a publication/version record, **not proof of an extra headcount or another secured offer**. Deadline extensions can create a new edition without representing a distinct available position. Outreach deduplication must remain independent of edition count.

## Cost and bounds

At most 500 records and 3MB of normalized edition JSON are accepted per import. Validate all records before mutations. D1 uses one targeted existing-ID read, one bulk `json_each` organization upsert and bulk edition upserts in JSON chunks below 400KB; it does not issue one SQL query per record. The write batch is atomic. Source collection still needs its own network, CPU and invocation budgets.

Returned counts: `{sourceId, seen, accepted, inserted, updated, organizationCount}`. Insert/update counts reflect the preflight snapshot; source collectors should serialize imports using their own source lock.

## Authenticated read API

`GET /api/opportunities` query fields:

- `q`, `country=all|AU|IT`, `state=all|AU-code|IT-region`
- `trust=all|official|unofficial`
- `types=job,university,grant,funding,scholarship` (or one `type`)
- `kind=all|vacancy|employment_register`
- `organizationId`, `includeClosed=true|false`, `limit` (1–100), `offset` (0–10000)

Response: `{opportunities, total, limit, offset, sourceCoverage:'configured_sources_only', scope:{country,trust,types,italyAllowed}}`. Each row includes source/organization/edition IDs, source type/trust, dates, unknown eligibility fields, first/last-seen timestamps and a small title-match signal score. The score is not a probability of acceptance.

`GET /api/opportunities/organizations` lists visible organization groups with edition counts. `GET /api/opportunities/organizations/:id` returns a paginated history including closed editions.

All HTTP paths are read-only and require a verified owner context from the outer Worker. `profile=other` is rejected. Italy is forced to `amir` at storage and query layers: Arash's default lists/groups exclude Italy, and explicit Italy filters or direct Italian history requests return 403. Listing an organization never grants access to another doctor's private data.

## Verification

`node --test tests/cloud_opportunity_store.mjs` covers repeat publication, polling idempotence, old-edition preservation, official/unofficial/category filters, unknown deadlines, safe source URLs, role forgery, Italy listing/history isolation, legacy import and bulk query budgets. Synthetic records only; tests do not assert current live coverage.
