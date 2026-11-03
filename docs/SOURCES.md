# Job sources and ingestion

`library/sources.json` lists one public government recruitment starting point for each Australian state/territory. Checked 2026-11-03 via HTTPS: NSW, Queensland, Victoria, WA, SA, NT and ACT returned HTTP 200. Tasmania's government portal returned HTTP 403; its content was not retrieved. HTTP success verifies reachability only, not every vacancy, hospital or IMG eligibility. These broad portals require medical-role searches and some positions may appear on separate health-service sites.

There are **no verified RSS feed URLs configured yet**. Do not infer a feed from a portal URL. The registry explicitly stores `feedUrl: null`, so collection currently reports `feed_not_configured` and imports no fabricated vacancies. Imported clinic contacts remain in their separate table.

## One pass and scheduling

```sh
python scripts/collect_opportunities.py
python scripts/collect_opportunities.py --source nsw-health
```

A future operator may configure a verified publisher-provided RSS/Atom URL only after inspecting its terms and exact allowed HTTPS host. Run passes hourly or less often according to publisher guidance, using cron or an authenticated cloud scheduler; no persistent scheduler is installed by this change. UI ten-second refresh must read the internal database only. ETag is reused, 304 retains records, requests have a 15-second timeout and 2 MB response limit, and every attempted configured source stores its check state/error type. Do not make arbitrary user-entered URLs or hosts available to this collector.

Validation rejects non-HTTPS, credentials, unusual ports, unlisted hosts, non-public DNS answers and redirects leaving allowed hosts. XML DTD/entities are rejected; stored summaries contain plain text. The trusted version-controlled registry is the only source configuration. Listing links from feed items must use allowed hosts, but are not fetched. Feed entries use stable per-source IDs and upsert without duplication; a listing remains `source_listing_unverified`, with sponsorship, supervision, MMM and eligibility unknown. Absence from a subsequent feed does not prove closure; expiry/closure verification remains a separate task.

`rank_opportunity` reports role-keyword and preferred-state signals with explicit points. It is a text match score and cannot estimate acceptance probability or establish registration eligibility.

## Module contract

- `init_schema(db)` creates `opportunities` and `source_checks`.
- `list_sources(db)` returns registry items with `collectorStatus` and `lastCheck`.
- `list_opportunities(db, profile)` returns shared listings; validates `arash`/`amir` without pretending that the local profile selector is authentication.
- `collect_source(db, source)` performs one bounded collection attempt.
- `rank_opportunity(record, profile, preferred_states=())` returns transparent signal scores.

The source registry is public metadata. Runtime checks and collected listings stay in the private SQLite database. Hosted Worker integration, website-specific collectors, active vacancy verification and source monitoring alerts are still separate work.
