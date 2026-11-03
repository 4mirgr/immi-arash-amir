# Public opportunity source coverage

Checked 2026-11-03. Registry: `cloud/source-registry.json`. A configured discovery portal is **not** an active collector. No imported contact is represented as a vacancy. Source trust describes the publisher; applicant eligibility, sponsorship and supervision remain unassessed.

## Executable publisher feeds

| Registry ID | Publisher evidence | Feed | Verified snapshot / filtered result |
| --- | --- | --- | --- |
| `tas-pageup-759` | [Tasmanian Government jobs](https://www.jobs.tas.gov.au/) embeds PageUp tenant 759 | [JSON](https://careers.pageuppeople.com/759/cw/en/jobs.json) | 182 source records; 17 physician titles in Medical category; explicit advertised deadlines. Employment registers remain labelled registers. |
| `monash-pageup-513` | [Monash jobs](https://www.monash.edu/jobs/jobs-at-monash) links tenant 513 | [JSON](https://careers.pageuppeople.com/513/cw/en/jobs.json) | 63 source records; 11 medical/life-science research, teaching and scholarship titles; one missing deadline remains unknown. |
| `unibo-research-contracts` | [Bologna official contracts portal](https://bandi.unibo.it/ricerca/contratti-ricerca) advertises RSS | [RSS](https://bandi.unibo.it/ricerca/contratti-ricerca/rss.xml) | 15 source entries; three medical/life-science title matches. All lack deadlines; availability unknown. Amir only. |
| `unibo-scholarship-funding` | [Bologna official opportunities portal](https://bandi.unibo.it/agevolazioni/opportunita) advertises RSS | [RSS](https://bandi.unibo.it/agevolazioni/opportunita/rss.xml) | 15 source entries; seven health or explicit funding/scholarship calls. Discipline, student status and other eligibility require call review; all lack deadlines. Amir only. |
| `unsw-pageup-841` | [UNSW official careers](https://external-careers.jobs.unsw.edu.au/cw/en/listing/) embeds `PU.Jobs.source.instId=841` | [JSON](https://careers.pageuppeople.com/841/cw/en/jobs.json) | 110 source listings; 18 medical/health academic and research matches after excluding research administration. Several roles have additional discipline/registration/identified-position criteria requiring review. Missing deadline remains unknown. |
| `griffith-smartrecruiters` | [Griffith official search jobs](https://www.griffith.edu.au/jobs/search-jobs) embeds SmartRecruiters widget with `company_code: GriffithUniversity` | [Public JSON](https://api.smartrecruiters.com/v1/companies/GriffithUniversity/postings?limit=100) | 24 public source postings; six health academic/research/scholarship matches, including two PhD scholarship titles. Closing dates are absent; status stays unknown. Old release dates are not proof that funding is currently available. |

These are point-in-time verification counts, not promised current totals. Parsing was tested on the actual public responses locally. Monash and Bologna records include opportunities requiring qualifications beyond either current profile: a research listing is not a personalized eligibility decision. Scholarship/grant/funding types are assigned only from explicit title words, otherwise university. Original Italian titles are retained.



The two added feeds were fetched and normalized from actual publisher responses on 2026-11-03. SmartRecruiters' [Posting API overview](https://developers.smartrecruiters.com/docs/posting-api) and [endpoint contract](https://developers.smartrecruiters.com/docs/endpoints) document this public listings endpoint and unauthenticated request examples. Its API-host robots file disallows generic crawlers; this adapter is a bounded integration with the documented public API, not HTML indexing or an impersonated search bot. No API key, OAuth credential or internal-postings scope is used, and rows must explicitly have PUBLIC visibility. If provider terms or API access change, disable the source rather than bypass restrictions. No synthetic test records were imported into cloud storage. Griffith's dedicated adapter checks company identity, public visibility and Australian country/region; builds only fixed employer job URLs; and rejects an incomplete upstream page (`source_pagination_required`) rather than silently claiming complete coverage beyond 100 source entries.

## Other registered coverage

Official discovery portals exist in the registry for NSW, QLD, VIC, WA, SA, TAS, NT and ACT. Continuous executable state government medical collection now covers **Tasmania and SA Health**. Monash adds Victorian university research, UNSW NSW research, Griffith Queensland research/scholarships, University of Canberra an ACT health academic register, and UWA a bounded WA medical-academic listing page. These university feeds do not imply NSW/QLD government hospital job coverage. Other state portals are `feed_not_configured` until a bounded permitted adaptor is implemented and verified. This is not Australia-wide live coverage.

- WA: public healthcare category exists, but robots disallow API paths; no hidden API is used.
- SA: the verified channel is `caw`, not the guessed legacy channel. The unfiltered response is about8.5MB and is intentionally excluded; the official `?category=Medical` parameter returns about809KB/61rows and is the only configured SA feed.
- ACT Government remains reference-only. The separately verified University of Canberra public tenant737 feed is not government hospital coverage.
- Padua: official selection announcements page is public; no bounded call feed has been verified. Internal backend URLs embedded in HTML are excluded.
- Sapienza: scholarship portal is public; general site RSS is news, not a validated opportunity feed.
- Milan: attempted RSS returned HTTP 403; registry reports blocked. No bypass is attempted.
- SEEK: explicitly unofficial, discovery link only, with verification date unset and no automated feed configured. It is not counted as active collection.

LinkedIn private connections, Telegram private groups, protected pages and authenticated sources are excluded from this public collector. No account cookies, Google credentials or AI provider calls are used.

## Runtime and API contract

Apply `cloud/opportunity-v2-schema.sql` and `cloud/source-registry-schema.sql` before enabling the scheduled handler. Import `collectRegisteredSources(env, fetcher=fetch)` in the existing Worker schedule, replacing the legacy Tasmania fetcher. It requires `env.OPPORTUNITY_DB`. No provider key is needed. `normalizeSourceRecords(source, body)` is exported for controlled server-side imports of the same fixed feeds; callers cannot override the registry endpoint or trust settings.

`handleRegisteredSourcesRequest(request, env, context, fetcher=fetch)` handles only:

- `GET /api/opportunities/sources`: authenticated `{userId, profileId}`; Italy/Amir-only entries omitted from Arash's response.
- `POST /api/opportunities/refresh`: same authentication, same-origin check and an empty JSON object only. Client source URLs/configurations are rejected. Shared public collection may check an Italian feed, but its receipt is omitted from Arash's response.

Register this handler before legacy opportunity routes. Collection status fields include `collectorStatus`, `configurationStatus`, `reason`, `lastAttemptAt`, `lastSuccessAt`, `nextCheckAt`, `lastErrorCode`, `importedRecords`, and `partial`. `executable` describes an installed adaptor, not successful runtime connectivity. A last successful timestamp and current errors determine freshness.

Each invocation visits at most three fixed feeds, rotating the starting position in D1, and writes at most 100 records (40 per source). The current ten sources' filtered results fit comfortably within those limits. Larger matching feeds use a persisted continuation cursor; their ETag is suppressed until all slices have been fetched. A cursor resumes a sorted publisher snapshot approximately; publisher reordering can defer individual records until the following full cycle. It never deletes historical editions or treats missing records as closed. Store batch writes use the V2 module's bulk SQL path.

Success cooldown is three hours, partial-snapshot cooldown 15 minutes, failure cooldown six hours. With ten executable sources and an hourly cron, a three-source rotation normally reaches each source about every three to four hours; failures, cooldowns and partial continuation can extend this interval. Per-source D1 locks suppress concurrent refreshes. ETag conditional requests avoid unnecessary imports. Zero matching records from a valid feed is a successful empty result, not evidence of a broken source. Failures preserve prior records. The collector does not infer disappeared vacancies have closed; the V2 store derives closed/open from explicit source deadlines and keeps missing deadlines unknown.

Requests use HTTPS exact host allowlists, no credentials or custom ports, redirect rejection, 15-second fetch abort signals, a three-megabyte streamed response cap and 500-item parser limits. RSS rejects DTD/entity declarations and never resolves external entities. JSON is parsed, never executed. The source registry is bundled server-side and accepts no arbitrary URL input.

The dashboard's 10-second refresh reads cached application data. It does not repeat third-party source collection every ten seconds. Background execution requires the deployed Cron Trigger; this module does not run persistent AI agents or promise perpetual free crawling.

## Rejected expansion probes

- PageUp tenant 824 redirected to an `en-us` feed belonging to a US technical college, so it was **not** treated as UWA or an Australian source.
- University of Adelaide's official legacy portal identifies tenant 612, but its verified JSON snapshot was an empty array. It was not added as a useful new collection source.
- UWA and ANU current portals use different public frontends; no bounded feed adapter was verified in this expansion.
- Queensland Smart Jobs `/jobs/rss` redirected to the homepage, so it was not mistaken for a validated RSS feed.
- The Iranian Internal Medicine Society RSS is scientific news/event material, not a job/funding feed. It is excluded from this opportunity adapter rather than misclassified as vacancies.

## Validation

`node --test tests/cloud_source_collectors.mjs`: twenty-one tests covering registry coverage truth, URL/redirect/SSRF rejection, malformed feeds, response bounds, unknown deadlines, Italy isolation, ETag, cooldown, round-robin budgeting, bounded continuation, and preservation of prior records after errors. Network verification used public responses on the stated check date; automated tests use synthetic data and do not make external requests.

## Verified deployment-side collection

On 2026-11-03, a temporary bearer-protected operator Worker with only the public OPPORTUNITY_DB binding invoked the actual six-source collector in two bounded calls. Receipts confirmed TAS17, Monash11, Bologna3+7, UNSW18 and Griffith6 records; 24 new edition records were inserted. This is real runtime collection evidence, not a mocked test or a claim that all62 are open/eligible. The temporary Worker was deleted after the run.


## SA, ACT and WA expansion — actual source verification 2026-11-03

| Source | Verification | Bounded snapshot result |
| --- | --- | --- |
| `sa-health-pageup-532` | [Official SA Health portal](https://careers.sahealth.sa.gov.au/en/listing/) explicitly publishes `PU.Jobs.source` tenant532, channel`caw`. [Filtered public feed](https://careers.pageuppeople.com/532/caw/en/jobs.json?category=Medical) uses the publisher's visible Medical category. |61source rows,28clinicalphysician/registrar/consultant titles after excluding support/allied roles. The unfiltered8.5MBfeed is not configured. Advertised dates are preserved; pool titles are registers. Eligibility remains unassessed. |
| `canberra-pageup-737` | [University work-at-UC](https://www.canberra.edu.au/about-uc/work-at-uc) links [UCTalent](https://uctalent.canberra.edu.au/cw/en/listing), which identifies tenant737. [Public feed](https://careers.pageuppeople.com/737/cw/en/jobs.json). |17source rows; one Faculty of Health casualacademic talent pool. It is explicitly an employment register with unknownclosingdate, not a secured vacancy or generalACTclinicaljobcoverage. |
| `uwa-public-search` | [UWA careers](https://www.uwa.edu.au/about/working-at-uwa/careers) links its [public search page](https://external.jobs.uwa.edu.au/jobs/search). Public HTML cards are read without executing scripts or contacting hidden APIs. |25cards on the first public page, six medicaleducation/ruraltraining academic matches. Published/closingdates absent and stayunknown. Otherpages are NOT collected; the registry exposes `first_public_search_page_only`. No inferred deadline or personal eligibility. |

UWA's robots file permits the configured search path and asks a five-second crawl delay. It disallows `/api/`, `/me/`, candidate details, privatepageblocks and searches using`query=`; none are used. The collector fetches only one UWA page per multi-hour scheduled cycle, well beyond that delay. PageUp's robots exclude internal/staging channels, while the configured public `cw`/`caw` feeds are not excluded. No bot impersonation, account cookies or applicant fields are used.

Executable sources now total **ten**, covering at least one bounded source in all eight Australian states/territories plus Italy. This is minimum jurisdiction coverage, not comprehensive clinical vacancies in each jurisdiction. This does not imply comprehensive clinical job coverage in those jurisdictions. With the unchanged three-source-per-invocation budget and hourly cron, one complete ten-source rotation normally takes approximately **three to four hours**, longer after failures/rate limits. Manualrefresh calls remain subject to source cooldowns and locks. The four new adapters were also run in a bounded, authenticated deployment-side operator invocation: SA28, ACT1, UWA6 and NT18 records were inserted successfully. The temporary operator Worker was deleted afterward.


## Northern Territory public search — actual verification 2026-11-03

The official https://jobs.nt.gov.au/Home/Search page publishes its visible Department of Health agency22 and Medical Officer category2085. Its public `HomeSearchTS` JavaScript submits anonymous JSON to the same `/Home/Search` path; the configured adapter uses that exact fixed POST body. No credentials/cookies, saved-search, application, attachment or candidate endpoint is contacted. The robots file excludes `/services/` and `/Home/DownloadAttachment`, neither of which is used.

The actual filtered response was120,952bytes/30records (it includes some multi-category nursing/allied roles, which the local physician-title filter removes). Published dates use the explicit publisher epoch field. NT closing timestamps are midnight date-values alongside display dates rather than a verified exact cutoff, so `closingAt` stays unknown and the publisher display date is preserved verbatim in fulltext. No ambiguous date/cutoff/time zone is guessed. Cancelled records are excluded. The RMO register explicitly restricts generalregistration/CompetentAuthority and excludes standard-pathway applicants: these instructions are preserved in fulltext, not converted into an assumed IMG eligibility match. Missingclosingdates on recruitment programmes remain unknown/registers. `RecruitmentProgramUrl` is not used as a replacement for the canonical public job detail URL.

The NT response includes UI-only saved/applied flags and attachmentmetadata; these are discarded. Only public job descriptions, sourceIDs, dates and published professional contact information are retained. The adapter fails on malformed source identity/schema and continues to use the same total three-source/100-record runtime budget. A synthetic test verifies no Authorization/Cookie header and fixed filters.


## Scheduled execution receipts

`source-automation-schema.sql` adds a single public operational receipt in OPPORTUNITY_DB. Only the Worker scheduled handler writes its actual start/end/status; manual source refreshes do not manufacture cron evidence. The authenticated sources endpoint includes this receipt, hourly cadence and a warning after 150 minutes without a fresh start. Missing receipts are displayed as not observed. This observes execution, not guaranteed future availability or full coverage. The open opportunities panel polls cached data every ten seconds only while visible. Per-source nextCheckAt is the earliest allowed retry, not a promised appointment.


## GP/rural expansion — 2026-11-03

Source registry now combines `source-registry.json` with three fixed `RURAL_SOURCE_DEFINITIONS` from `rural-source-adapters.mjs`: 13 configured executable adapters. Clinical/rural evidence is reviewed in `docs/research/rural-source-adapters.md`. The hourly three-source budget yields a normal full rotation of approximately4–5hours; failures have a six-hour backoff and larger snapshots continue in40-record slices.

Actual Cloudflare bounded operator receipt at2026-11-03T19:28:06Z: RuralHealthWest40inserted of83matching (continuationcursor40), ThePeopleProjectTasmania6inserted, NTPHNHTTP403/source_access_denied and0imported. Local successful parsing of NTPHN7records is not production acquisition evidence. The temporary operator Worker was removed; no private grants were attached. These46new records have unknownclosingdates and are candidates for review, not guaranteed open vacancies or offers. Firstparty recruitmentpublisher is kept distinct from an independently verified clinic/employer.

Arash discovery directory:19dated links spanning all8jurisdictions,4clinicnetworks and3publicpublisher sociallinks. Those links are manual discovery, not additional automated collectors. No private groups, private profiles or authenticated social pages are scraped. GP/MedicalOfficer and rural-wording filters apply before pagination; quoted MMM codes are unverified advertisement wording and never establish DPA or eligibility.
