# Advertisement text screening

`cloud/opportunity-screening.mjs` exports the pure function `screenOpportunity(publicRecord, profileId)`. No provider, AI, private profile, CV, mailbox, database or network is read. It uses bounded `title`, `summary` and `fullText` strings only, with an optional safe HTTPS `url`. Use the existing authenticated profile ID (`amir` or `arash`), not a newly trusted browser identity.

Return contract:

```js
{
 version: 1, profileId, applicable,
 scope: 'advertisement_text_only', eligibility: 'not_assessed', sourceUrl,
 fields: {
  sponsorship: {label, status, excerpts: [{text, status, reason}]},
  img: {label, status, excerpts: [{text, status, reason}]},
  supervision: {label, status, excerpts: [{text, status, reason}]},
  pesci: {label, status, excerpts: [{text, status, reason}]},
  registration: {label, status, excerpts: [{text, status, reason}]}
 },
 limitations: [/* source coverage and interpretation boundaries */]
}
```

Each field status is `supported`, `restricted`, or `not_stated`. `supported` means a narrow explicit advertisement statement was found, not that the applicant qualifies. `restricted` means a stated prerequisite/restriction was found, not that either doctor is personally ineligible. Conflicting negative statements take precedence and are displayed first. Registration eligibility wording such as “eligible for limited registration with AHPRA” is a source criterion, never a finding about a person. PESCI preparation support is not permission to sit, official assessment eligibility, an appropriate position/supervision plan or a guaranteed offer.

Only AU entries whose type is `job` (or missing) are applicable. This is not a clinical-role classifier; review role/title separately. Non-AU and grant/scholarship/university entries remain not applicable. Conditional language, unrelated conference sponsorship, supervision of junior staff, waived prerequisites, bare IMG/PESCI mentions and absence of text never create positive support. Long unpunctuated segments are skipped conservatively. English regex coverage is intentionally narrow; incomplete excerpts, attached position descriptions, reworded text and negation can require manual review.

UI must show the exact source excerpt and an unknown/needs-review state; do not convert these fields to an acceptance percentage, green eligibility verdict or a silent automatic sending trigger. This adds no new source coverage or credential verification and does not alter the source record.

Verification: `node --test tests/cloud_opportunity_screening.mjs` covers positive evidence, negation, conditional offers, unrelated mentions, prerequisites, no personal assessment, non-AU/type scope, ignored private/structured claims, bounds, conflicts after multiple positives and waived requirements.
