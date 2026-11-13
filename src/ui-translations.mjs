import {EN_PAGED_BACKUP} from './locales/en-paged-backup.mjs';
import {EN_CLINIC_ENQUIRY} from './locales/en-clinic-enquiry.mjs';
import {EN_RESEARCH_BRIDGE_EVIDENCE} from './locales/en-research-bridge-evidence.mjs';
import {EN_RESEARCH_FUNDING} from './locales/en-research-funding.mjs';
import {EN_TEAM_BOARD} from './locales/en-team-board.mjs';
// Local interface labels only. No remote provider, source-content translation or
// changes to React elements, form values, events, or application data.
import {EN_CORE} from './locales/en-core.mjs';
import {EN_OPPORTUNITIES} from './locales/en-opportunities.mjs';
import {EN_WORKFLOWS} from './locales/en-workflows.mjs';
import {EN_EVIDENCE} from './locales/en-evidence.mjs';
import {EN_SEND_CONTROLS} from './locales/en-send-controls.mjs';
import {EN_LINKEDIN_ACTIONS} from './locales/en-linkedin-actions.mjs';
import {EN_OPPORTUNITY_ACTIONS} from './locales/en-opportunity-actions.mjs';
import {EN_CLINIC_BANK} from './locales/en-clinic-bank.mjs';
import {EN_AUDIT_STATUS} from './locales/en-audit-status.mjs';
const pairs=`
فاند استرالیا|Australia research funding
همکاری مشترک|Shared tasks
بورس‌های پژوهشی استرالیا و مدارک لازم را بررسی کنید؛ برنامهٔ آمادگی شما خصوصی است.|Review Australian research funding and requirements; your preparation plan stays private.
فقط کارهایی که آگاهانه منتشر می‌کنید مشترک هستند؛ حساب‌های شخصی جدا می‌مانند.|Only tasks you explicitly publish are shared; personal accounts remain separate.
نمای کلی|Overview
رصد فرصت‌ها|Opportunity search
مرکز مکاتبات|Correspondence
توسعه رزومه|CV development
آکادمی PESCI|PESCI practice
لینکدین و شبکه‌سازی|LinkedIn and networking
تحلیل مسیر و برنامه|Pathway and planning
تحصیل و فاند|Study and funding
مهارت‌ها و رویدادها|Skills and events
منابع و مسیرها|Sources and pathways
اتوماسیون و AI|Automation and AI
اتصال‌ها و تنظیمات|Connections and settings
کارهای اصلی|Main tasks
رشد حرفه‌ای و برنامه|Professional development and planning
منابع، اتصال‌ها و ابزارها|Sources, connections and tools
دو مسیر اصلی شما|Your two main pathways
امروز از کجا شروع کنیم؟|Where would you like to start today?
اول فرصت مناسب را پیدا کنید؛ رزومه، مکاتبه و تمرین در دسترس شماست.|Find a suitable opportunity first; your CV, correspondence and practice tools are ready to use.
فضای شخصی دکتر انتظار|Dr Entezar’s workspace
مسیر کاری|Employment pathway
پیداکردن فرصت شغلی|Find a job opportunity
آگهی‌های استرالیا، فیلتر ایالت و مناطق rural، شرایط ثبت و سوپرویژن|Australian listings, state and rural filters, registration and supervision requirements
دیدن فرصت‌های کاری|View job opportunities
آمادگی حرفه‌ای|Professional preparation
تمرین و آمادگی PESCI|PESCI preparation and practice
انتخاب کیس، تمرین زمان‌دار، خواندن انگلیسی و خودبازبینی پاسخ|Select a case, practise with a timer, listen in English and reflect on your response
شروع تمرین بالینی|Start clinical practice
بعد از پیدا کردن فرصت|After finding an opportunity
۱. رزومه را آماده کنید|1. Prepare your CV
بررسی نسخه‌ها و دانلود رزومه|Review versions and download your CV
تکمیل اطلاعات و ساخت نسخهٔ رزومه|Complete your details and create a CV version
۲. مکاتبه و پاسخ‌ها|2. Correspondence and replies
Gmail شما متصل است؛ پیام‌های مرتبط را بررسی کنید|Your Gmail is connected; review relevant messages
ابتدا Google خودتان را متصل کنید|Connect your own Google account first
۳. شرایط و قدم بعدی|3. Requirements and next steps
مدارک، مسیر ثبت پزشکی و کارهای لازم|Documents, medical registration pathway and required tasks
وضعیت داده‌ها و ابزارهای من|My data and tools
وضعیت اتصال و آمار بانک شخصی؛ برای دیدن باز کنید|Open to view connections and your database summary
ارتباط با سرور برقرار است|Server connected
ارتباط با سرور برقرار نیست|Server disconnected
وضعیت اتصال سایت؛ نشان‌دهندهٔ اجرای جست‌وجو نیست|Website connection status; this does not indicate an active search
Google همین حساب متصل است|This workspace’s Google account is connected
Google نیاز به اتصال دارد|Google connection required
اطلاعات تماس؛ آگهی باز یا جاب‌آفر تأییدشده نیست|Contact records; not verified vacancies or job offers
رفتن به اتصال‌ها و تنظیمات|Go to connections and settings
مسیر|Masir
ورود به فضای کاری پزشکی|Sign in to your medical workspace
ایمیل حساب|Account email
رمز عبور|Password
ورود|Sign in
خروج|Sign out
ثبت‌نام|Create account
در حال آماده‌سازی این بخش…|Preparing this section…
در حال دریافت…|Loading…
در حال بررسی…|Checking…
بررسی وضعیت|Check status
بررسی دوباره|Check again
تازه‌سازی|Refresh
به‌روزرسانی|Refresh
جست‌وجو|Search
جستجو|Search
ذخیره|Save
لغو|Cancel
حذف|Delete
ویرایش|Edit
دانلود|Download
کپی|Copy
کپی متن|Copy text
بستن|Close
قبلی|Previous
بعدی|Next
صفحهٔ قبل|Previous page
صفحهٔ بعد|Next page
همه|All
انتخاب|Select
فعال|Enabled
غیرفعال|Disabled
متصل|Connected
قطع اتصال|Disconnect
نیازمند اتصال|Connection required
پیش‌فرض|Default
تعیین پیش‌فرض|Set as default
نام|Name
عنوان|Title
موضوع|Subject
ایمیل|Email
تلفن|Phone
نشانی|Address
وب‌سایت|Website
وضعیت|Status
کشور|Country
استرالیا|Australia
ایتالیا|Italy
ایالت|State
شهر|City
هدف|Goal
نمایش|Show
منبع|Source
منبع:|Source:
رسمی|Official
غیررسمی؛ نیازمند تأیید|Unofficial; verification required
رسمی و غیررسمی|Official and unofficial
قوی|Strong
متوسط|Medium
ضعیف|Weak
بررسی‌نشده|Not reviewed
ویژه|Priority
همهٔ اولویت‌ها|All priorities
جدیدترین|Newest
مرتبط‌ترین|Most relevant
بدون موضوع|No subject
نامشخص|Unknown
در انتظار|Pending
تکمیل‌شده|Completed
شروع|Start
توقف|Stop
ادامه|Continue
تنظیمات|Settings
منوی پنل آرش|Arash workspace menu
حالت روشن|Light mode
حالت تیره|Dark mode
تغییر به حالت روشن|Switch to light mode
تغییر به حالت تیره|Switch to dark mode
کوچک‌تر کردن متن|Decrease text size
بزرگ‌تر کردن متن|Increase text size
بازنشانی به ۱۰۰٪|Reset to 100%
اندازهٔ متن همین کاربر|Text size for this profile
اندازهٔ متن؛ جداگانه برای همین کاربر در این مرورگر ذخیره می‌شود|Text size is saved separately for this profile in this browser
کاوش اختصاصی آرش؛ کلینیک، GP و مناطق rural|Arash’s search: clinics, general practice and rural locations
ایالت یا قلمرو|State or territory
تمام استرالیا · ۸ حوزه|All Australia · 8 states and territories
محل جست‌وجو|Search location
شهر یا نام مرکز، اختیاری|City or organization name, optional
کلیدواژه‌های جست‌وجو|Search keywords
IMG و limited registration|IMG and limited registration
سوپرویژن|Supervision
عبارت آمادهٔ جست‌وجو|Prepared search query
بازکردن جست‌وجوی عمومی|Open public search
کپی عبارت|Copy query
کپی پرسش‌های بررسی مرکز|Copy questions to ask the organization
نوع منبع|Source type
همهٔ مسیرها|All pathways
منشأ|Provenance
بازکردن منبع|Open source
پیوند دستی؛ خوراک خودکار نیست|Manual link; not an automated feed
بررسی اصل فرصت|Review original opportunity
بررسی اصل آگهی|Review original listing
اصل آگهی و روش درخواست|Original listing and application method
شرایط صریح، سطح ۱ و ابهام‌های درخواست|Explicit requirements, Level 1 and application uncertainties
نیازمند پرسش از مرکز:|Questions for the organization:
بررسی مقدماتی پروندهٔ شخصی من|Preliminary review of my profile
منشأ و نقل‌قول تماس|Contact source and quotation
منبع این تماس|Source of this contact
شواهد نام مرکز|Organization name evidence
منبع نام مرکز|Source of organization name
گزیدهٔ کمکی AI؛ نیازمند بررسی|AI-assisted excerpts; review required
منبع گزیده‌ها|Excerpt source
ارسال ایمیل و رزومه|Send email and CV
درخواست برای همین فرصت|Apply for this opportunity
قالب، رزومه یا اتصال حساب|Templates, CVs or account connection
قالب ایمیل|Email template
قالب را انتخاب کنید|Select a template
نسخهٔ رزومهٔ پیوست|Attached CV version
رزومه را انتخاب کنید|Select a CV
صندوق فرستنده|Sending mailbox
گیرندهٔ عمومی مرتبط با این فرصت|Published recipient for this opportunity
انتخاب گیرنده|Select a recipient
منبع ایمیل انتخابی|Source of the selected email
فرستنده:|Sender:
از|From
به|To
پیوست:|Attachment:
دریافت همین رزومه برای بازبینی|Download this CV for review
متن و پیوست ثابت این درخواست|Fixed application content and attachment
آگهی، گیرنده، متن و همین فایل رزومه را بازبینی کردم.|I reviewed the listing, recipient, message and this CV attachment.
فقط ذخیره در صف؛ بدون ارسال|Save to queue only; do not send
تلاش مجدد خودکار انجام نمی‌شود؛ نتیجهٔ نامشخص را در پوشهٔ Sent همین حساب بررسی کنید.|No automatic retry; check this account’s Sent folder if the outcome is uncertain.
نسخه‌ها و قالب‌های رزومه|CV versions and templates
هنوز نسخه‌ای ذخیره نشده است.|No version has been saved yet.
قالب‌های شخصی مکاتبه|My email templates
ذخیرهٔ متن بالا|Save the text above
نام قالب|Template name
موضوع ایمیل|Email subject
متن ایمیل|Email body
قالب جدید|New template
قالب جدید…|New template…
انتخاب قالب برای ویرایش|Select a template to edit
قالب‌های ذخیره‌شدهٔ همین حساب|Templates saved in this account
در حال دریافت قالب‌ها…|Loading templates…
پیش‌فرض فعلی:|Current default:
نمایش متن این نسخه|Show this version’s content
ویرایش در فرم|Edit in form
قطع اتصال همین حساب|Disconnect this account
بررسی اتصال|Check connection
بررسی اتصال اختصاصی|Check this account’s connection
راهنمای راه‌اندازی|Setup guide
صندوق مستقل این پنل|This workspace’s independent mailbox
ایمیل اصلی امیر|Amir’s primary email
ایمیل دوم امیر|Amir’s secondary email
Google اصلی|Primary Google account
Google دوم امیر|Amir’s secondary Google account
صندوق Google همین حساب را متصل کنید|Connect this workspace’s Google mailbox
مکاتبات مرتبط با پروژه|Project correspondence
مرتبط با پروژه|Relevant to the project
همهٔ پیام‌های همگام‌شده|All synced messages
ویژه و اقدام‌پذیر|Priority and actionable
همگام‌سازی خودکار هنگام بازبودن این پنل (هر ۶۰ ثانیه)|Sync automatically while this panel is open (every 60 seconds)
جست‌وجو و ادامهٔ مکاتبات قدیمی‌تر مرتبط|Find and continue older relevant correspondence
شروع دوباره از پیام‌های اخیر|Restart from recent messages
علت ارتباط با پروژه|Why this relates to the project
نشانه‌های پاسخ و محدودیت تحلیل|Reply signals and analysis limitations
آماده‌کردن پیش‌نویس پاسخ از همین ایمیل|Prepare a reply draft to this email
صف ارسال همین حساب|This account’s send queue
بازبینی و صف ارسال Gmail|Gmail review and send queue
رزومهٔ پیوست به این پیام|CV attached to this message
بدون پیوست|No attachment
یا یک فایل از Drive همین حساب|Or a file from this account’s Drive
دریافت فهرست فایل‌های مجاز Drive|Load permitted Drive files
صفحهٔ بعد فایل‌ها|Next page of files
بدون فایل Drive|No Drive file
بازبینی قبل از افزودن به صف|Review before queueing
پیام‌های آماده و نتایج همین حساب|This account’s prepared messages and results
صف این حساب خالی است.|This account’s queue is empty.
پاسخ در رشته:|Reply in thread:
نتیجهٔ آخرین اقدام:|Latest action result:
اتوماسیون آماده‌سازی مکاتبات|Application preparation automation
قالب، رزومه و صندوق اختصاصی همین کاربر|This profile’s template, CV and mailbox
سیاست و سقف آماده‌سازی|Preparation policy and limits
ترجیح گردش کار|Preferred workflow
فقط پیش‌نویس|Draft only
صف پس از بازبینی|Queue after review
صندوق انتخاب‌شده|Selected mailbox
حداکثر پیش‌نویس جدید در روز|Maximum new drafts per day
ذخیرهٔ سیاست|Save policy
فرصت‌های قابل بررسی؛ حداکثر سه انتخاب|Opportunities to review; select up to three
آماده‌سازی پیش‌نویس‌های انتخاب‌شده|Prepare selected drafts
نتیجهٔ آخرین آماده‌سازی|Latest preparation result
پیش‌نویس‌ها و وضعیت آماده‌سازی|Drafts and preparation status
پیش‌نویسی آماده نشده است.|No draft has been prepared.
گیرندهٔ منتشرشده:|Published recipient:
افزودن به صف همان صندوق؛ بدون ارسال|Add to this mailbox’s queue; do not send
عدم مکاتبه و گزارش محافظت‌ها|Suppression and safeguards
ثبت عدم مکاتبه|Add suppression
کتابخانهٔ تمرین گفت‌وگوی بالینی PESCI|PESCI clinical interview practice library
انتخاب موضوع|Select a topic
خواندن انگلیسی کیس و پرسش‌ها|Read the case and questions in English
سرعت صدا|Speech speed
آهسته · ۰٫۸|Slow · 0.8
معمول · ۱|Normal · 1
سریع · ۱٫۲|Fast · 1.2
توقف صدا|Stop speech
زمان تمرین؛ معیار رسمی آزمون نیست|Practice timer; not official exam timing
بازنشانی زمان|Reset timer
پاسخ و خودبازبینی خصوصی|Private response and self-reflection
فقط متن تمرینی بنویسید؛ نام، شناسه یا اطلاعات بیمار واقعی وارد نکنید.|Use practice text only; do not enter real patient names, identifiers or information.
بازبینی دستی مهارت‌ها؛ نمره یا تأیید عملکرد نیست|Manual skills reflection; not a score or performance certification
منابع و محدودیت تمرین|Practice sources and limitations
هنوز پاسخی ثبت نشده است.|No response has been saved yet.
خوداظهاری؛ فاقد نمرهٔ رسمی یا تأیید صلاحیت|Self-reported; not an official score or competency assessment
پروندهٔ برنامه‌ریزی و موارد باز|Planning profile and open questions
پایان دورهٔ تخصص|Specialist training completion
سناریوهای بورد|Board examination scenarios
آمادگی زبان|Language preparation
سطح ثبت‌شده|Recorded level
پشتوانهٔ سطح|Evidence for this level
آزمون ترجیحی|Preferred test
وضعیت آزمون|Test status
گواهی زبان|Language certificate
مواردی که باید بعداً روشن شوند|Questions to clarify later
مورد باز دیگری ثبت نشده است.|No other open question is recorded.
راه ارتباطی دانشگاهی گزارش‌شده|Reported university contact
آخرین به‌روزرسانی:|Last updated:
ارتباطات هدف و پیگیری فرصت‌ها|Target contacts and opportunity tracking
جست‌وجوی مجموعه یا فرصت|Search organizations or opportunities
همهٔ کشورهای مجاز|All permitted countries
همهٔ هدف‌ها|All goals
پیشنهادهای منابع عمومی|Public-source suggestions
پیگیری‌های خصوصی من|My private follow-ups
جست‌وجوی نام مجموعه در LinkedIn؛ هویت تأیید نشده|Search the organization on LinkedIn; identity unverified
دلیل پیشنهاد و منشأ|Suggestion reason and provenance
هدف ذخیره|Saved target
وضعیت خصوصی|Private status
یادداشت خصوصی|Private note
حدود پوشش و خودکارسازی|Coverage and automation limits
فضای اختصاصی LinkedIn|My LinkedIn workspace
دریافت آخرین دادهٔ ثبت‌شده|Load latest recorded data
اتصال اختیاری LinkedIn همین کاربر|Optional LinkedIn connection for this profile
بررسی وضعیت اتصال LinkedIn|Check LinkedIn connection
بازکردن پروفایل همین کاربر|Open this profile on LinkedIn
متن فعلی و مقصد تغییر|Current text and target section
بخش LinkedIn|LinkedIn section
ثبت نسخهٔ فعلی|Save current version
کپی متن پیشنهادی|Copy suggested text
بازکردن پروفایل برای درج دستی|Open profile for manual editing
ذخیرهٔ نسخهٔ پیشنهاد|Save suggestion version
کپی نسخهٔ ذخیره‌شده|Copy saved version
کارهای مهم برای رشد حرفه‌ای|Professional development priorities
کپی پیشنهاد|Copy suggestion
آماده‌سازی محتوای پست|Prepare post content
عنوان داخلی پیش‌نویس|Internal draft title
متن قابل بازبینی پست|Post content for review
ذخیرهٔ پیش‌نویس / برنامه|Save draft or schedule
کپی پست|Copy post
کپی پیش‌نویس|Copy draft
تصویر پست PNG|Post image PNG
قالب SVG|SVG template
بازکردن LinkedIn برای انتشار|Open LinkedIn to publish
صف محتوا و کارهای انتشار|Content queue and publishing tasks
آوردن به ویرایشگر|Load into editor
لغو تأیید همین پست|Cancel this post’s approval
ویرایش به‌صورت پیش‌نویس جدید|Edit as a new draft
خودم منتشر کردم؛ ثبت وضعیت|I published it; record status
مشاهدهٔ لینک گزارش‌شده|View reported link
هنوز پیش‌نویسی ذخیره نشده است.|No draft has been saved yet.
واردکردن خروجی رسمی ارتباطات خودتان|Import your official connection export
نمودارها و وضعیت دسترسی زنده|Charts and live access status
اندازه‌گیری‌های API رسمی؛ حساب متصل همین کاربر|Official API measurements for this connected account
نمودار داده‌های دستی؛ از آمار زنده جداست|Manual data charts; separate from live metrics
تحلیل ارتباطات هدفِ ثبت‌شده در پنل|Analysis of saved target contacts
هنوز ارتباط هدفی در این حساب ثبت نشده است.|No target contact is recorded in this account.
تقویم و مدارک|Calendar and documents
برنامه‌های من|My events
برنامه‌های ذخیره‌شده در تقویم Google را ببینید و ویرایش کنید.|View and edit events saved in Google Calendar.
عنوان برنامه|Event title
شروع برنامه|Event start
پایان برنامه|Event end
لغو ویرایش|Cancel editing
دریافت بخش بعدی تقویم|Load more calendar events
مدارک من|My documents
مدارک را در Drive همین حساب بارگذاری یا دانلود کنید.|Upload or download documents in this account’s Drive.
فایل‌های بیشتر|More files
انتخاب مدرک برای بارگذاری|Select a document to upload
هجری شمسی · تهران|Persian calendar · Tehran
میلادی · استرالیا|Gregorian calendar · Australia
منطقهٔ زمانی استرالیا|Australian time zone
ماه قبل|Previous month
ماه بعد|Next month
نمایش ماه امروز|Show current month
حذف زمان‌بندی|Remove schedule
تهران ·|Tehran ·
استرالیا ·|Australia ·
فهرست رسمی دانشگاه‌های ایتالیا و زیرصفحه‌های یافت‌شده|Official Italian university directory and discovered pages
همهٔ دانشگاه‌های فهرست|All listed universities
صفحه دریافت شده|Page retrieved
دریافت نشده|Not retrieved
محدود یا ناموفق|Restricted or failed
جست‌وجو در دیتابیس|Search database
ثبت در فهرست:|Listed:
· آخرین پویش فنی:|· Last technical scan:
وب‌سایت دانشگاه|University website
منشأ فهرست رسمی|Official directory source
جست‌وجوی هدفمند Google|Targeted Google search
جست‌وجوی هدفمند Bing|Targeted Bing search
پیوندهای بعدی مشاهده‌شده؛ هنوز دریافت نشده‌اند|Discovered links; not yet retrieved
ابزارهای خودکار همین حساب|This account’s automation tools
دستیار تحلیل و پیش‌نویس|Analysis and drafting assistant
نوع کار|Task type
سؤال یا درخواست|Question or request
افزودن اختیاری متن خصوصی همین پرونده|Optionally add private text from this profile
پیش‌نویس تأییدنشدهٔ AI|Unverified AI draft
تاریخچهٔ خصوصی اخیر همین کاربر|This profile’s recent private history
اعلان‌های تلگرام همین کاربر|This profile’s Telegram notifications
در حال بررسی اتصال…|Checking connection…
بات:|Bot:
مدیر پروژه این مرحله را انجام می‌دهد.|The project administrator completes this step.
ساخت لینک اتصال شخصی|Create a personal connection link
بازکردن بات و اتصال همین حساب|Open bot and connect this account
دریافت اعلان فرصت‌های تازهٔ همین پنل|Receive notifications for this workspace’s new opportunities
شروع سکوت به وقت تهران|Quiet hours start, Tehran time
پایان سکوت|Quiet hours end
ذخیرهٔ تنظیمات اعلان|Save notification settings
ارسال یک پیام آزمایشی به چت خودم|Send a test message to my own chat
قطع اتصال همین چت|Disconnect this chat
وضعیت و کنترل کارهای باقی‌مانده|Remaining tasks and operational controls
بررسی وضعیت همین حساب|Check this account’s status
LinkedIn همین کاربر|This profile’s LinkedIn
زمان‌بندی‌های منتظر|Pending schedules
کنترل عضویت پیش از ارسال خودکار|Membership check before automated sending
مواردی که هنوز به اقدام یا مدرک بیرونی نیاز دارند|Items requiring external action or evidence
لغو گروهی زمان‌بندی‌های منتظر همین حساب|Cancel this account’s pending schedules
پشتیبان خصوصی همین کاربر|This profile’s private backup
گذرواژهٔ پشتیبان؛ حداقل ۱۶ نویسه|Backup passphrase; at least 16 characters
تکرار گذرواژه برای ساخت فایل جدید|Repeat passphrase to create a new file
بررسی محلی فایل قبلی؛ بدون بازیابی|Check an existing file locally; no restoration
خلاصهٔ فایلِ بررسی‌شده|Checked file summary
فایل|File
منوی پنل امیر|Amir workspace menu
مسیرهای اصلی من|My main pathways
رزومه و رشد حرفه‌ای|CV and professional development
اتصال‌ها و ابزارها|Connections and tools
مسیر تخصص|Specialist pathway
مسیر طبابت در استرالیا|Medical practice in Australia
شرایط ارزیابی تخصص، مدارک لازم و قدم‌های بعدی را با پروندهٔ خودتان بررسی کنید.|Review specialist assessment requirements, documents and next steps against your profile.
بررسی مسیر تخصص|Explore the specialist pathway
تحصیل و پژوهش|Study and research
تحصیل با فاند و بورسیه|Funded study and scholarships
فراخوان‌های استرالیا و ایتالیا را با مهلت، شرایط پذیرش و جزئیات کمک‌هزینه ببینید.|Explore Australian and Italian calls with deadlines, admission criteria and funding details.
دیدن فرصت‌های تحصیلی|View study opportunities
فرصت و ارتباط|Opportunities and outreach
فرصت‌های شغلی و مکاتبات|Job opportunities and correspondence
آگهی‌ها را فیلتر کنید، شرایط و راه تماس را ببینید و برای مورد مناسب درخواست آماده کنید.|Filter listings, review requirements and contact details, and prepare a suitable application.
دیدن فرصت‌های مناسب|View suitable opportunities
پروندهٔ شخصی دکتر گرامی|Dr Gerami’s personal profile
مسیر بعدی شما، روشن‌تر و منظم‌تر|A clearer, more organized next step
برای شروع یکی از مسیرهای زیر را انتخاب کنید. هر مسیر، اطلاعات و کارهای مربوط به خودش را نشان می‌دهد.|Choose a pathway below to see its information and tasks.
رزومهٔ من|My CV
نسخه‌های رزومه و فایل مناسب هر درخواست|CV versions and the right file for each application
لینکدین من|My LinkedIn
متن پروفایل، برنامهٔ پست‌ها و ارتباطات هدف|Profile text, post planning and target contacts
مهارت‌ها و دوره‌ها|Skills and courses
دوره‌ها و رویدادهای مرتبط با مسیر شما|Courses and events relevant to your pathway
اتصال‌ها و قالب‌ها|Connections and templates
Google، ایمیل دوم و قالب‌های مکاتبه|Google, secondary email and correspondence templates

فرصت‌های کاری آرش|Arash’s job opportunities
فرصت‌ها و نوبت‌های انتشار هر مجموعه|Opportunities and publication history by organization
بررسی تازهٔ منابع|Check sources for updates
فیلترهای بیشتر؛ نوع آگهی و منبع|More filters: listing and source type
موردی با این فیلتر ثبت نشده است|No recorded result matches these filters
کاوش بیشتر؛ کلینیک، مناطق rural و شبکه‌ها|Explore clinics, rural areas and networks
وضعیت جست‌وجوی خودکار و پوشش منابع|Automated search status and source coverage
مشاهدهٔ منبع|View source
دادهٔ ناشر|Publisher data
شروع تمرین|Start practice
مکث|Pause
در حال ذخیره…|Saving…
ذخیرهٔ پاسخ و خودبازبینی|Save response and self-reflection
سرعت خواندن کیس|Case reading speed
درخواست ایمیل و رزومه|Email and CV application

`;
export const UI_TRANSLATIONS=Object.freeze({...Object.fromEntries(pairs.trim().split('\n').filter(line=>line.includes('|')).map(line=>{const at=line.indexOf('|');return [line.slice(0,at),line.slice(at+1)];})),...EN_CORE,...EN_OPPORTUNITIES,...EN_WORKFLOWS,...EN_EVIDENCE,...EN_SEND_CONTROLS,...EN_LINKEDIN_ACTIONS,...EN_OPPORTUNITY_ACTIONS,...EN_CLINIC_BANK,...EN_AUDIT_STATUS,...EN_RESEARCH_BRIDGE_EVIDENCE,...EN_RESEARCH_FUNDING,...EN_TEAM_BOARD,...EN_CLINIC_ENQUIRY,...EN_PAGED_BACKUP,'و':'and','مورد':'items','حساب تقویم':'Calendar account','دکتر امیر هوشنگ گرامی':'Dr Amir Houshang Gerami','امیر هوشنگ گرامی':'Amir Houshang Gerami','نویسه':'characters','ستاره':'stars','؛ روی دستگاه خودتان نگه دارید.':'; keep it on your device.','؛ آمار پیشرفته و شبکهٔ کامل مجوز جدا می‌خواهند':'; advanced analytics and the full network require separate permissions','روی دستگاه خودتان نگه دارید.':'keep it on your device.','آمار پیشرفته و شبکهٔ کامل مجوز جدا می‌خواهند':'advanced analytics and the full network require separate permissions'});
const PRIVATE='[data-no-translate],pre,blockquote,code,script,style,textarea,[contenteditable="true"],.message-snippet,.message-body,.cv-preview,.source-quote,.evidence-quote,.arash-opportunity-full-text,[data-private]';
const ATTRS=['aria-label','placeholder','title','alt'];
const ARABIC=/[\u0600-\u06ff]/;
const cache=new WeakMap();
const digits=value=>value.replace(/[۰-۹٠-٩]/g,c=>String(c.charCodeAt(0)-(c>='۰'&&c<='۹'?1776:1632)));
const normalize=value=>digits(value).replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/\s+/g,' ').trim();
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function compiled(dictionary){
 if(cache.has(dictionary))return cache.get(dictionary);
 const exact=new Map();for(const [key,value]of Object.entries(dictionary))if(typeof value==='string'&&value)exact.set(normalize(key),value);
 const keys=[...exact.keys()].filter(key=>ARABIC.test(key)&&key.length>=3).sort((a,b)=>b.length-a.length);
 const fragments=keys.length?new RegExp('(?<![\\p{L}\\p{M}\\u200c])(?:'+keys.map(escape).join('|')+')(?![\\p{L}\\p{M}\\u200c])','gu'):null;
 const value={exact,fragments};cache.set(dictionary,value);return value;
}
export function translateUIString(value,dictionary=UI_TRANSLATIONS){
 if(typeof value!=='string'||!value.trim())return value;
 const {exact,fragments}=compiled(dictionary),key=normalize(value);let next=exact.get(key);
 if(next===undefined){
  if(!ARABIC.test(key))return digits(value);
  const counted=key.replace(/(\d[\d,.]*)\s+از\s+(?=\d)/g,'$1 of ');
  next=fragments?counted.replace(fragments,part=>exact.get(part)):counted;
  if(next===key)return digits(value);
 }
 // Interface formatting only. ISO/form values and quoted/user content never enter here.
 next=digits(next).replace(/،/g,',').replace(/؛/g,';').replace(/؟/g,'?').replace(/ {2,}/g,' ').trim();
 return value.match(/^\s*/)[0]+next+value.match(/\s*$/)[0];
}
// Only Text.nodeValue and accessibility attributes change. React nodes, option
// values, handlers and all application payloads retain their identity and data.
export function translateInterface(root,{dictionary=UI_TRANSLATIONS}={}){
 if(!root)return()=>{};
 const doc=root.ownerDocument,view=doc.defaultView,texts=new Map(),attributes=new Map();let active=true,pending=false;
 const excluded=node=>Boolean(node?.closest?.(PRIVATE));
 function source(node){const prior=texts.get(node);if(prior&&node.nodeValue===prior.rendered)return prior.original;if(prior)texts.delete(node);return node.nodeValue||'';}
 function apply(node,next){const original=source(node);if(node.nodeValue===next)return;node.nodeValue=next;if(original!==next)texts.set(node,{original,rendered:next});else texts.delete(node);}
 function text(node){if(!node.parentElement||excluded(node.parentElement)||node.parentElement.closest('input,svg')||node.parentElement.tagName==='OPTION'&&!node.parentElement.hasAttribute('value'))return;
  const original=source(node),next=translateUIString(original,dictionary);if(next!==original)apply(node,next);
 }
 const unitTags='p,span,small,strong,em,b,i,label,legend,summary,button,h1,h2,h3,h4,h5,h6,option,th,td,dt,dd,a,li,div';
 function aggregate(element,handled){
  if(excluded(element)||element.closest('svg')||element.tagName==='OPTION'&&!element.hasAttribute('value'))return;
  // Aggregate only a single inline sentence (including MixedText's bdi runs).
  // Never flatten child controls, lists, blocks, links or raw/source containers.
  if(element.querySelector('input,textarea,select,button,pre,blockquote,code,[data-no-translate],[data-private],p,div,section,article,ul,ol,li,dl,table,header,footer,details'))return;
  const walker=doc.createTreeWalker(element,view.NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())if(!walker.currentNode.parentElement.closest('svg'))nodes.push(walker.currentNode);
  if(!nodes.length)return;
  const groups=[[]];for(const node of nodes){if(handled.has(node)){if(groups.at(-1).length)groups.push([]);}else groups.at(-1).push(node);}
  for(const group of groups){if(!group.length)continue;const original=group.map(source).join(''),next=translateUIString(original,dictionary);
   if(next!==original)group.forEach((node,index)=>{apply(node,index===0?next:'');handled.add(node);});
  }
  // A hyperlink is a semantic boundary; translating nearby prose must never
  // move its label outside the clickable node or make the link disappear.
  if(element.tagName==='A')nodes.forEach(node=>handled.add(node));
 }
 function attrs(node){if(node.closest('[data-no-translate],[data-private],script,style,.message-body,.message-snippet,.cv-preview,.source-quote,.evidence-quote'))return;for(const key of ATTRS){const value=node.getAttribute(key);if(value===null)continue;let states=attributes.get(node);const prior=states?.get(key);if(prior&&value===prior.rendered)continue;
   const next=translateUIString(value,dictionary);if(next!==value){if(!states){states=new Map();attributes.set(node,states);}states.set(key,{original:value,rendered:next});node.setAttribute(key,next);}else states?.delete(key);
  }}
 function scan(){if(!active)return;pending=false;const handled=new Set();if(root.nodeType===1&&root.matches(unitTags))aggregate(root,handled);for(const element of [...root.querySelectorAll(unitTags)].reverse())aggregate(element,handled);
  const walker=doc.createTreeWalker(root,view.NodeFilter.SHOW_TEXT);while(walker.nextNode())if(!handled.has(walker.currentNode))text(walker.currentNode);
  if(root.nodeType===1)attrs(root);for(const element of root.querySelectorAll('[aria-label],[placeholder],[title],[alt]'))attrs(element);
  for(const node of texts.keys())if(!root.contains(node))texts.delete(node);for(const node of attributes.keys())if(!root.contains(node))attributes.delete(node);
 }
 const observer=new view.MutationObserver(()=>{if(!active||pending)return;pending=true;queueMicrotask(scan);});
 scan();observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});
 return()=>{active=false;observer.disconnect();for(const [node,entry]of texts)if(root.contains(node)&&node.nodeValue===entry.rendered)node.nodeValue=entry.original;for(const [node,states]of attributes)if(root.contains(node))for(const [key,entry]of states)if(node.getAttribute(key)===entry.rendered)node.setAttribute(key,entry.original);texts.clear();attributes.clear();};
}
