# Public recruitment collector feasibility

Checked 2026-11-03 by direct HTTPS. This is an implementation probe, not comprehensive job coverage or a determination of IMG eligibility. Public publisher data below was retrieved without account login or bypass. No application, contact message, subscription or external mutation was made.

## Tasmania: publisher-supported JSON and RSS

The official [Tasmanian government jobs homepage](https://www.jobs.tas.gov.au/) returned HTTP 200 on this check. Its public HTML embeds `PU.Widgets.jobListing` with base URL `https://careers.pageuppeople.com/759/`, channel `cw`, language `en`; its search links also point to the PageUp-hosted career site. This gives direct publisher provenance for the ATS endpoints rather than an inferred third-party scraper.

| Endpoint | Observed result | Contract |
|---|---|---|
| https://careers.pageuppeople.com/759/cw/en/jobs.json | HTTP 200; 2,405,675 bytes; JSON array of 182 records | Despite `Content-Type: text/javascript`, the no-callback body parses as ordinary JSON. Never evaluate it as JavaScript. |
| https://careers.pageuppeople.com/759/cw/en/latest_jobs.rss | HTTP 200; 2,064,414 bytes; XML RSS 2.0 with 182 items | `job` namespace is `http://pageuppeople.com/`; use extended closing date and reference number. |
| https://careers.pageuppeople.com/759/cw/en/listing/ | HTTP 200; public listing page | Attribution and manual review entrypoint. |

JSON fields actually inspected: `Id` (digit string), `ExternalJobNo`, `Title`, `Summary`, `Overview` (HTML), `Categories` (comma-separated text), `CategoryList` (string array), `Locations`, `LocationList`, `GeoLocationList`, `WorkType`, `WorkTypeList`, `Brand`, `Department`, `Salary`, `OpeningDateUtc`, `ClosingDateUtc`, `ClosingDateTimeZone`, `ApplyUrl`. Empty strings are common; `GeoLocationList` can contain only an empty string. There is no `JobUrl` field. The verified publisher URL pattern is `https://careers.pageuppeople.com/759/cw/en/job/{Id}`; require a numeric ID before constructing it. Do not treat `ApplyUrl` as the public detail URL or automatically visit/submit applications.

Dates are Microsoft JSON strings such as `/Date(1814363700000)/`, with the number representing UTC epoch milliseconds. Parse this grammar explicitly; generic JavaScript `Date.parse` will not parse it reliably. Keep the original value as provenance, store a normalized UTC timestamp, and fail to unknown rather than manufacturing a deadline. RSS uses RFC-style `pubDate` and `job:closingDate`; for example the inspected medical employment register advertises closure on 2027-06-30. The register is explicitly an expression-of-interest employment register, **not a guaranteed vacancy or offer**. The two other records with `Medical` in `CategoryList` were surgery/pathology registrar advertisements, demonstrating that a medical-category match does not make a record an internal-medicine or IMG match.

Filtering/pagination observations:

- The public JSON response contains the entire observed array; no server pagination envelope was present.
- A request to `latest_jobs.rss?search-keyword=medical` produced **identical bytes** to the unfiltered response. Do not claim this keyword filter works. Filter locally using `CategoryList.includes('Medical')` and then role/eligibility text. A title-only medical filter can accidentally include veterinary posts.
- The publisher's widget JavaScript (`https://careers.static.pageuppeople.com/Widgets/v3.js`) shows `jobs.json` use and client-side list paging. Do not turn UI page counts into a presumed server API parameter.
- Both JSON and RSS exceed this repository's original 2,000,000-byte generic feed limit. A dedicated bounded parser needs a justified limit such as 4 MB, streamed byte enforcement, a timeout and a record-count cap. Do not silently truncate and report success.
- HEAD checks returned `Cache-Control: private`, no ETag and no Last-Modified. Conditional fetch support must be checked at runtime, not assumed. Never cache an entire response publicly just because the endpoint is public. A low-frequency private ingestion pass is preferable to browser-driven repeated downloads.

Safety/terms:

- `https://careers.pageuppeople.com/robots.txt` returned HTTP 200. It disallows administrative, test, UAT and staging paths; it did not disallow `/759/cw/en/` in the retrieved snapshot. `https://www.jobs.tas.gov.au/robots.txt` also did not block its public landing page.
- Robots permission does not establish a blanket redistribution licence. Preserve source links and checked times, present small summaries, and review current publisher terms before expanding scheduled collection. Do not fetch applicant portals or candidate data.
- Allow fetch host `careers.pageuppeople.com` for these exact listing endpoints. Official attribution host is `www.jobs.tas.gov.au`. The observed application links use `secure.dc2.pageuppeople.com`; keep them as links only, outside the collector fetch allowlist.

## Western Australia: allowed category listing plus JobPosting JSON-LD

Verified public category listing:

`https://search.jobs.wa.gov.au/jobs/search/healthcare`

It returned HTTP 200 with ordinary HTML, approximately 578 KB, and explicit pagination links such as `/jobs/search/healthcare?page=2`. The observed page had 16 pages; that count is a snapshot, not a constant. Extract only canonical `/jobs/` detail links, deduplicate them, apply role-title filters, and persist a bounded page cursor. This list contains healthcare roles beyond doctors, so it requires medical-role screening.

Verified structured detail endpoint:

`https://search.jobs.wa.gov.au/jobs/health-service-medical-practitioner-perth-metropolitan-western-australia-australia`

It returned HTTP 200 and a `<script type="application/ld+json">` object with `@type: JobPosting`. Inspected fields were `title`, `description` (HTML), `datePosted`, `validThrough`, `employmentType`, `hiringOrganization`, `identifier.value`, and `jobLocation[].address` with locality/region/country. This particular sample advertises a psychiatry-setting health-service medical-practitioner pool; it is **not evidence of an internal-medicine post, IMG sponsorship, PESCI support or candidate eligibility**. The text requires valid Australian work rights and directs applications to MedCareers WA. A fit engine must retain those constraints and cannot label it a secured offer.

Example metadata in the retrieved source: `datePosted=2026-11-02T09:14:41Z`, `validThrough=2027-02-01T13:09:22Z`, stable `identifier.value=b4bf158ceaf693b0a8393fc5819ede32`. These are publisher assertions; verify the complete advert/attachments and any conflicting body deadline before asserting that applications remain open. Store the source date separately from the collection date.

Robots/operational boundary (`https://search.jobs.wa.gov.au/robots.txt`, HTTP 200):

- Disallows `/api/`, `/v1/candidate_details`, `/me/`, `/pages/*/blocks/`.
- Disallows query-based search paths containing `query=`.
- Specifies `Crawl-delay: 5` for the general agent group; a separate `bedrockbot` group disallows all paths.
- The public `/jobs/search/healthcare` category path, its `page=` pagination and ordinary job detail paths are not disallowed in the retrieved general-agent group.

Do not use hidden APIs, candidate routes or query-search endpoints as a shortcut. Honor at least five seconds between requests, use a truthful named collector user agent, keep a small bounded pass, and recheck robots before scheduled use. Follow the site's [privacy disclosure statement](https://search.jobs.wa.gov.au/privacy-disclosure-statement); no general automated-reuse licence was established by this probe. Never fetch linked application workflows automatically.

## Other probes and limitations

- `https://smartjobs.qld.gov.au/` returned a 376-byte HTTP 200 page containing a JavaScript redirect to `/jobtools/jncustomsearch.jobsearch?in_organid=14904`; the latter returned a full HTTP 200 job-search page. A homepage HTTP 200 alone is not a feed. No Queensland machine endpoint was verified in this pass.
- `https://www.iworkfor.sa.gov.au/` returned HTTP 200 HTML using BigRedSky. No machine endpoint was established in this pass.
- `https://www.healthworkforce.com.au/jobs` returned HTTP 403. No content, sponsorship claim or GP vacancy was verified from that response. Do not bypass the block.
- This probe did not verify university opportunities, all hospitals, all rural-workforce agencies, private clinic vacancies or social-media sources.

## Recommended pilot and acceptance checks

1. Implement the exact Tasmania public JSON endpoint first, scheduled conservatively (for example every six hours), with a 4 MB stream cap and a 1,000-record cap. No schedule is created by this document.
2. Normalize stable source ID, title, detail URL, source posted/closing dates, categories, locations, kind (`advertisement` / `employment_register`), plain-text summary and checked time. Keep sponsorship/supervision/registration/MMM/DPA as unknown unless explicitly evidenced.
3. Classify an expired deadline as closed; a future deadline as only an advertised future deadline. Absence from the next complete feed marks `missing_from_source` pending review, not a proven filled job.
4. Parse invalid/HTML/callback-wrapped responses as errors and retain last good data with a stale flag. Never overwrite all listings with an empty set after a partial or failed fetch.
5. Add WA as a separate low-frequency category-and-JSON-LD adapter after its crawl-delay and pagination state are enforced. Do not reuse a generic RSS URL field for HTML pages.
6. Test synthetic Microsoft dates, numeric ID URL construction, veterinary exclusion, register distinction, duplicate records, HTML sanitization, byte caps, deadlines and failed-pass nondeletion. Live smoke checks prove source reachability only; candidate acceptance and registration eligibility require separate official evidence.
