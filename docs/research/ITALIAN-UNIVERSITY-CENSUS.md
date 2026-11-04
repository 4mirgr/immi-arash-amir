# Italian university website census

Retrieved on **2026-11-04** from the Ministry of Universities and Research (MUR). Canonical data: `cloud/italian-universities.json`. This is a dated official-directory inventory for Amir's workspace, **not a collection of scholarships, open positions, admissions decisions or medical eligibility findings**. Every record is `automation: directory_only` and `reviewStatus: official_directory_entry`.

## Defined universe and actual count

The inventory covers every institution link in the **main content** of these four MUR pages, after documented campus deduplication:

| MUR category / source | Institutions | Source's own displayed update date |
|---|---:|---|
| [State universities](https://www.mur.gov.it/it/aree-tematiche/universita/le-universita/universita-statali) | 61 | 2023-04-04 |
| [Recognized non-state universities](https://www.mur.gov.it/it/aree-tematiche/universita/le-universita/universita-non-statali-riconosciute) | 21 | 2026-01-23 |
| [Telematic universities](https://www.mur.gov.it/it/aree-tematiche/universita/le-universita/universita-telematiche) | 11 | 2023-02-08 |
| [Special-status university institutes](https://www.mur.gov.it/it/aree-tematiche/universita/le-universita/istituti-universitari-ordinamento-speciale) | 9 | 2026-04-27 |
| **Total** | **102** | **112 outbound institution/campus listing rows** |

The non-state page has 31 outbound listing rows because it repeats campus locations. Link Campus and LUMSA repeats use the same published site; MUR explicitly identifies Catholic University campus links as subordinate to its Milan central institution. These rows are preserved in `directoryListings` and grouped into 21 institutions. All other category counts match MUR's own displayed totals. This grouping does not create separate campus universities.

“All” here means **complete extraction of these four named official directories at retrieval time**. It does not guarantee that old publisher update dates incorporate every subsequent legal change. It excludes separate foreign university branches and non-university AFAM institutions; those are distinct MUR universes. The nine special institutes include nonmedical defense/agriculture institutions, which are inventory entries, not recommendations for this doctor's career. IASA's linked BF Educational site is specifically marked by MUR as a temporary site while the institute-specific site is under construction.

## What was verified

Main-content lists and institution links were read freshly using the connected Firecrawl page-retrieval service. Direct requests from this workspace to MUR returned403; that is not proof of a deployable unattended MUR collector. A CINECA directory request was also inaccessible, so no unsupported claim of reconciling a second registry is made. Menu/footer links were discarded.

MUR itself lists five institution home links using HTTP. Their HTTPS home endpoints were separately retrieved successfully (HTTP200) through the page-retrieval service:

- Federico II: `https://www.unina.it/it/`
- Tor Vergata: `https://web.uniroma2.it/`
- Foro Italico: `https://www.uniroma4.it/`
- Politecnico di Bari: `https://www.poliba.it/en/`
- eCampus: `https://www.uniecampus.it/`

The dataset preserves the original MUR URLs in `directoryListings`; only observed HTTPS destinations are used as canonical main links. These five are labeled `https_homepage_observed`. Other main links are already HTTPS in the official directory and remain `official_directory_link_only`: **their individual home pages have not all been retrieved or their subdirectories audited**. Availability can differ by network (e.g. direct Federico II returned403 here while the retrieval service observed200); no accessibility guarantee is made.

No careers/funding/research subpath is guessed from a university domain. Such paths need separate retrieval and publisher-link evidence before becoming a source or adapter. A root website entry is not an executable opportunity feed. No private profiles, credentials, application forms, personal contacts or student records were accessed. Raw public retrieval artifacts under `/workspace/scratch/italy-census/` are disposable and are not recovery dependencies.

## Record contract

`id` is a stable `it-university-<directory-domain>` identifier. Each entry has `name`, optional/null `region`, observed `regions`, canonical HTTPS `url`, `directoryCategory`, `country: IT`, `profileScope: amir`, official `sourceUrl`, source's own `sourceUpdatedAt`, retrieval `reviewedAt`, `reviewStatus`, `automation`, `trust`, `websiteVerification` and original `directoryListings`. The inventory stores no personal data. Directory categories: `public_university`, `recognized_private_university`, `telematic_university`, `special_institute`.

For the next source expansion, use observed university roots to discover their actual institutional calls, PhD, research contracts, medical faculty/hospital and funding links. Keep catalog coverage and actual opportunity acquisition counts separate. Protected routes, authenticated portals and unresolved redirects must not be silently counted as active collection.

Verification: `node --test tests/cloud_italian_universities.mjs` checks counts/provenance, unique stable identities, secure URLs, all Amir-only scope, campus-row preservation and no invented live-call/eligibility fields.
