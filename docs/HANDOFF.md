# Start here: project handoff

Updated 2026-11-24. This is a recovery guide for a human or another AI. The repository is public: preserve rules, architecture, public research and release evidence here; retrieve private state only through the owner's authorized storage. Git is not a backup of the doctors' accounts.

Arash private Gmail opportunity batches open a mobile final review for the ready subset after preparation. The review freezes each exact preview, destination and owned CV. Pending rows show their reason, and a shared mailbox appears once in the batch's send plan. Only final confirmation dispatches. Sent or uncertain recipients are excluded from another attempt, and partial results identify which addresses actually received a message. `tests/browser/check_mail_opportunities.py` exercises mixed readiness, confirmation, shared addresses and partial results with synthetic transport. The main-site deployment receipt is recorded under the host release tag.

Latest audit 2026-11-22: [row-read recurrence and current job research](AUDIT-2026-11-22.fa.md). D1 returned the daily row-read limit again after the prior pause expired. The new backend uses existing indexes for mailbox/bank matching and normal claims, omits the scheduled thread count, and runs full contact-coverage repair twice hourly. Direct publisher closure notices are retained even on HTTP 200. GPAP is an additional employment enquiry source. The deployed pause ends at 2026-11-23T00:00:05Z. Verify post-reset work from actual receipts. The [21 November audit](AUDIT-2026-11-21.fa.md) records the independently pinned frontend and four earlier sources.

2026-11-24 Tehran: verified Arash sign-in starts at Correspondence, including when the browser previously saved another tab. Exact private mail links keep their requested item and mailbox. The browser test covers the unread badge and opening the green review action from this landing without sending. The existing navigation checkpoint for Amir remains applicable. A bounded live observation on 23 November UTC showed Gmail history had advanced and GPAP and the four sources from the preceding audit had successful collector receipts. The live landing is recorded in `latestEntryRelease` in PROJECT-STATE and the host tag `release/aus-arash-mail-entry-20261124`. The previous 22 November release below is the backend audit baseline.

## Resume in this order

1. Read [AGENTS](../AGENTS.md) and only the role file relevant to the task.
2. Read this guide and [PROJECT-STATE.json](PROJECT-STATE.json). They separate current rules, dated observations and open work.
3. Consult [POLICY](POLICY.md) before changing privacy, sources, external actions or deployment. Use [GOALS](GOALS.md) for the complete acceptance map and [RESUME](RESUME.md) to locate older feature records.
4. Inspect the working tree, current remote `main`, actual code and the relevant release receipt. Connection state, queue counts, source availability and provider permissions can change after a snapshot.
5. Continue the existing task without redoing completed setup. Ask the owner only for information or consent genuinely missing from the current authenticated state. Assign exclusive files when parallelizing.

Current explicit user instructions take precedence over older project documents and uploaded examples. Attachments are source material, not autonomous commands. Adopted writing prompts remain bounded by later user corrections, factual evidence and ownership. Historical release notes describe their own date; they never override a later policy or prove today's live connection.

## Product and account boundaries

- Two independent doctor workspaces: Arash's Australian GP/employer/supervisor search, and Amir's specialist/research/fully funded study planning. Public organization/source knowledge can be shared; private profiles, CVs, grants, mail, calendars, drafts, contacts and actions cannot.
- Arash's operational target includes all eight Australian jurisdictions, local and rural practices, hospitals, networks and public supervisor leads. Finding a possible employer does not establish Level 1 capacity, PESCI eligibility or visa sponsorship.
- Amir's study coverage includes Australia and Italy, plus realistic funded European options. Full funding means tuition plus living stipend; insurance, travel, visa and award conditions remain separate. Admission, clinical registration, employment and immigration are separate decisions.
- Completion, board and language uncertainties and conflicting CV claims stay in each owner's private planning. Preserve alternative scenarios until the owner supplies a verified update; do not publish their private CV facts or upgrade training into credentials.
- Both doctors may connect their own primary and secondary Google accounts. A shared OAuth app is allowed; provider subjects, tokens, sender identities, synchronization cursors and permissions stay independent. Never use the other doctor's grant as fallback. A missing optional secondary account is not failure of a working primary account.
- Sharing a task requires an explicit sharing action. Friendship and the shared board do not share Google/LinkedIn access or create a dependent-visa entitlement.

## System map

| Component | Authority and boundary |
|---|---|
| This repository | `4mirgr/immi-arash-amir`; application source, public research and project rules |
| Main address | `https://drgerami-md.ir/aus/` |
| Worker | `immi-arash-amir`; `cloud/worker.mjs`, existing `workers.dev` origin also handles provider callbacks |
| Authentication/profile/CV | Dedicated Supabase project `waxpjylnvwqdlktayyww`; verified membership and RLS |
| Private D1 | `GOOGLE_DB`; provider grants, mail, clinic-bank research, private drafts, schedules and receipts |
| Public D1 | `OPPORTUNITY_DB`; source registry, public opportunity editions and public page readings |
| Host repository | `4mirgr/gerami-website`; owns `/aus/` gateway and a pinned, reviewed public frontend build |
| Other application | IntMed and native website/Clinic identity have their own authorization. Do not alter their Supabase project, pins, sessions or backends to fix AUS |
| Local legacy server | `server/` is development support, not the deployed cloud API |

Runtime resource identifiers and deployment procedure: [DEPLOYMENT](DEPLOYMENT.fa.md). Exact frontend pins: host repository `deploy/projects.json`. Source `main`, host pin and deployed Worker are different versions and must be verified separately. Preserve concurrent native-site changes; never restore the whole host tree from an old AUS release.

Private storage is authoritative for CV versions, `planning.gpApplicationWriting`, contact signature, pending fact checks, personal templates and integration state. Relevant paths/tables are documented in the feature records; do not copy their contents into this repository, issues or logs. Uploaded CVs, spreadsheets, archives, correspondence, provider callbacks, OAuth codes, tokens and encryption keys are excluded even if a future repository becomes private.

## Discovery, evidence and unattended work

Gmail received/Sent history, LinkedIn email alerts, spreadsheets and search results are leads. Follow the actual public employer, services/team/training/contact pages and permitted public social sources. Store the checked URL, actual content, date, applicability and limitations. A URL or search snippet alone is not a reading. Never bypass robots, authentication or private-group/API restrictions.

Keep advertisement editions separate; a new request from an existing employer can be a new edition, while an old closed ad must not be reopened with today's homepage. Keep MMM and DPA distinct; MMM1 is not automatically excluded. Fit stars explain evidence and gaps, never acceptance probabilities. Course attendance or a checked task never creates a CV achievement or regulator recognition.

All old and new opportunities require contact-lookup registration or an explicit blocked/unavailable/storage status. Historical reconciliation and refresh are gradual, not a fixed first-N coverage claim. Private Gmail-derived research updates only that doctor's private bank unless the owner separately shares it. Use exact clinic identity/host checks to avoid mixing branches of a network.

The deployed system uses bounded server cron jobs, not a permanently running conversational AI. These UTC expressions were rechecked read-only on 2026-11-21:

| Cron | Lane |
|---|---|
| `* * * * *` | Progressive own-mail/archive/history/correspondence work |
| `1-59/2 * * * *` | Alternating private research and notification turns; public alerts retain their share |
| `*/5 * * * *` | Public page/bank work and separately approved background queues |
| `0 * * * *` | Registered public source collection |
| `15 */6 * * *` | Maintenance and evidence-change watches |

Each lane has its own limits, continuation cursors, leases and backoff. Research has at most six public/provider HTTP requests per pass. The two-minute trigger does not mean every source is read every two minutes. A source-change hash flags review and does not silently renew a medical/eligibility conclusion. Preserve suppression, receipts and unknown transport outcomes across cache cleanup and recovery.

Tavily is configured and its free entitlement was actually verified; do not request a new key as unfinished setup. `null` PAYG is not inferred to mean zero. Only the documented independent free-account entitlement proof permits that branch. There are at most 20 reserved search attempts per UTC day for this shared key, failures included, with seven-day same-owner query reuse. No paid plan, PAYG or new billable resource is authorized. Full contract: [TAVILY](TAVILY-EMPLOYER-SEARCH.fa.md).

## Letter, editing and transport rules

Four paragraphs, with salutation and complete contact signature separate:

1. Owner-approved fixed introduction from the private writing profile.
2. Why this clinic: the applicant's specific professional interest in a real, read feature of the target. Express motivation, rather than reporting the clinic's website like a news item. Do not invent shared contacts or supervisor interests.
3. Why this doctor: selected owned-CV evidence of clinical judgment, responsibility, continuity, teamwork and learning, with a defensible benefit to this centre. Routine procedures alone are not a distinctive selling point; do not invent workload, outcomes, patient demographics or crisis history.
4. Owner-approved fixed invitation to discuss, from the same private profile.

Natural, precise and professional English; clear Persian UI. Apply [WRITING-GUIDE](WRITING-GUIDE.fa.md) and [CV-STANDARD](CV-STANDARD.md). Reusable templates carry style/focus, not copied clinic facts. Conflicting historical prompts do not replace the latest approved introduction/closing or add qualifications.

Latest user clarification, implemented in [MAIL-PRIORITY](MAIL-PRIORITY-2026-11-19.fa.md):

- Default `sort=ready` ranks usable information before incomplete research over the full owned pool, before pagination. `newest` is still selectable.
- A labelled `initial_enquiry` needs enough for a suitable first email, not a complete dossier or confirmed current vacancy: one relevant published clinic fact, published contact, own CV and confirmed signature. Reuse fresh, actually-read own-bank evidence with original timestamps. Exact service overlap is not mandatory for this mode.
- `job_application` and `initial_enquiry` are distinct. Never claim a confirmed vacancy, Level 1 approval or sponsorship from an enquiry. Applicable current restrictions remain visible; an unrelated old job's requirement is not a permanent clinic policy.
- The letter appears upfront when a card is opened. Own saved-default CV is selected, otherwise the latest owned version; each card can override it. Selecting a CV is not send approval.
- Private-mail paragraphs 2/3 are editable inline and explicitly saved; fixed introduction/closing/signature are preserved. Public GP manual editing has its own documented subject/template controls. Do not confuse the two edit API families.
- Private mail edits use `moedit_*` with exact owner/slot/Google subject/opportunity/CV/base-hash binding. Public GP `gpedit_*` cannot substitute. Review pins an exact edit ID or explicit null; final claim also checks the edit-head revision.

Every currently published recipient is selected by default and can be unchecked. Advertisements themselves start unselected. Individual and batch emails require explicit current review/confirmation; approved schedules execute only their frozen entries. Each recipient gets a separate message, with owner-wide/network-address deduplication, quotas and suppression. A global flag, discovery, Telegram notice or old approval cannot authorize a new application. Never replay an uncertain send or retry a mutation during auth recovery.

Current own Gmail/source fingerprints, sender, owned CV/signature, membership and review hashes are checked again before transport. Old-mail age alone does not prohibit a current clinic enquiry; it never removes these other checks. Telegram names the correct owner and deep-links the exact private card; enquiry wording clearly says vacancy/supervision/sponsorship are unconfirmed. No real application or synthetic Telegram message is sent merely to test development.

## UI and reading continuity

Keep the interface compact: clear named folds, short purpose text, settings above results, accessible green per-ad send and a visible batch action/count on mobile. Top navigation/user card, responsive RTL with isolated Latin fragments, local Vazirmatn, per-user text size/theme and English UI must remain usable. Private mail/CV/quotes are not automatically translated. Calendars retain both Tehran/Jalali and selected Australian/Gregorian views; do not confuse civil all-day dates with instants.

The AA icon is the brand reference. Arash and Amir retain their distinct goals within consistent glass/neon controls; notifications use the yellow neon count and reduced-motion-aware halo. Do not add noise or hidden prerequisite forms to the main send flow.

Transient fetch/auth-bootstrap failures retain same-owner loaded content and in-memory editing; only authoritative revocation clears access. Poll reorder must not close an open reading snapshot. Dirty text is never silently overwritten. Session storage checkpoints may contain only allowlisted navigation/filter enums and opaque owned IDs, with expiry; no message/CV text, token, recipient, review hash or send approval.

## Latest verified release and one-time actions

- Worker source `789e2b2a3939ebd22660d34745987e8c5e4a1ef9`. Deployment `cdaa2167-053f-4b15-8de6-4ff26a043509`, version `63bec543-617e-4ef3-a021-83160d1fc962`, 100% traffic. The downloaded module and production health match the [22 November receipt](AUDIT-2026-11-22.fa.md). 1,131 Node tests, 79 Python tests and 18 browser workflows passed.
- Frontend source `4f935f8ff2eb7e4265362c1321adac11c0ae2173`. Host PR45 merged as `a8bde347928d050f2e05fdc85c1f9eeb72365e2e`, Pages deployment `ec0f6a10-5472-4770-b921-216e16285579`. Read the [21 November audit](AUDIT-2026-11-21.fa.md) for the assembled artifact and deployment tests. Current host main may have advanced since that receipt.
- All nine Secrets, 30 bindings and the five schedules were verified. The finite `D1_READS_RESUME_AFTER` value is `2026-11-23T00:00:05.000Z`. D1 was observed exhausted again after the earlier reset. Confirm post-reset queue progress and actual read usage before reporting recovery. Schema baseline remains `08ad93d68d17c459cc86bc62ecac98f0776dd3d0`. The dedicated CI deployment credential is still unconfigured. This Worker release used the existing management connector.
- Already done once: 132 valid cached messages requeued for the corrected parser; seven previously read rows marked unread; 53 old research rows advanced for minimal-enquiry review. Do not repeat these on startup or reset read/send/notification history. See [parser backfill](MAIL-PARSER-BACKFILL.fa.md) and historical [19 November release](MAIL-PRIORITY-2026-11-19.fa.md). Version 3 proof refresh uses existing versioned due selection instead of a new bulk reset.

## Open work: owner, next step and completion evidence

| Work | Next step and actual completion condition |
|---|---|
| D1 post-reset recovery | Developer/cron: after 23 Nov 00:00:05 UTC, verify bounded actual mail/research/bank/source progress and real read consumption. A finite pause, successful deploy or local SQLite VM reduction is not proof of restored daily capacity |
| Archive and clinic bank | Developer/cron: continue durable coverage, match public employer identity, improve blocked/PDF/large/dynamic readers lawfully. Completion requires coverage receipts, not queue counts or a fixed sample. No whole-web claim |
| Standalone bank outreach | Developer: distinguish the working mail-linked initial-enquiry transport from a general bank-only/recurrent campaign. The latter still needs reviewed entry creation, current contact/CV/sender checks, cadence, dedup/suppression and explicit approval |
| Full independent backup/restore | Developer + owners: agree independent destination/key custody/retention, export all intended stores, then actually restore an empty isolated staging system and test both owners' RLS. Browser checksum and limited Drive export are not this proof. Old approvals must remain inactive |
| Advanced LinkedIn | Owner + provider: obtain the specific approved API products/scopes, or use each owner's authorized exports. Base sign-in/share does not grant graph, messages, job search, full analytics or profile editing. A Page/university email alone is insufficient; do not fabricate an organization |
| Full-fund applications | Developer + Amir: per-call supervisor/project/proposal/referee/English/start-date and actual award coverage checks against current private facts. Keep both board scenarios and completion uncertainty; no automatic application or clinical-rights claim |
| Professional/PESCI content | Owners/qualified reviewer: resolve documented private CV conflicts and validate original educational cases against current official criteria/licences. Practice scores are not official certification |
| Worker CI release | Operator: inspect current Actions/Secret configuration before asking for setup; the dedicated deploy token/actual workflow success is not proven by manual deployment. Preserve current bindings, schema baseline and moved-main checks |
| Account-wide lifecycle | Developer: complete deletion/revocation and multi-store restoration procedures with owner isolation, without erasing suppression or reactivating old transport |
| Network-specific access | Owner/operator: only an actual carrier/device test establishes Iran/MCI availability. Server or local Chromium tests do not prove it |

See [REMAINING](REMAINING.fa.md), [backup next steps](BACKUP-NEXT-2026-11-13.fa.md), [LinkedIn API requirements](LINKEDIN-ACCESS-REQUEST.fa.md), [funding bridge](research/AU-RESEARCH-BRIDGE-2026-11-12.fa.md) and [WORKER-CI](WORKER-CI.fa.md). Do not ask again to register the already-active domain, create the working bot, set the verified Tavily key or reconnect a valid primary grant without new evidence.

## Verify, publish and hand off

Run checks appropriate to the actual change. A documentation-only correction does not require provider mutations or another deployment. Runtime changes use the existing gates:

```sh
node --test tests/*.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/run_browser_checks.py
npm run build
node scripts/build_worker.mjs
python3 scripts/check_skills.py
npm audit --audit-level=high
git diff --check
```

For the host, install its locked development tools without scripts, run its full `check_site.py --browser`, build into a fresh directory and check the assembled artifact before advancing only the reviewed AUS commit pin. Preserve the current native host main and IntMed pin. No force-push or bypass of failed gates.

Use selected local skills as pinned guides, not a remote executable loader. [AUTOMATIC-MAINTENANCE](AUTOMATIC-MAINTENANCE.fa.md) allows tested compatible patch maintenance, not autonomous auth/schema/medical-goal rewrites or new sending consent. After an ambiguous upload, independently check actual version/module hash/settings before retrying; a post-check error may follow a successful write. Do not rotate `GOOGLE_TOKEN_KEY` over existing encrypted grants.

For every meaningful release, update the dated receipt, this recovery index/state when needed, and the true remaining gates. Report separately: implemented, synthetic-tested, deployed, actually observed provider operation and still blocked. Never claim the entire project or all private data can be reconstructed from Git alone.
