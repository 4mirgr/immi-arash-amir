# Canonical goals and acceptance map

User mandate: two independent doctor workspaces, shared public clinic/opportunity knowledge, fastest realistic Australia migration progress; free plans first, parallel agents with exclusive files, short role-specific context. Persian RTL, distinct GP/PESCI versus internal-medicine/research objectives. Eventual .ir domain, measured Iran accessibility and legitimate server-side routing; no guarantee of third-party availability.

| Area | Goal | Current implementation / remaining boundary |
|---|---|---|
| Identity/privacy | Independent login, profile, CV, Google, LinkedIn, correspondence, preferences and actions | Supabase verified memberships/RLS + owner-scoped D1; unique provider identity; refresh/logout race guarded; shared public data only |
| CV | Versions, named templates, default/download; evidence-based suggestions | Immutable TXT/DOCX snapshots/defaults; private profile planning. Automatic achievement verification/insertion not active |
| Google | Separate Gmail reading/ranking/replies/attachments, Drive, Calendar per doctor | OAuth/adapters/owner queue implemented; both Google connections confirmed. Scope-specific operations need actual verification; no shared sender fallback |
| Sending | User prefers automatic default-template policy; alternative approval+Telegram | Preference stored; sending controls/explicit queue implemented. Unattended auto-send and Telegram not enabled; suppression/idempotency/quotas/authorization prerequisites remain |
| Discovery | All AU jurisdictions, clinic/hospital/university/supervisor leads; trust/type/geography filters; edition history | Four executable public feeds; other jurisdiction/unofficial sources are reference-only. 10-second UI reads are cache polling, not external crawler frequency. Missing data stays unknown; no acceptance percentages |
| Eligibility | Read official criteria, compare current own facts, explain gaps and practical improvements | Reviewed pathway evidence + private conditional planning/action status; board/completion/language uncertainties retained in private planning. Final assessment/visa decisions belong to authorities |
| Study | Amir: Australia/Italy + realistic funded Europe research options | Dedicated own study tab and reviewed funding/admission evidence; portals/past calls not advertised as live guaranteed scholarships. Research admission is separate from clinical registration |
| Development | Relevant Iranian university/CME/Jihad/private medical congresses and courses | Reviewed learning/event evidence + concrete skill outputs; source limitations explicit. No automatic enrolment, purchase or assumed international recognition |
| LinkedIn | Independent profiles, improvement suggestions, networking, content/images/scheduling, analytics | Private drafts/cards/CSV contacts/manual metrics/manual calendar. Optional direct text API publication code requires provider app/consent. Live analytics, graph sync, profile editing, unattended publishing are not active |
| PESCI | Officially grounded case presentation/mock/library/read-aloud/speed/timing/feedback | Educational original station/player exists. Full validated examination simulator and ongoing licensed question-source pipeline remain incomplete |
| Automation/AI | Coordinated, cheap, reliable background enrichment | Actual bounded CF cron collectors/source-change receipts; no perpetual AI inference service configured or invented 24/7 conversational agents |
| UI | Professional, readable and interactive, AA canonical logo | Responsive RTL; per-profile browser font-size control; dedicated analysis, study, development tabs |
| Recovery | GitHub as canonical source for later agents | AGENTS + role files + POLICY + this map + RESUME + source/date/evidence notes. Private CVs, credentials and mail excluded from git |

## Research and recommendation rules

- A source link alone is not a review. Record checked date, actual content, applicability, limitations and next action. Separate source requirements, user-reported facts, missing evidence and conditional conclusions.
- Distinguish eligibility, competitiveness, employment, registration, assessment and visa. Do not infer formal training-year credit from an informal supervisor offer.
- Prefer skills with demonstrable outputs (supervised case log, anonymized audit, ethical protocol, analysis/report) over collecting certificates. Suggest specific Iranian employment only when there is a verified vacancy and the user's license/university permissions permit it.
- Courses/events may improve evidence but cannot replace statutory criteria; attendance/checkboxes never create CV achievements. A page-check hash change flags review and does not renew the original research date.
- Private pending training completion, board outcomes, language scores and user's future answers stay in own `planning`; unknown facts stay unknown until updated by the owner.
