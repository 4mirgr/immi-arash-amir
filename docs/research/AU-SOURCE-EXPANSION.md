# Official clinical source expansion — checked 2026-11-04

These two adapters use first-party, anonymous public HTML. Their definitions and parsers are in `cloud/au-source-adapters.mjs`. They do not apply, create alerts, handle applicant accounts, follow private APIs or infer registration/sponsorship eligibility. A source appearing here is not proof of production collection; the root deployment must run and record actual imports.

## Queensland Government Smart Jobs: Health - Medical

- Official entry: https://smartjobs.qld.gov.au/
- Visible public search form: https://smartjobs.qld.gov.au/jobtools/jncustomsearch.jobsearch?in_organid=14904&in_exact_phrase_match=Y
- Configured search: https://smartjobs.qld.gov.au/jobtools/jncustomsearch.searchResults?in_organid=14904&in_multi01_id=1108&in_multi01=%2244%22&in_orderby=scoring%20desc
- Robots: https://smartjobs.qld.gov.au/robots.txt returned404 (no published robots directives at that location).

The actual form exposes occupational group `Health - Medical` as value `"44"` and field ID1108; the government organisation ID14904 is published in its links/hidden form fields. The fixed GET is the ordinary public search form destination. It uses no session, login, token, user-supplied URL, application or candidate field.

Actual filtered response: HTTP200, 141,798bytes and20 doctor cards on its first page. All20 normalized as clinical roles, including medical officers/rural generalists, resident/house officer pools, registrars and staff specialists. This is **first-page coverage**, not all Queensland medical vacancies. The source's ongoing/talent-pool roles are not specific secured vacancies. Explicit `date-closes` ISO timestamps with publisher `+10:00` offset are retained; the visible label `Ongoing` overrides its far-future placeholder and stays unknown. Publication dates are absent and stay unknown. Salary scripts are not executed or treated as verified compensation.

Direct public detail checked: https://smartjobs.qld.gov.au/jobtools/jncustomsearch.viewFullSingle?in_organid=14904&in_jnCounter=223003545 returned HTTP200, 98,504bytes for Senior Medical Officer — General Practitioner / Rural Generalist. It links a role description and instructions for applications. Detail availability does not establish that Arash meets its essential requirements; the public listing synopsis does not contain all requirements in the attached role description. The parser canonicalizes links to only the organisation and numeric counter, dropping presentation ordering and rejecting session/foreign query parameters.

## NSW Health: Junior Medical Officer public portal

- Official medical careers entry: https://jobs.health.nsw.gov.au/medical-jobs
- Explicit linked Medical Officers/JMO destination: https://jobs.health.nsw.gov.au/JMO-ex
- Robots: https://jobs.health.nsw.gov.au/robots.txt says `User-agent: *`, empty `Disallow`, and links a public sitemap.

The medical-jobs page returned HTTP200 (79,966bytes) and explicitly links `JMO-ex`. That public landing page returned HTTP200, 92,340bytes and five current `job_list_<id>` cards: two Resident Medical Officers, two Provisional Fellows and one Advanced Trainee. The parser reads only those **five public landing-page cards**; it does not claim all NSW Health/JMO roles, application availability, internships or state-wide supervision coverage. The district/employer is retained from each card rather than replaced with a guessed clinic. No closing or publication dates are on these cards; both remain unknown. Locations and short descriptions are retained as publisher wording. Full descriptions and attachments may contain additional prerequisites.

Direct public detail checked: https://jobs.health.nsw.gov.au/JMO-ex/jobs/resident-medical-officer-358578 returned HTTP200 (87,282bytes). It describes supervised clinical work and refers to essential requirements. This is not a verified limited-registration place, a sponsorship offer or guaranteed PESCI support. The senior-medical category search explicitly linked by the government page returned403 from this execution, so it was not promoted to another executable adapter or bypassed.

## Other attempted sources and limits

RWAV's public vacancies HTML returned200 but a JavaScript-filled result shell; public job queries use a nonce and were not implemented in this bounded one-fetch adapter. ACT CHN's public GP page, Health Workforce Queensland, Ochre and IPN returned403 in this environment; none is claimed as acquired here. Health Workforce Queensland's robots disallow API paths and query URLs; none was used. RWAV's robots permits search/reference use but reserves AI training; no training or generated-summary ingestion was performed.

Verification fixtures are disposable public files outside Git under `/workspace/scratch/au-expanded/`: `qld-medical.html`, `nsw-jmo.html`, relevant robots and two detail receipts. They are not required for recovery. Seven synthetic tests in `tests/cloud_au_sources.mjs` cover fixed domains, stable identity, date/sentinel handling, role exclusion, malformed or empty shells, body bounds and rejection of foreign/session URLs. Run `node --test tests/cloud_au_sources.mjs`.
