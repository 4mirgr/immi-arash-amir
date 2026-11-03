# Original PESCI-style educational practice — 2026-11-03

## Scope and official format evidence

The Medical Board page was actually read on 2026-11-03:
https://www.medicalboard.gov.au/Registration/International-Medical-Graduates/pesci.aspx

It describes PESCI as an objective assessment of knowledge, skills, clinical experience and attributes for a **specific position**, using a structured clinical interview with scenarios. It distinguishes GP applicants on relevant Competent Authority/Standard pathways from specialist assessment routes. A practice case does not establish eligibility, confer registration or substitute for an accredited provider's assessment of the proposed role and supervision.

This library therefore uses open case-presentation prompts and safety/communication reflections, not multiple-choice questions presented as the official format. The four new files are independently authored fictional exercises, not recalled examination content or copied proprietary stations. All carry `official_exam_item: false`, `review_status: requires-qualified-clinician-review`, and `timing.official_timing: false`. The default 600 seconds is a **practice choice**, not a claim about an official station's duration. Reflections are unvalidated educational prompts, not an official marking scheme, pass threshold or prediction of readiness. There is no claim of a complete validated mock examination.

An attempted ACRRM URL `/education/img/pesci` returned a soft-404 page despite HTTP 200. It is excluded as reviewed format evidence. Provider instructions, interview duration, assessment rules and the actual employment position must be checked directly with the selected accredited provider before booking or attempting a purported full mock.

## New cases and actual clinical source review

| Case | Educational focus | Source content read and limits |
|---|---|---|
| PAED-002 | Fever/reduced feeding in a six-week-old infant | RCH **Febrile child**: young age, appearance, feeding/hydration, lower investigation/escalation thresholds and not judging severity by temperature or antipyretic response alone. This exercise does not reproduce inpatient age-specific investigation/admission algorithms. |
| ABDO-003 | Acute abdominal pain and confidential adolescent history | RCH **Abdominal pain – acute**: repeated examination, directed investigation, appropriate analgesia, urgent surgical/gynaecological causes and safe follow-up. Local adolescent consent rules and competence still apply. |
| MH-004 | Suicidal thoughts, immediate safety, escalation and communication | Healthdirect **Warning signs of suicide**: ask directly, remain with a person while help is obtained, emergency response when immediate danger, and ongoing support. This is public safety information, not a complete professional psychiatric assessment guideline; local clinician/crisis protocols and qualified review are required. |
| DM-005 | Possible hypoglycaemia and medication reconciliation | RACGP type 2 diabetes handbook introduction and **Managing glycaemic emergencies**: person-centred goals, education and hypoglycaemia enquiries for insulin/sulfonylurea users; renal/medicine/meal context. No unsupported dose changes, treatment algorithm or driving-licence determination is provided. |

Clinical source URLs actually retrieved and read:

- https://www.rch.org.au/clinicalguide/guideline_index/Febrile_child/
- https://www.rch.org.au/clinicalguide/guideline_index/Abdominal_pain_-_acute/
- https://www.healthdirect.gov.au/warning-signs-of-suicide
- https://www.racgp.org.au/clinical-resources/clinical-guidelines/key-racgp-guidelines/view-all-racgp-guidelines/management-of-type-2-diabetes
- https://www.racgp.org.au/clinical-resources/clinical-guidelines/key-racgp-guidelines/view-all-racgp-guidelines/management-of-type-2-diabetes/managing-glycaemic-emergencies

The initially guessed Healthdirect `/suicidal-thoughts` and `/suicide` URLs returned 404; they are not cited as evidence. A search identified the working warning-signs page, whose actual content was then read. Source HTML/text snapshots are temporary research artifacts outside git; no private patient data was used.

## Practical use and validation boundary

Use one case for a spoken structured presentation, discuss reasoning with an appropriately qualified supervisor, then record reflections separately from the source material. Escalation, scope/supervision, professional interpreting, culturally responsive communication, consent, handover and explicit follow-up are recurrent learning goals. Do not paste real patient identifiers into notes. A self-reported completed practice session is not a credential or automatic CV achievement.

Cases are checked for JSON shape, stable IDs, original-educational flags, nonofficial timing, source URLs and nonempty scenario/prompts/reflections. Those checks establish data integrity only; they do not establish clinical validation or equivalence to PESCI. Future clinical revisions should retain a version trail and record the qualified review status explicitly.

## Additional original variants — same checked source basis

Four further discussion stations extend the source basis reviewed above on 2026-11-03. They are new fictional narratives, not new provider exam claims or a clinical revalidation:

| Case | New learning emphasis | Existing source basis and limitation |
|---|---|---|
| PAED-006 | Older-child fever, uncertainty, language/access barriers and achievable safety-netting | RCH Febrile child; no assumption of viral illness or safe discharge from the vignette, no drug doses. |
| ABDO-007 | Adolescent abdominal pain, sensitive history and possible acute scrotal cause | RCH acute abdominal pain includes testicular torsion among urgent causes. This is not a specialist torsion algorithm or a claim about a safe delay window. |
| DM-008 | Newly diagnosed type 2 diabetes, shared priorities, health literacy and multidisciplinary care | RACGP handbook introduction and its person-centred/education principles. No universal glycaemic target, medication regimen or diet is supplied. |
| MH-009 | Current safety after a crisis, incomplete handover and practical continuity | Healthdirect warning-signs/direct asking/help/follow-up principles. Public safety guidance is not a complete professional post-discharge psychiatric protocol; local clinical pathways and qualified review remain essential. |

The added library integrity tests verify stable IDs, complete educational metadata, provenance and preservation of nonofficial timing/review flags. They do not clinically validate the cases. All nine library records remain unvalidated educational exercises. The API's explicit case imports must be updated by its owner before newly added records are exposed in the panel.
