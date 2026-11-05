# Reviewed GP clinic sources — 2026-11-05

These are public-source research receipts and integration candidates. They are not job offers, a personal eligibility assessment, a supervisor nomination or a guarantee that a vacancy is still open. The review uses current page content and records restrictions as well as positive wording. No clinic was contacted, no application was submitted and no private account data was read.

## Review method and runtime boundary

- Two Exa searches returned 14 candidate results. Ten distinct public pages were successfully read in full through Exa, including recruitment pages and clinic homepages; one additional requested contact URL did not resolve in Exa.
- Direct HTTP checks were also made with a normal browser user agent, then repeated with the runtime collector identity `MasirPublicSourceCollector/1.0` and `Accept: text/html`.
- The five positive/restricted candidates below returned HTTP 200 to the collector identity in this execution environment. This proves page retrieval here, not that Cloudflare production has already ingested them or that the employer accepts this particular candidate.
- Ararat was readable through Exa but returned HTTP 406 with the browser identity and HTTP 503 with the collector identity. It remains a disabled research reference. These failures do not prove the clinic is closed.
- The connected Exa app was used for this research turn. It is not a standing API key for the website. Automatic operation requires the existing registered-source collector/public reader plus a parser, allowed hosts, provenance, source checks and budget. Adding a file alone does not activate a source.

Machine-readable receipts: `cloud/gp-reviewed-discovery-sources.json`. `executable:false` deliberately means “reviewed candidate, not activated by this research task”; the adapter owner may activate only candidates with `activationAllowed:true` after parser and runtime checks. No existing source registry or database was changed by this research task.

## High-value candidates

| Source | What the page actually says | Contact published in this source | Classification and action |
|---|---|---|---|
| [Wembley Rd Medical Centre, Logan — HWQ referral listing](https://www.healthworkforce.com.au/job/general-practitioner-logan-qld-10004252-682809) | “Opportunity for International Medical Graduates requiring Level 1-2 supervision.” Also requires “AMC Certificate”, provisional/limited registration eligibility, RACGP PESCI eligibility, BLS and ACLS. | `admin@wrmc.au`; 07 3412 8333; Mohamed Samad, listed as contact (role not specified). | Named employer listing with explicit Level 1–2 wording. Strong follow-up evidence, not approval of the proposed supervision or individual eligibility. Clarify whether AMC Certificate is literally required; do not equate MCQ with AMC Certificate. No closing date was found. |
| [Alba Health — Employment](https://albahealth.com.au/employment/) | “We can provide support and supervision to eligible International Medical Graduate (IMG) Medical Practitioners…” | `admin@albahealth.com.au`; 03 5751 1138; Justin Donaldson is named Principal GP. | Evergreen expression-of-interest source in Myrtleford, VIC. Ask about a named position, Level 1 capacity and PESCI documentation; these are not explicitly promised. |
| [Ausdocs Group — Work with us](https://ausdocsgroup.com.au/work-with-us) | Accredited registrar clinics in “MMM1 to MMM5 locations”; a dedicated IMG team; supervision support depends on assessing individual qualifications, skills and experience. | (07) 3392 2614 and an official enquiry form. No application email found in the page content read. | Network-level expression of interest. Useful metropolitan-inclusive coverage. Network MMM claims are not a verified classification for an individual clinic; no explicit Level 1 commitment. |
| [Australian General Practitioners Pty Ltd — Teaching and training](https://www.ausgp.com.au/teaching-and-training/) | “AusGP supports the supervision of international medical graduates who have done AMC 1”; “AMC 1 plus PESCI for our practice.” | `enquiries@ausgp.com.au` (general enquiry). | Training/enquiry source for rural NSW network. It still uses MDRAP and older programme descriptions: retain as employer support wording, not current regulatory advice. Exact Level 1 and an open role need confirmation. |
| [Reliance Care Medical Centre — 2026 IMG intake](https://reliancemedical.com.au/announcements/img-recruitment) | Explicitly recruits IMGs who have **already passed** the PESCI interview and hold/are eligible for Ahpra registration. Published 22 January 2026. | `Director@reliancecareandsupport.com.au`; (03) 9958 6699. | A named recruitment advertisement, but unsuitable as evidence that the clinic will help book an initial PESCI. Keep the passed-PESCI requirement visible. No closing date found; current intake needs confirmation. The application address is on a different domain but is directly published by the employer. |

## Negative evidence worth preserving

[Ararat Medical Centre recruitment](https://www.araratmedicalcentre.com.au/recruitment.html) states: **“We currently do not have any positions for PESCI/Level 1 Supervision.”** It advertises GP positions with General Registration and other registrar roles. The page says updated 1 April 2026 and publishes `jobs@araratmedicalcentre.com.au`, 03 5352 2311.

This must be a restriction, not a positive Level 1 lead. Its direct-fetch failures also mean automatic retrieval remains unverified. No authentication bypass or repeated aggressive crawling should be used to force access.

## Cross-checks and exclusions

- The Wembley clinic homepage [www.wrmc.au](https://www.wrmc.au/) returned HTTP 200 after a redirect to `https://new.wrmc.au/`. It confirms 90 Wembley Rd, Logan Central, QLD 4114 and the same clinic phone; it publishes the general address `wrmc4114@gmail.com`. Keep this separate from the application address `admin@wrmc.au` on the HWQ advertisement. Do not replace one by guessing the other is wrong.
- HWQ’s own publisher phone and Brisbane office address appear in the page header/footer. They must not be mistaken for the clinic’s contact details. Parse the named job body and Practice Contact Details section.
- Exa returned legacy content from [Clarendon `/jobs.html`](https://www.clarendonmed.com/jobs.html), but direct HTTP returned **404**. The [clinic homepage](https://www.clarendonmed.com/) returned 200 and identifies an operating Maryborough VIC practice, published address and reception contact. The recruitment URL is excluded from automatic activation; the clinic itself must not be labelled closed from that 404.
- [Warnervale careers](https://www.warnervaledoctors.com.au/careers/) explicitly encourages IMGs eligible for the Expedited Specialist Pathway; do not turn that into evidence for the Standard pathway/Level 1 candidate.
- Alecto’s PESCI page says it currently cannot assist candidates requiring Level 1 supervision. Search relevance is not suitability.
- Older LinkedIn posts and replies are not current clinic commitments, private-group access, approved supervisors or a replacement for official eligibility sources.

## Parser/integration suggestions

1. Use a fixed allowlist source definition per reviewed URL; do not turn the discovery JSON into arbitrary-URL fetching.
2. Preserve the complete “Level 1-2 supervision” phrase at Wembley. A parser that only recognises `Level 1 supervision` may miss it; a parser that classifies all “Level 2” mentions as exclusion may misclassify it. The quote is an advertisement claim, not regulatory confirmation.
3. Keep network/evergreen pages as `employment_register` and dated named ads as `vacancy`, with unknown live status when there is no verified deadline/current confirmation.
4. Extract contacts from newly retrieved content. The research JSON’s contacts are receipts, not an instruction to send forever to a static address. Prefer application contacts over publisher or generic footer contacts.
5. Store current source observation time, response status, content hash and quoted restrictions. Do not renew an old quote’s research date merely because a checksum matched.
6. No MMM/DPA assignment was inferred from city names, “Metro Role”, rural imagery or network size. Use actual published wording or a separately verified official geographical lookup.
