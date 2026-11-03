# GP/rural recruitment adapters — checked 2026-11-03

These are official recruitment publishers' own public resources, not government approval of an applicant. They publish vacancies on behalf of independent practices. `organization` deliberately names the **recruitment publisher**; it is not a verified employer identity. No list is represented as a secured offer, personally eligible role or complete rural coverage. All three adapters keep unstated deadlines unknown. No MMM/DPA, visa sponsorship, PESCI permission or supervision level is inferred from geography, publisher or title.

## Rural Health West — WA

- Public entry: https://ruralhealthwest.com.au/vacancies/general-practitioners/
- Its visible JavaScript: https://ruralhealthwest.com.au/wp-content/plugins/startdigital_bullhorn/public/script.min.js?ver=1792738941
- Public frontend request: https://ruralhealthwest.com.au/wp-admin/admin-ajax.php?action=get_jobs&page=1&pageQuery=/vacancies/general-practitioners/
- Robots: https://ruralhealthwest.com.au/robots.txt — no disallowed paths in the observed file.

The page embeds `#bullhorn`. The linked client JavaScript anonymously GETs `action=get_jobs`, `page=1` and the page pathname; it uses the `id` query parameter to display a selected job. This is the request used by the ordinary public job page. The adapter does not access `send_job_submission`, application forms, captcha, accounts or candidate data. No browser cookie/token, authentication bypass or private endpoint is used.

Actual response: HTTP200, 432,752 bytes, `count=83`, 83 public AU/WA physician/GP rows. All 83 normalized. `dateAdded` is a publisher epoch; no closing date is provided. The parser takes **publicDescription**, not internal `description`, and drops unrelated fields, address lines and scoring. Snapshot count equality prevents silently importing a partially paginated response. Stable public links follow the site's `?id=` mechanism. A few records encode state as `WA`, others `Western Australia`; both were observed. Full descriptions often require FRACGP/FACRRM/Ahpra, so presence on this GP list does not establish suitability for an AMC standard-pathway doctor.

The list is re-fetched under the existing bounded collector; only its usual record slice is stored per invocation. This is not a claim to continuously scrape all clinics or every rural position in WA.

## NT PHN — Northern Territory

- Public careers page: https://ntphn.org.au/health-careers/current-opportunities/
- Public Job Manager RSS: https://ntphn.org.au/?feed=job_feed
- Robots: https://ntphn.org.au/robots.txt — disallows `/wp-json/` and `/?rest_route=`. Neither is used.

The public jobs page identifies WordPress Job Manager and its profession categories. Its standard public job RSS returned HTTP200 and 106,822 bytes: ten recent public entries, seven physician/GP titles after filtering. Public `content:encoded` retains the actual requirements rather than a search snippet. `<link>` must point to an exact same-host `/job/<slug>-<numeric-id>/`; canonical IDs and source publication dates are retained. GUIDs pointing to another hostname are not used. No feed category filter is trusted to work: the upstream category variant was observed to return the same ten rows, so filtering is explicit and coverage is honestly **latest RSS items only**.

One current source detail was checked directly: https://ntphn.org.au/job/specialist-general-practitioner-fcd-health-palmerston-113423/ returned HTTP200 and an Apply Now route. It explicitly asks for current specialist/general Medical Board registration and RACGP/ACRRM fellowship. This is a gap requiring review, not an offer suitable for all IMGs. Detail availability for one role does not validate every feed role or its deadline.

## The People Project / HR+ — Tasmania

- Legacy HR+ vacancies URL redirects to The People Project: https://www.hrplustas.com.au/vacancies
- Current public jobs page: https://thepeopleproject.com.au/jobs/
- Robots: https://thepeopleproject.com.au/robots.txt — requests ten-second crawl delay and excludes calendar/events action routes and `/cdn-cgi`; the configured jobs path is not excluded.

Actual public HTML: HTTP200, 80,497 bytes, twelve first-page job cards, six physician/GP matches. Cards use stable `post-<id>`, `occupations-gp` and same-host `/jobs/<slug>/` links. GP cards retain title, public summary and advertised region. No FacetWP endpoint, filter nonce, contact form or hidden API is used. Only the **first public HTML page** is covered; there were 73 total jobs indicated in the page's UI metadata, so this is not complete Tasmanian recruitment coverage. Multi-hour scheduled requests exceed the ten-second crawl-delay requirement.

One current detail was checked directly: https://thepeopleproject.com.au/jobs/gp-burnie-gp-superclinic/ returned HTTP200 with an application route. This does not prove IMG acceptance, supervision, sponsorship or availability for every card.

## Verification and excluded candidates

`node --test tests/cloud_rural_sources.mjs`: eight tests cover provider schema, fixed identities/URL hosts, nonpublic and nonclinical filtering, internal-field exclusion, missing dates, malformed/partial snapshots, XML entity rejection and conservative output. Real normalized counts above were independently run against public response files held outside Git. These files are disposable verification artifacts, not required production state.

Other investigated candidates were not promoted to executable coverage: Health Workforce Queensland and RDWA returned403 in this execution; RWAV's public vacancies URL rendered a JS shell. No blocker was bypassed. Rural Health West's generic `/jobs/` is an internal organisation-jobs archive, not the intended GP feed; it is not used.
