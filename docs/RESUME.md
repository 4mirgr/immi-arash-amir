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


### Follow-up 2026-11-05
Owner reported successful second Gmail connection. Template delete uses owner-bound POST /api/presets/delete and immi_preset_owner_delete migration; own default FK cascades, prepared send snapshots unchanged. Inbox topic and display-count filters remain scoped to owner+Google mailbox; scores are heuristic, not acceptance predictions. Shared glass skin now covers Arash while preserving GP/PESCI navigation. Offsite backup remains planned: see BACKUP-AUTOMATION-PLAN.fa.md; no live schedule/exporter/restore proof.


## 2026-11-05 — مقصد Drive پشتیبان

مالک، حساب Google دوم امیر را به‌عنوان مقصد انتخاب کرد. مرحلهٔ دستی به پنل امیر اضافه شد: Google/start با purpose=backup برای همان secondary درخواست drive.file در کنار Gmail می‌کند؛ هدف در state رمزگذاری‌شده و پل دامنه حفظ می‌شود و بدون مجوز کامل، grant قبلی جایگزین نمی‌شود. عمومی‌کردن Drive ثانویه یا دسترسی آرش به توکن امیر انجام نمی‌شود.

GET /api/backup/drive/status فقط بررسی می‌کند. POST /api/backup/drive/upload فقط envelope رمزگذاری‌شدهٔ مرورگر را برای مالک امیر می‌پذیرد؛ پوشهٔ خصوصی برنامه، بررسی مالک/مجوز و دانلود/هش تطبیقی دارد. گذرواژه در مرورگر می‌ماند؛ سرور محتوا را رمزگشایی نمی‌کند و صرف تطبیق هش، صحت محتوا یا بازیابی را ثابت نمی‌کند. درخواست واقعی فقط با دکمهٔ کاربر؛ آزمایش‌ها از داده و provider ساختگی استفاده می‌کنند.

هنوز فعال نیست: رضایت واقعی Drive، خروجی کامل و نامحدود سرور، زمان‌بندی مستقل، حفاظت مستقل کلید و بازیابی روی دیتابیس آزمایشی. این فاز پشتیبان خودکار مرکزی دو پزشک نیست. طرح در BACKUP-AUTOMATION-PLAN.fa.md است.


## 2026-11-05 — دو تقویم امیر و نام صندوق‌ها
انتخاب تقویم امیر بین dr.gerami.md و amirgr20 اضافه شد؛ انتخاب تقویم از فرستندهٔ مکاتبات مستقل است. نام‌گذاری صندوق در مکاتبات، ارسال کنار آگهی و تنظیمات از local-part ایمیل همان اتصال خوانده می‌شود و جایگزین شناسه یا مجوز نمی‌شود. مجوز تازهٔ Calendar برای حساب دوم به رضایت مالک نیاز دارد؛ اتصال تقویم فعال‌شده اعلام نمی‌شود تا تأیید واقعی انجام شود.

دامنهٔ مالک/صندوق، توکن، cache/cursor، ETag و فرم تقویم مستقل‌اند؛ تغییر حساب پاسخ قدیمی یا فرمِ حساب قبلی را وارد حساب جدید نمی‌کند. Drive عمومی مدارک همچنان فقط روی حساب اصلی است و مجوز پشتیبان ثانویه حفظ می‌شود.


## 2026-11-05 — تاریخ دوگانه و حساب دوم مستقل برای هر پزشک

تاریخ نتایج Calendar، آخرین دریافت و زمان تغییر فایل Drive، در هر دو پنل شمسی/میلادی است. زمان‌های دارای ساعت یک لحظه را در تهران و منطقهٔ استرالیای انتخاب‌شده نشان می‌دهند؛ رویداد تمام‌روز تاریخ مدنی خود را حفظ می‌کند و پایان انحصاری Google به آخرین روز واقعی نمایش تبدیل می‌شود.

کاربر صریحاً تأکید کرد هیچ اتصال یا دادهٔ Google بین دو پزشک مشترک نباشد. هر پنل اکنون دو slot مستقل primary/secondary دارد. آرش از پنل خودش حساب Google دیگر را با رضایت رسمی انتخاب می‌کند؛ نیاز به تعریف ایمیلش در چت یا متغیر محیطی ندارد. حساب متصل‌شده در تمدید مجوز به ایمیل/subject قبلی مقید است؛ برای تغییر باید همان slot قطع و دوباره متصل شود. یکتایی Google subject، اتصال یک هویت به دو پزشک را رد می‌کند. Gmail، Calendar و پشتیبان دستی رمزگذاری‌شده فقط از اتصال صاحب پنل استفاده می‌کنند. Drive عمومی مدارک همچنان primary است؛ پشتیبان Drive مجوز محدود و مسیر جدا دارد.

آرش هنوز باید اتصال و مجوزهای واقعی حساب جدید خودش را تأیید کند. هیچ ایمیل، تقویم یا پشتیبان واقعی در تست‌ها نوشته نشد. پشتیبان خودکار کامل سرور همچنان فعال نیست.


## 2026-11-05 — ناوبری موبایل و بررسی متن پیشنهادی آرش
ناوبری موبایل به کارت کاربر بالای صفحه، ردیف جمع‌وجور خانه/فرصت‌ها/مکاتبات/بخش‌ها و منوی گروه‌بندی‌شده تبدیل شد؛ دسکتاپ مسیرهای قبلی را دارد. متن ارسالی آرش فقط برای مقایسه بررسی شد؛ پیشنهادهای P1–P8 در docs/research/ARASH-PROMPT-REVIEW-2026-11-05.fa.md منتظر انتخاب کاربرند و به هدف‌گذاری، رتبه‌بندی، CV یا قالب‌های فعال وارد نشده‌اند. فایل ورودی و اطلاعات تماس شخصی آن در Git نیستند. منابع رسمی PESCI/FSP/DPA برای تحلیل خوانده شدند؛ نتیجهٔ شخصی یا تضمین پذیرش ساخته نشد.


## 2026-11-05 — ادغام تأییدشدهٔ پرونده و نامهٔ GP آرش
کاربر P1–P8 را برای ادغام تأیید کرد. مسیر جدید «پرونده و نامهٔ اختصاصی» در کارت‌های آرش: dossier منبع‌دار، حالت PESCI/استخدام، پنج سطح پیگیری، انتخاب A/B/C، سه موضوع، جملات دقیق منبع و CV نسخه‌دار با تأیید مالک، و انتقال به پیش‌نمایش/صف Gmail قبلی. تغییر شواهد/CV/قالب/گیرنده یا Google نیاز به بازبینی تازه دارد؛ هیچ ارسال واقعی در توسعه انجام نشد. قالب‌های GP A/B/C با RPC مالک Arash نصب شدند، پیش‌فرض تغییر نکرد.
جداول gp_workflow_settings و gp_opportunity_progress در GOOGLE_DB اعمال شدند؛ هدف/مراحل خصوصی و owner_reported هستند، به CV یا مجوز ثبت/ارسال تبدیل نمی‌شوند و در خروجی محدود پشتیبان خود مالک قرار می‌گیرند.
پنج صفحهٔ عمومی تازه از adapterخوانی واقعی به OPPORTUNITY_DB وارد شد؛ محدودیت‌ها/تاریخ نامشخص و EOI حفظ شدند. runtime پنج منبع را به چرخهٔ بودجه‌دار اضافه می‌کند (۲۸ منبع اجرایی، سه منبع در هر نوبت؛ این شمارش تضمین پوشش همهٔ وب نیست). Ararat منفی/دسترسی‌نامطمئن دستی باقی ماند. فایل‌های منبع/تست جدید در Git، دادهٔ خصوصی/CV/توکن بیرون Git هستند. جست‌وجوی نام کلینیک به بانک ثبت‌شده محدود است.
# Password recovery — 2026-11-06
- `src/auth.jsx` + `auth-recovery.mjs`: forgotten-password email request, fragment scrubbing, provider-validated own password reset, no workspace bootstrap from recovery. See `docs/PASSWORD-RECOVERY.fa.md` only when touching recovery or redirects.
- Main-domain gateway needs recover + GET/PUT user allowlist in `gerami-website/functions/aus/[[path]].js`. Supabase `/aus/` redirect allowlist addition requested from owner; previous Worker callback remains usable. Never log/reset a real user's password as a test.
