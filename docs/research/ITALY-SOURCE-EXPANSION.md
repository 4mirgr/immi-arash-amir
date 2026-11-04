# Italian official university call adapters

Reviewed 2026-11-04. The three fixed definitions and parsers are in `cloud/italy-source-adapters.mjs`. All are official first-party university sources, country IT and Amir-only. A successful local fetch/parse is not a production receipt, an admission decision or a verified open position. Root must integrate the definitions, run the scheduled collector and report actual runtime results separately.

## University of Pisa: official index and public call subsystem

The current official index https://www.unipi.it/ateneo/concorsi/borse-e-assegni-di-ricerca/ was retrieved and explicitly links the university's public recruitment subsystem at `bandi.unipi.it`. Its visible links include types COR, IPDOC, IRIC, ASR and BRS. Only the following two fixed, public HTML tables are configured; no applicant login, application form, document upload or hidden API is contacted:

- https://bandi.unipi.it/public/Bandi?type=BRS — research scholarships. Actual HTTP200 response: **31,070 bytes**, eighteen public call rows, **five retained health/life-science rows** after excluding plant/agriculture/oceanic content. Examples include a medical-department HPV/gynaecology study, human-movement data analysis, a water-safety plan from translational medicine and a biology study. Life-science matching does not imply every call suits a physician.
- https://bandi.unipi.it/public/Bandi?type=IRIC — research appointments. Actual HTTP200 response: **26,990 bytes**, eight public call rows, **three retained biomedical-engineering rows**, concerning neural in-vitro models, cellular models and cardiovascular dynamics. Department-specific technical qualifications may be required; these are not clinical practice offers.

The visible table supplies a stable UUID detail URL, title, organisational unit, places and local advertised deadline. The parser retains that display text but leaves `publishedAt` and `closingAt` unknown rather than assuming a cutoff timezone. Applicants must inspect the original call and attachments for eligibility, exact deadline, remuneration/funding and application procedure. A scholarship classification is a research-call category, not proof of full tuition/stipend support or student admission.

`https://bandi.unipi.it/robots.txt` returned404; no access restriction was bypassed. Requests are bounded and scheduled at multi-hour intervals. The main site and recruitment subdomain remain distinct verified publisher surfaces.

## University of Catania: current research scholarships

Official overview https://www.unict.it/it/ricerca/borse-di-ricerca links the current public table https://www.unict.it/it/bandi/ricerca/borse-di-ricerca. Actual HTTP200 response: **34,941 bytes**, ten current source rows, **zero retained health/life-science calls** on this check. Current unrelated engineering, communication and agricultural calls are not padded into the medical shortlist. The executable adapter can discover later relevant calls; successful zero-result parsing is separate from a failed source.

Details use the university's stable `/it/bandi/ricerca/borsa-di-ricerca?k=<numeric-id>` path. The parser restricts that path, query and host. Table publication/deadline values are preserved verbatim; exact timezone is not inferred. The robots file permits these public paths and asks for a ten-second crawl delay, exceeded by the multi-hour schedule. Administrative, login, user and search paths are not accessed.

## Investigated but not counted as new active feeds

- University of Florence and University of Trento candidate pages returned403 during direct fetch. No bypass was attempted.
- University of Padua's current public research-grant page returned200 (1,421,529 bytes) but was an overview/links surface rather than a verified bounded current-call feed. Its embedded navigation or internal application endpoints were not treated as job records.
- University of Trieste's public in-publication research-grant page returned200 but contained no verified active call table on this check; general RSS linked there is university news, not automatically a scholarship feed. It was not promoted to executable call coverage.

Raw public response files are disposable verification artifacts outside Git in `/workspace/scratch/italy-feeds/`. Tests use synthetic content only: `node --test tests/cloud_italy_sources.mjs` checks scopes, stable identities, source URLs, health filtering, zero-result handling, missing timezone, schema failure, source override/SSRF restrictions and body bounds.
