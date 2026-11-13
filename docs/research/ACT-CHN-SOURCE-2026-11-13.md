# ACT GP listing coverage — 13 November 2026

Added a bounded public listing adapter for Capital Health Network (CHN), the ACT primary health network. This is a recruitment publisher, not a clinic job offer, registration authority or verified supervision provider.

## Actually read

- Listing: https://www.chnact.org.au/careers/external-primary-care-vacancies/general-practitioner-vacancies/ — HTTP200 with the runtime collector's actual `MasirUniversityDiscovery/1.0` user agent. The public browser rendering also returned200. Five first-page GP cards were present.
- Robots: https://www.chnact.org.au/robots.txt — HTTP200 with the actual collector agent; `User-agent: *` disallows `/wp-admin/` only and allows the public listing/detail paths.
- Yarralumla detail: https://www.chnact.org.au/gp_vacancies/part-time-general-practitioner/ — HTTP200. The published field “Willing to sponsor suitable overseas applicants” says “No”. This is a negative applicability signal, not a suitable sponsored Level1 match.
- Manuka detail: https://www.chnact.org.au/gp_vacancies/general-practitioner/ — HTTP200. The page requires a vocationally registered GP (FRACGP or FACRRM) with full AHPRA registration and a non-geographically-restricted Medicare provider number. These are material restrictions for an IMG awaiting initial supervision.

- Watson detail: https://www.chnact.org.au/gp_vacancies/watson-gp-room-to-grow-time-to-breathe/ — HTTP200; the published overseas-sponsorship field says “No”. No explicit Level1 commitment was observed.
- Family First detail: https://www.chnact.org.au/gp_vacancies/general-practitioner-6/ — HTTP200; AHPRA registration is required and the overseas-sponsorship field says “No”. The generic registration mention is not evidence that limited registration or Level1 supervision is available.

All four retained first-page candidate detail pages were actually read in this review. These findings describe the pages read today, not a promise of continued vacancy or a sponsor offer; runtime uses new source observations rather than hard-coding this review as current evidence.

A separately attempted RDWA public jobs page returned403 and was not enabled. RWAV's public page returned200, but its actual listings require a separate dynamic integration; it was not counted as a working feed.

## Runtime scope and outcomes

`cloud/chn-gp-source-adapter.mjs` exports `CHN_GP_SOURCE_DEFINITIONS` and `normalizeChnGpSourceRecords`. The adapter only reads the configured first HTML listing page, excludes explicit VR-only titles and nonmedical/hidden/script cards, validates exact publisher job URLs and date-only publication labels, and leaves closing time, supervision, sponsorship and eligibility unknown. It does not send applications, guess clinic domains or turn publisher reception contacts into application recipients.

The newest9November2026 card explicitly says VR General Practitioner, so it is excluded. Four remaining listing candidates are dated24October,22October,29September and24August2026. Their presence is not evidence of eligibility, Level1 support, sponsorship or a current confirmed closing date. The source may provide newly posted suitable roles later; no fresh Level1 offer was verified in this expansion.

Clinic names are extracted only from the published heading's final ` - ` segment; missing employer domains remain unknown and the shared store marks its publisher-domain fallback separately. A publication day is passed as `YYYY-MM-DD`; the shared store's established ISO presentation convention does not supply a source-reported exact time. Details and public contacts must be read by the existing per-opportunity queue; list cards are not full advertisement analysis.

Integration adds one source to the existing rotation. There is no extra cron or per-listing detail request in the collector: three sources/hour and the existing100record maximum remain unchanged. Four synthetic regression tests cover provenance/unknowns, VR restrictions, hidden/script exclusion, dates, duplicates, forged source identity and unsafe URLs. Actual fetched HTML was kept outside Git under scratch, not committed as a fixture or falsely presented as a future live reading.
