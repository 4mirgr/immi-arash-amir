# First-party GP source expansion — 11 November 2026

Two employer pages were read directly with the collector user agent, checked against robots rules, parsed with the production adapter, and added to the fixed source rotation. No private spreadsheet contact was promoted and no application was sent.

| Employer / page | Direct / collector GET | Robots | Parsed current content | Important limits |
|---|---|---|---|---|
| [Northern Midlands Medical Services](https://longfordmedical.com.au/careers/) | 200 / 200 | Allowed, no delay | Named GP recruitment under “Current Vacancies”, full/part-time work, teaching experience with IMGs, published practice-manager contact | No current publication date or closing date was established. The resulting edition has unknown status, not confirmed open. Level 1, PESCI support, visa sponsorship, MMM and DPA remain unconfirmed. Longford and Perth are practice locations, not two independently confirmed vacancies. |
| [Yarriambiack Medical Clinic](https://yarriambiackmedicalclinic.com/) | 200 / 200 | robots.txt returned404 | Employer invites GP applications including IMGs; public manager/general contacts are extracted from current markup | Evergreen employment enquiry, not a dated vacancy. No explicit Level 1, PESCI, visa, MMM or DPA commitment. Encoded public contact markup is decoded by the existing extractor; no JavaScript is executed. |

The generic reviewed-page adapter now recognises explicit “looking for General Practitioners/GPs” hiring language on its fixed registered pages. It still rejects an ordinary clinical services page or hiring for allied-health staff alone. Hidden hiring text does not make a page eligible. The source's configured enquiry/vacancy kind is preserved, and dates are never guessed from page metadata or the current read date.

Other pages inspected but not added in this small expansion: [Standish Street Surgery](https://standishstreetsurgery.com.au/careers/) advertises accepting Level2IMG and requires a three-second publisher crawl delay; [The Village Medical Practice](https://www.village-medical.com.au/join-us/sponsored-gp/) describes specialist pathways, so supervision language is not evidence of initial AMC/PESCI/Level1 suitability. Neither was presented as a suitable Level1 vacancy.

Verification: ten targeted synthetic adapter/collector tests passed, including robots refusal, current-text contact extraction, no inferred vacancy/date, negative requirements and hidden-text rejection. Direct page reads establish the content available from this execution environment; the next deployed collector run must record its own runtime receipt. Runtime 403, expiry or content changes remain visible failures rather than successful coverage.
