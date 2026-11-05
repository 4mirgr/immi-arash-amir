# Resume this project with minimal context

Public page reading/extraction: read docs/CONTENT-PIPELINE.fa.md selectively. Dedicated public-page schema and queue/content/profile evidence live ONLY in OPPORTUNITY_DB. Discovered links are not evidence until content is actually retrieved. Runtime HTML/text reader is bounded; PDF ingestion uses the separate offline reader. Keep partial/blocked/archived/eligibility uncertainty visible and never apply a later page reading to an earlier publication edition.

1. Read `AGENTS.md`, then only your role file under `docs/agents/`.
2. Read `docs/GOALS.md` for requirements/status and `docs/STATUS.fa.md` for delivery notes. Consult `docs/POLICY.md` before privacy, source, external-action or deployment changes.
3. Confirm `git status`, current commit and recent CI. Do not restart completed work or assume old deployment notes describe today's runtime.
4. Runtime: React/Vite UI; authenticated Cloudflare Worker `cloud/worker.mjs`; dedicated Supabase Auth/Postgres with RLS; two D1 bindings. `server/` is local legacy development and is NOT the cloud API.
5. Person identity comes only from verified Supabase membership. No browser profile selector grants access. Google and LinkedIn each have independent owner identity/tokens/mail/tasks; NEVER borrow a grant across users. Read `docs/GOOGLE.md`, `docs/LINKEDIN-CONNECT.md` only when changing those integrations.
6. Public evidence: `cloud/{eligibility,study,development}-evidence.json` + `docs/research/`. Public opportunities: registry/collectors/store. Read `docs/SOURCE-COVERAGE.md` and `docs/OPPORTUNITIES-V2.md` for those changes. Availability checks are not automatic new research.
7. Private planning/CVs/mail live in authenticated storage, not this repository. `private/`, attachments and scratch paths are disposable, ignored evidence/backup material. Retrieve current facts only through authorized owner-scoped access. Never turn historical CV wording or an action checkbox into a verified achievement.
8. Current cloud IDs and site URL are in `docs/DEPLOYMENT.fa.md`; Google D1 `faf37526-9c8c-4a86-9f91-3ab41ee8ddff`, public opportunity D1 `a9605bec-79b7-430d-8d15-cfacb4cb1a58`. Dedicated Supabase `waxpjylnvwqdlktayyww`; NEVER modify unrelated intMed project `upwbktvnybsjugdegjji`.
9. Schema locations: `cloud/*schema.sql`; private roadmap schema goes in GOOGLE_DB, evidence-watch schema in OPPORTUNITY_DB. Additive `CREATE IF NOT EXISTS` migrations; no resetting tables. Existing secret bindings must survive deployment, especially GOOGLE_TOKEN_KEY (rotating it makes stored grants unreadable).
10. Verify `npm run build`, `node --test tests/cloud*.mjs`, `python -m unittest discover -s tests -q`, `node scripts/build_worker.mjs`. Deploy public bundled assets only; preserve secret_text bindings. Confirm health/public assets/401 barriers and report what was actually tested. Never expose OAuth callbacks, auth codes, CV text or secret values in output.

The repository preserves architecture, public research and decisions; it does not recreate private accounts or credentials. Restoring private state requires the owner's authorized database/backups. No claim of uninterrupted background AI agents: real cron collectors/watchers are bounded scheduled jobs.

Recent integration notes: google-account-scope.mjs validates Amir-only secondary mailbox selection; GOOGLE_SECONDARY_EMAIL is a server-only configured address. Keep primary account encryption identity unchanged. Apply google-mail-project-schema.sql and linkedin-insights-schema.sql to GOOGLE_DB. LINKEDIN_ANALYTICS_APPROVED is obsolete and no longer adds scopes to base OAuth. Community Management needs a separate approved application/identity integration; read docs/LINKEDIN-ACCESS-REQUEST.fa.md before changing analytics. See docs/LINKEDIN-SETUP.fa.md and docs/GOOGLE-SECONDARY.md selectively.

Network targets use only PUBLIC opportunity data and private follow-ups; apply cloud/network-targets-schema.sql to GOOGLE_DB. Arash-only PESCI practice and own reflections use cloud/pesci-practice-schema.sql in GOOGLE_DB. Neither modifies CV achievements or sends messages.

Current operational index: docs/STATUS.fa.md (rewritten current state, not chronological notes). New automation hub has AI, mail preparation/scheduling, Telegram and encrypted owner exports; see each feature doc selectively. Five cron triggers are isolated by event.cron; preserve free-account/query budgets. Required new private schemas include AI, mail-automation, Telegram and both schedulers. Never activate older manual drafts/queues from a global flag; only new per-item approvals are executable.

Operational controls and remaining acceptance gates: docs/REMAINING.fa.md. Unattended mail/LinkedIn/Telegram must call automation-membership.mjs with server-only AUTOMATION_MEMBERSHIP_KEY and freshly check account/membership. Required private Supabase guard migrations and D1 mail-automation-v2-migration are documented separately; D1 rebuild uses a single batch, never separate destructive statements. Six-hour maintenance deletes bounded expired state/cache only, not audit/queues/grants.

Universitycatalogue: cloud/italian-universities.json is the datedMURinventory (102institutions). cloud/university-catalogue-schema.sql goes ONLY inOPPORTUNITY_DB; readonly /api/discovery/universities isAmironly. Technicalscans neverbecomeopportunityrows. scripts/scan_university_sites.py checksrobots/TLS/bounds andscripts/prepare_university_catalogue.py makespublicSQLwithoutcredentials. Newfeeddefinitions are split acrossrural/italy/au-source-adapters.mjs andmergedbycollector; total18, threeperscheduledrun, normalrotation~6hours.

Arash UX: src/arash-workspace.jsx owns home/navigation/folds; root .arash-workspace scoped CSS leaves Amir layout independent. Stable neon roles: jobs green, PESCI violet, mail/network cyan, CV amber; progressive disclosure must keep controls keyboard/touch accessible. Public page refresh uses available_at/lease/attempts (7d successful,24h transient,max3); source collector passes stable discoveryVersion SHA256 over relevant content fields, not nonexistent raw editionKey. Arash mail candidate SQL filters clinical jobs/fresh dates before limit; never broaden transport approval.

Per-opportunity mail: docs/OPPORTUNITY-MAIL.md. New authenticated router precedes generalopportunity routes and uses root ownercontext; mailmodule resolves mailbox itself. Sourceboundephemeralrecipient adapter neverwritesclinicbank. Settingsnamedpreseteditor livesemail-template-settings.jsx; immutable RPCrevisions, ownerguardedhooksinworkspace-tools. SelfhostedlicensedVazirmatnfiles needwoff2binarysupportinscripts/build_worker.mjs.

Contact/discovery engine: read docs/PUBLIC-CONTACT-ENGINE.md selectively. New public enrichment and AI-budget schemas are mandatory ONLY inOPPORTUNITY_DB. Extractor version2 supports flattenedtext. New23source registry includesgp-expanded-sources;3sources/hour ~8hrotation. PublicAIquote selection4attempts/day excludesprivateCV/mail andmustvalidateverbatimsource. Relatedcontacts keepindependentproof; privateCVreadinessAPIonly, neverpersistpublic. Oneclickmailafterpreview/review mustrefusereused/ambiguousqueue andchangedGoogleidentity.


## 2026-11-05 — خوانایی و اتصال دامنهٔ جدید

پنل امیر با کارت‌های شیشه‌ای و مسیرهای رنگی، منوهای جمع‌شونده و فونت Vazirmatn بازطراحی شد. تقویم و مدارک تمام‌عرض و سه بخش بازشونده دارد. راهنمای کوتاه بخش‌ها، اتصال شخصی تلگرام و تغییر زبان محلی فارسی/انگلیسی اضافه شدند؛ ترجمهٔ رابط کامل نیست و محتوای خصوصی ترجمه نمی‌شود.

شروع Google از دامنهٔ drgerami-md.ir با بلیت یک‌بارمصرف و POST به مبدأ اصلی اصلاح شد؛ callback و کلیدهای قبلی حفظ می‌شوند. GOOGLE_APP_ORIGINS باید https://drgerami-md.ir باشد. پروکسی gerami-website فقط در دو فایل مختص /aus اصلاح می‌شود. رضایت اتصال ایمیل دوم همچنان باید توسط مالک انجام شود. دامنه ثبت و فعال است؛ خطای همراه اول بدون آزمون همان شبکه حل‌شده اعلام نمی‌شود.

مجوز شبکهٔ کامل LinkedIn و پشتیبان خودکار مستقل/بازیابی روی محیط آزمایشی هنوز تکمیل نیستند؛ خروجی رمزگذاری‌شدهٔ دستی با پشتیبان ابری مستقل تفاوت دارد. هیچ ایمیل یا پست واقعی برای آزمون این تغییر ارسال نشد.
