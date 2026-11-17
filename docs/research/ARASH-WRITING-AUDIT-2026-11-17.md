# Arash letter and application audit — 2026-11-17

Scope: current four-paragraph GP application contract, the privately supplied Hands of AI prompt, clinic/CV evidence matching, optional AI editing and source-bound preview/queue. The newer explicit owner requirements for fixed P1/P4 and all selected published recipients remain authoritative. No private CV, contact information or uploaded prompt is included here.

## Concrete defects corrected

1. **Mixed verb tenses in P3.** A bullet such as “Managed chronic diseases and diabetes, provided preventive care and coordinated referrals” previously became “experience managing …, provided … and coordinated …”. Coordinated past-tense clauses now remain a complete first-person sentence: “I have managed …, provided … and coordinated …”. Subordinate qualifications and negations are preserved rather than independently rewriting every verb. Regression cases include conducted research, trained staff and taught clinical skills.
2. **Clinic quantities becoming applicant experience.** The AI draft checker previously pooled numbers from clinic and CV facts. P2 now checks clinic quantities; P3 checks CV quantities. An exact clinic-name mention may be removed before checking P3 so a business such as “Clinic 40” can be named without allowing an invented “40 years” of experience.
3. **Coursework/research becoming clinical work.** AI editing fails before quota reservation for explicitly limited, training-only or research-only selected CV facts. The deterministic draft remains available. Each CV candidate now exposes its own `cvScope` for accurate UI guidance before generation. Explicit clinical care followed by a separate training/research action remains clinical context, while “managed wound care training” and “managed chronic disease research projects” do not establish performed treatment. Only clinically attributed clauses contribute to the performed-service overlap.
4. **Substring replacement changing fixed paragraphs.** AI editing now replaces only the canonical P2/P3 blocks. Repeated text in P1/P4 or the signature cannot cause those fixed blocks to be edited accidentally.
5. **Repeated work per recipient.** The mail router already read the current edition, public enrichment and owned CV, but package construction read them again. A fifth, server-only verified snapshot argument now reuses those reads. Owner, profile, edition, source URL/observation, CV and country/type scope are checked. No public request field can populate the snapshot. Every new preview, queue or schedule still begins with fresh reads and current review-hash checks.
6. **Repeated matching analysis.** Clinic/CV summaries are computed once per candidate before the bounded pair matrix. A 24×24 synthetic Node workload over 20 warm runs averaged approximately 22.6 ms before and 1.9 ms after this change. This is an algorithmic/synthetic measurement, not a production response-time guarantee. The regression verifies 48 input-fact reads and deterministic selection, without a timing threshold.

## Linked clinic evidence now reaches the letter

Public reader output supplies a separate server-validated `clinicEvidence` corpus. Package construction never trusts that property from imported opportunity JSON or browser input. Current same-site child service/training/team/recruitment facts require the actual parent page ID and reading timestamp, a successful root reading, a current child reading no earlier than the parent, and bounded age. The upstream store also enforces the advertisement edition boundary and source/content receipt agreement.

The root retains up to 24 statement candidates; up to 12 validated child statements can be added. The selected child quote keeps its own URL/read time in candidates, composer fact basis and provenance. It is never attributed to the advertisement URL merely because the link came from that advertisement. Selection proof enters the mail review hash. The verified child corpus is also passed to the scheduler's source digest so later source drift cannot silently retain an unattended approval.

## Synthetic editorial evaluation

- Chronic disease/diabetes/prevention clinic: P2 identifies the published service mix; P3 preserves the applicant's actual coordinated experience before explaining the service contribution. The evaluated fallback was 32 and 59 words respectively.
- Treatment-room clinic: P2 describes the actual wound-care/minor-procedure setting; P3 links only the specifically shared clinical skills. A wound-care statement does not establish all minor surgical competence.
- Training-only CV excerpt: its course status remains explicit; it cannot be sent to the AI editor as proof of performed care.
- Negative/qualified CV excerpt: “I have not performed suturing without supervision” remains a limitation and is not converted into affirmative independent procedural experience.

The fallback uses reusable grammatical structures with different factual service content. It is not unlimited bespoke generative writing. Optional AI output still requires owner review; number/name checks and scope gates are basic safeguards, not semantic credential verification or a prediction of employer acceptance. The AI context contract was advanced to `gp-academic-evidence-v2`; prior cached artifacts are not silently represented as this version.

## Verification and limits

88 targeted Node tests passed across composer, package, AI editor, opportunity mail, clinic enquiry, linked evidence and mail scheduler. Syntax checks passed for all four edited writing/mail modules; `git diff --check` passed. The integration checks cover child source → package → preview → one private queue, child receipt drift, foreign/stale child rejection, trusted-snapshot mismatch and public-field injection, source/CV/identity drift, complete signatures and explicit consent. Provider transport in these checks was synthetic; no real application was sent, no production data/schema was changed, and this subtask did not deploy or commit.
