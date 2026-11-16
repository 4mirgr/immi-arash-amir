# Arash application workflow repair Implementation Plan

> **For agentic workers:** Use the existing explicitly authorized parallel-agent method, with exclusive ownership and integration review. Execution was already authorized in this session; do not add a new approval stop.

**Goal:** Repair Arash's reported connections and make single/bulk email actions obvious while producing evidence-specific, four-paragraph professional applications with a complete contact signature.

**Architecture:** Preserve verified-owner authentication and independent Google/Telegram grants. Improve existing opportunity/bank evidence and mail-composer interfaces rather than create a competing sender. Source inspection remains bounded and source statements remain distinct from owner CV evidence.

**Tech Stack:** React/Vite, Cloudflare Workers/D1, Supabase Auth/RLS, existing Workers AI with quotas where appropriate; no new paid services.

**Spec:** User report2026-11-16 + attached Hands of AI.docx read outside Git; latest four-paragraph and multi-recipient instructions take precedence over conflicting examples. No private contact/CV data in Git.

## Global Constraints
- No real emails/posts/invitations sent as tests; explicit per-item/batch transport approval and sender/CV/evidence pinning remain.
- Separate both doctors' Google/Calendar/Telegram accounts; storedconnected is not fresh provider verification.
- P1 and P4 use the owner's confirmed current text. P2 explains this clinic choice from cited public facts. P3 explains a concrete CV-backed contribution matched to those facts. Signature requires verified own contact details; never substitute another owner's details.
- No invented clinic patient statistics, crises, relationships, supervision, sponsorship, credentials or acceptance probabilities. MMM/DPA remain verified/informational, not inferred from suburb or each other.
- English UI, PersianRTL, mobile reachability, same-owner form continuity and existing free-tier request budgets preserved.

Implementation review complete; final live diagnosis and deployment receipts are recorded in docs/ARASH-REPAIR-2026-11-16.fa.md.

## Review Focus
- Expired/revoked grants vs transient connection-status failures: only authoritative terminal failures mark disconnected; calendar missing-scope is separate.
- A visible Send control must remain visible when unready, explain precisely why and navigate to required setup; no silent disappearance or disabled-without-reason state.
- Sparse public evidence must not create generic flattering prose, fabricated service data or unsupported claims.
- Missing/changed signature must block ready-for-send status; private contacts stay out of public bundle.
- Different clinics must produce different supported reasoning, not swapped clinic names over stock paragraphs; source/CV drift still invalidates approvals.

---

### Task1: Provider diagnosis and recovery
**Files:** cloud/google-oauth.mjs, relevant Google/Telegram status modules and tests; root owns live reads/worker integration.
**Interfaces:** existing /api/google/status and Calendar/Telegram capability status; return actionable safe codes, not tokens.
- [x] Reproduce reported disconnect from live metadata and code/browser behavior; distinguish grant expiry, missing scopes, identity mismatch, host/state and transient errors.
- [x] Implement compatible corrections with negative owner/expiry/scope tests.
- [x] Verify existing consent remains owner-bound; document only the manual steps actually necessary.

### Task2: Simple single and bulk application controls
**Files:** src/job-opportunities-panel.jsx, opportunity-mail/bulk-mail components, Arash navigation/workspace styles and focused browser tests.
**Interfaces:** existing callbacks to open inline composer and existing reviewed dispatch/scheduler; preserve recipient selection and approvals.
- [x] Reproduce button reachability on mobile/desktop for ready/unready/missing-email cases.
- [x] Put an obvious Send email action on every card and a persistent selected-count bulk action; show setup/readiness beside visible final Send.
- [x] Test single/bulk flow, mobile reflow, English labels, sender changes and preservation of unsubmitted drafts.

### Task3: Professional grounded paragraph composition and signature
**Files:** cloud/gp-letter-composer.mjs, gp application package/mail preparation modules and tests; coordinate new interface with UI/evidence owners.
**Interfaces:** existing composer output + exact clinic/CV evidence, paragraph and signature readiness metadata. Optional AI must preserve quotes, fixedP1/P4 and own-contact fields; no public-storage private CV.
- [x] Add regressions for weak/repeated prose, unsupported statistics, missing contact signature and conflicting attached template examples.
- [x] Compose clinic-specificP2 and contributionP3 with source-to-CV reasoning; vary only supported emphasis and wording.
- [x] Require a complete own-name/email/phone signature; preserve review/transport hashes and both-owner isolation.

### Task4: Richer bounded clinic evidence and processing progress
**Files:** clinic-bank/public enrichment reader and new focused helpers/tests; do not increase global5cron or request budget without measured evidence.
**Interfaces:** public clinic facts retain exact quotes, sourceURL, readAt and unknown categories. Existing bank/enquiry and mail consume reviewed facts without promoting leads to live ads.
- [x] Diagnose current throughput/backlog and discarded evidence; do not merely raise quota.
- [x] Reuse already fetched content and bounded relevant pages to retain service/team/recruitment context even when an email exists; label unavailable statistics/weakness/crisis records unknown.
- [x] Verify old/new rows enter normal refresh/upgrade path and report actual throughput honestly.

### Task5: Integrate, verify and publish
**Files:** root-owned router/catalog/docs/deployment only after agent interfaces stabilize.
- [x] Run focused tests, full Node/Python, language/mobile/actual composer browser workflows and public builds.
- [x] Deploy preserving8secret bindings,5crons and data; update only AUS pin in the separate website host after its gates.
- [x] Verify main-domain assets/private boundary; report actual connection findings and exact owner-consent actions. No claim that every clinic was fully researched or real email sent.
