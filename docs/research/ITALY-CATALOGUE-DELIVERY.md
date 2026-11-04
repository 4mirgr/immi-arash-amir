# Italian directory, observed pages and actual opportunity feeds

Checked2026-11-04. These are separate datasets, not interchangeable measures of job or funding coverage.

| Layer | Actual evidence |
|---|---|
| Official institutional directory |102unique institutions from four MUR directories:61state,21recognizedprivate,11telematic,9special institutes;112campuslistingrows preserved in provenance. See ITALIAN-UNIVERSITY-CENSUS.md for links, source update dates and scope. This does not include every Italian education provider/AFAM/foreign branch. |
| Homepage technical scan |All102attempted;65HTMLhomepages checked,610official-domain/subdomain links observed;6body-limit,10robotsunavailable,2redirect-limit,14robotsdenied,3foreign-hostredirect,2invalidURL failures. No bypass of access controls or false success. |
| Bounded related-page scan |127actuallyobservedURLs across64parentuniversities;119checked,2HTTPfailures,2robotsdenials,4redirectlimitfailures. These119pages contained1189furtherlinks observed but NOT fetched. Linkcounts are observations, not globally deduplicated opportunities. |
| Italian call adapters |Bologna2 existingstreams plus PisaBRS5healthscholarships and PisaIRIC3health/lifescienceappointments actually inserted on Cloudflare. Catania returned10source rows with0healthmatches; validzero preserved. Fullpagecallcoverage for all102universities is NOT claimed. |
| Australia expansion |QLDHealthpublicmedical search20 andNSWHealthJMO5 imported in Cloudflare. Bothfirstpageonly, personaleligibilitynotassessed. |

## Storage and privacy

`university_catalogue` and `university_related_checks` in PUBLIC OPPORTUNITY_DB keep the directory, source dates, scan receipts, original parent links and limits. They do not populate `opportunity_editions`. `/api/discovery/universities` requires current verified Amir membership; Arash and forged profile selectors receive403. The UI is under Amir's opportunities countryItaly. It has searchable paginated institutional rows, per-page status and Google/Bing queries scoped to the official institutional domain, including subdomains. Those engine queries are manual links, not an unattended search API.

Actual opportunity editions remain independently source-scoped and preserve publication history and unknown dates. New sources merge from `italy-source-adapters.mjs` and `au-source-adapters.mjs`; all18executable configurations fit the unchanged three-source/hour and100record/run budgets. Normalfullrotation is about6hours, longer for backoff/continuations. A configured adapter is not automatically a healthy or complete source. Prior NTPHN403 remains honestly visible.

## Reproducible public imports

No credentials, private CVs, accounts or raw HTML belong in Git. The official directory and scanner code are versioned. Full receipts are public D1 data; scratch receipts are disposable, not the recovery source.

```bash
python scripts/scan_university_sites.py --input cloud/italian-universities.json --output /tmp/italy-home.json --workers 4
python scripts/scan_university_sites.py --related-from /tmp/italy-home.json --output /tmp/italy-related.json --workers 4 --related-per-institution 2
python scripts/prepare_university_catalogue.py --home /tmp/italy-home.json --related /tmp/italy-related.json --output /tmp/catalogue-import.sql
```

Apply `cloud/university-catalogue-schema.sql` to OPPORTUNITY_DB first, review the generated PUBLIC SQL, then import through the authorized D1 operator interface. The preparation script accesses no network or credentials and refuses to overwrite its output. It preserves scan metadata on directory updates. Homepage and observed-child receipt lists remain distinct. No private database or unrelated project is involved.

The dated scan is a technical observation, not periodic re-review of allItalian universityscience/admission/funding conditions. Childselection is bounded to twoobservedlinks perinstitution; deeper branches and unindexed/cookie/authenticated content remain outside coverage. The fiveItaliancallstreams are the automatic opportunity pipeline; broad technicalscan results are not silently promoted to live calls or eligibility conclusions.
