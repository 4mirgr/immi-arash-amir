# دسترسی آمار و ارتباطات LinkedIn؛ بررسی و پروندهٔ آماده‌سازی

تاریخ بررسی محتوای منابع رسمی: **۲۰۲۶-۱۱-۰۳**. این سند درخواست ارسال‌شده، تأیید LinkedIn یا تضمین پذیرش نیست. متن آن، اطلاعات خصوصی رزومه/ایمیل یا کلید اپ را نگه نمی‌دارد.

## راهنمای کوتاه برای آرش و امیر

- **چه چیز آماده است؟** مسیر اتصال پایه و رضایت جداگانهٔ هر مالک، آماده‌سازی محتوا و انتشار صریح پست در حدود مجوز همان حساب. وضعیت اتصال هر شخص فقط از پنل خودش بررسی می‌شود؛ اتصال امیر، اتصال آرش را ایجاد نمی‌کند.
- **چه چیز تأیید نشده؟** دریافت خودکار آمار پیشرفته، فهرست کانکشن‌ها و شبکهٔ درجهٔ دوم. فعال‌شدن ورود یا Share این دسترسی‌ها را صادر نمی‌کند؛ فهرست «ارتباطات هدف» پیگیری خصوصی است، نه نمودار شبکهٔ زنده.
- **آرش چه کند؟** در حساب سایت خودش، دکمهٔ اتصال LinkedIn را بزند و با حساب LinkedIn خودش رضایت بدهد. رمز، کوکی و توکن را در چت نفرستد. اگر قبلاً متصل است، برای درخواست آمار به قطع اتصال پایه نیازی نیست.
- **برای دسترسی بیشتر چه لازم است؟** مالک/مدیر اپ باید واجد شرایط بودن واقعی را بررسی و از مسیر رسمی درخواست کند. تأیید محصول و سپس رضایت مستقل هر پزشک لازم است؛ تغییر کد یا اضافه‌کردن scope جای تأیید را نمی‌گیرد. پرونده و منابع زیر برای بررسی آماده‌اند؛ درخواستی از طرف شما ارسال نشده است.
- **تا آن زمان چه کار می‌کند؟** ورود دستی آمار و CSV مالک با برچسب منشأ، پیش‌نویس محتوا و پیگیری خصوصی افراد هدف. فایل خروجی را خود مالک از LinkedIn دریافت و در پنل خودش وارد می‌کند؛ دادهٔ دستی به‌عنوان همگام‌سازی زنده نمایش داده نمی‌شود.

## نتیجهٔ عملی برای وضعیت فعلی

اپ پایهٔ AUS Plan برای OpenID Connect و Share ساخته شده و اتصال یک مالک توسط کاربر گزارش شده است. این موفقیت، دسترسی آمار شخصی یا شبکهٔ ارتباطات را ایجاد نمی‌کند. ساخت Page مستقل نیز به معنی ثبت قانونی سازمان نیست.

مستند رسمی **Community Management App Review** صریحاً می‌گوید Community Management در حال حاضر برای **سازمان‌های حقوقی ثبت‌شده و کاربردهای تجاری** ارائه می‌شود. نام حقوقی، نشانی ثبت‌شده، وب‌سایت/دامنهٔ قابل راستی‌آزمایی و ایمیل کاری قابل تأیید لازم است؛ طبق همان صفحه، ایمیل شخصی vetting را نمی‌گذراند. در پروندهٔ پروژه، وجود چنین سازمانی یا کاربرد تجاری احراز نشده است. بنابراین نباید فرم رسمی را با ادعای شرکت ثبت‌شده، مشتریان تجاری، دامنهٔ سازمانی یا محصول تأییدشدهٔ ناموجود تکمیل کرد. ثبت شرکت یا خرید سرویس صرفاً برای بازکردن این API توصیه نمی‌شود؛ ابتدا باید مسیر واقعاً متناسب با پروژه معلوم شود.

راهنمای قبلی که «فعال‌کردن یک محصول و اضافه‌کردن scope به همان اپ پایه» را کافی نشان می‌داد، برای این مرحله کامل نبود. پرچم تنظیمات، کدنویسی adapter یا رضایت مالک، مجوز سازمانی صادر نمی‌کند.

## چرا Request access خاکستری است؟

صفحهٔ رسمی **LinkedIn API Partner Support → Why is the Community Management API request button grayed out?** علت مستندی را بیان می‌کند: Community Management باید **تنها محصول** اپ توسعه‌دهنده باشد. وجود محصول provisioned مانند Share یا درخواست محصول معلق، دکمهٔ این محصول را غیرفعال می‌کند.

اگر شرایط سازمانی واقعاً برقرار شد، مسیر مستند ایجاد **اپ جدا با همان LinkedIn Page مشروع** و درخواست Development Tier برای آن است. اپ پایهٔ کارکرده را حذف نکنید و کلیدهایش را برای این آزمایش عوض نکنید. پیش از ایجاد درخواست جدید، پیش‌نیازها را بررسی کنید؛ راهنمای پشتیبانی برای تکمیل survey پس از ایجاد آن مهلت ۲۱روزه ذکر می‌کند. شروع survey به معنی پذیرش درخواست نیست.

در پیاده‌سازی نیز grant/کلاینت آمار باید از اتصال پایه جدا یا طبق ترتیبی که خود LinkedIn کتبی تأیید می‌کند پشتیبانی شود. صرف افزودن `r_member_profileAnalytics` به Client ID فعلیِ دارای Share، مسیر درخواست جداگانه را حل نمی‌کند. تنظیم `LINKEDIN_ANALYTICS_APPROVED` فعلاً خاموش می‌ماند؛ قبل از استفادهٔ واقعی، مسیر جداگانهٔ اعتبارنامه و رضایت باید با محصول تأییدشده تطبیق یابد.

## آمار شخصی، آمار Page و شبکه یکی نیستند

| نیاز | مجوز/مرز رسمی | وضعیت واقعی پروژه |
|---|---|---|
| هویت پایه و انتشار صریح پست شخصی | `openid profile email` و `w_member_social` | اتصال پایه پیاده است؛ هر مالک رضایت مستقل می‌دهد |
| تعداد دنبال‌کنندگان پروفایل شخصی | `r_member_profileAnalytics`؛ endpoint مستند `memberFollowersCount?q=me` | adapter محدود آماده، مجوز پیشرفته احراز نشده |
| بازدید پروفایل و search appearances | در خانوادهٔ `r_member_profileAnalytics`؛ endpoint/دسترسی هر قابلیت جدا بررسی شود | adapter این دو شاخص هنوز پیاده/متصل اعلام نمی‌شود |
| آمار پست‌های شخصی | `r_member_postAnalytics` | صرف Share این مجوز را نمی‌دهد؛ این قابلیت هنوز متصل نیست |
| تعداد کانکشن درجهٔ اول | `r_1st_connections_size` در محصولات تأییدشده | این مجوز اجازهٔ دریافت نام/فهرست افراد نیست |
| فهرست ارتباطات درجهٔ اول | Connections API با `r_1st_connections`؛ دسترسی ویژهٔ تأییدشده | مجوز فعلی ندارد؛ استخراج شبکه فعال نیست |
| ارتباطاتِ کانکشن‌ها یا مرور آزاد شبکه | Connections API آن را ارائه نمی‌کند | چنین قابلیتی وعده داده نمی‌شود |
| آمار Page خود پروژه | مجوزهای سازمانی و نقش مناسب مدیر همان Page | با آمار پروفایل شخصی پزشکان جایگزین نمی‌شود |

Connections API فقط ارتباطات عضو رضایت‌داده و در حدود تنظیمات حریم خصوصی مربوط را می‌دهد. تأیید Community Management به‌خودی‌خود به معنی داشتن `r_1st_connections` نیست؛ این scope در فهرست عادی مجوزهای Community Management در Increasing Access وجود ندارد.

## محدودیت استفاده از داده؛ برای طراحی محصول مهم است

صفحهٔ رسمی **Restricted Uses of LinkedIn Marketing APIs and Data** استفاده از member data این برنامه برای فروش، استخدام/lead creation، تکمیل CRM یا ترکیب با داده‌های دیگر برای ساخت پروفایل/سرنخ را محدود یا منع می‌کند. بنابراین:

- آمار خود پروفایل، در صورت تأیید، فقط برای مدیریت همان پروفایل و در همان فضای مالک نمایش داده شود.
- موتور پیشنهاد فرصت/مجموعه از **آگهی‌ها و دادهٔ عمومی ناشران مستقل** استفاده کند؛ دادهٔ شخصی گرفته‌شده از Community Management به آن برای غنی‌سازی lead تزریق نشود.
- خواندن شبکه و دعوت/پیام خودکار با scope انتشار پست ساخته نمی‌شود. هیچ جمع‌آوری نشست، رمز، کوکی، پروفایل جعلی یا اسکرپ شبکهٔ خصوصی پیشنهاد نمی‌شود.
- دادهٔ API، دادهٔ دستی و CSV ارائه‌شدهٔ مستقل توسط مالک، منشأ جدا داشته باشند. دادهٔ دستی نباید با برچسب live/provider ظاهر شود.
- نگه‌داری داده باید **بر اساس نوع فیلد و محصول** بازبینی شود. جدول رسمی برای دادهٔ پایهٔ عضو احراز‌شده استثناهایی دارد، برای پروفایل سایر اعضا cache محدود و برای social activity محدودیت جدا دارد. نمی‌توان یک مدت ۲۴/۴۸ ساعت یا ۹۰ روز را به همهٔ فیلدها تعمیم داد. قبل از فعال‌کردن هر adapter، نگه‌داری/حذف آن با متن فعلی مجوز و جدول رسمی تطبیق داده شود.

## چک‌لیست واقعی قبل از درخواست

این موارد را تا مشاهدهٔ مدرک، «نامشخص» نگه دارید:

- [ ] سازمان حقوقی ثبت‌شدهٔ واقعی و کاربرد تجاری سازگار با پروژه وجود دارد.
- [ ] اختیار نمایندگی همان سازمان و مدیریت/تأیید Page مربوط وجود دارد.
- [ ] نام حقوقی، نشانی ثبت‌شده و وب‌سایت/دامنهٔ سازمان قابل راستی‌آزمایی‌اند.
- [ ] ایمیل کاری همان سازمان قابل دریافت و تأیید است؛ صرف داشتن Gmail یا داشتن ایمیل روی دامنهٔ جدید، ثبت قانونی سازمان را اثبات نمی‌کند.
- [ ] Super admin همان Page، رابطهٔ اپ با همان سازمان را تأیید کرده است. راهنمای Help برای تأیید رابطه ۳۰ روز مهلت ذکر می‌کند.
- [ ] کاربرد درخواست‌شده صرف مدیریت پروفایل/محتوای همان اعضای رضایت‌داده است؛ کاربردهای ناموجود یا ممنوع ادعا نشده‌اند.
- [ ] Privacy Policy واقعی و در دسترس است: `https://immi-arash-amir.dr-gerami-md.workers.dev/privacy.html`.
- [ ] برای نوع واقعی استقرار و مالکیت دامنه، تأیید مورد نیاز مشخص شده است. مستندات، وب‌سایت/دامنهٔ قابل تأیید می‌خواهند؛ از صفحات خوانده‌شده نمی‌توان نتیجه گرفت همهٔ `workers.dev`ها خودکار رد یا قبول می‌شوند. جایگزین‌کردن یک دامنه با اطلاعات حقوقی ناموجود، vetting را حل نمی‌کند.
- [ ] اپ Community Management جدا و بدون محصولات دیگر ساخته شده است؛ کلید/توکن آن با اتصال پایهٔ افراد مخلوط نمی‌شود.
- [ ] پس از تأیید واقعی محصول، scope دقیق در Auth دیده و رضایت هر مالک از مسیر همان کلاینت گرفته می‌شود.

**Standard Tier** مرحلهٔ بعد از Development است، نه شرط اتصال پایهٔ OIDC/Share. برای Standard، مستندات overview واقعی شرکت/محصول، test credentials مناسب بازبین و screencast کارکردهای پیاده‌شده را می‌خواهند. حساب واقعی پزشکان، مکاتبات خصوصی و Secretها را در ویدئو یا حساب آزمایشی بازبین قرار ندهید. اگر قابلیتی پیاده نیست، طبق راهنمای رسمی آن را در نمایش ذکر کنید؛ وانمود به وجودش نکنید.

## متن آماده برای پرسش از پشتیبانی؛ نه ادعای واجد شرایط بودن

این متن، پیشنهاد قابل بازبینی است و هنوز ارسال نشده. می‌توان پس از بررسی مالک، در مسیر پشتیبانی محصول پرسید آیا مسیر متناسبی با وضعیت فعلی وجود دارد:

```text
Subject: Eligibility clarification for a private two-member profile-management integration

We operate AUS Plan, an independent private medical career-planning and research workspace for two account holders. The existing application uses Sign In with LinkedIn using OpenID Connect and Share on LinkedIn, and each member authorizes their own account separately.

We would like to understand whether there is an eligible API access path for displaying each consenting member's own profile analytics, initially their follower count, within their private workspace. We are not asserting that this independent project is a registered commercial organization, and we do not currently claim Community Management API approval.

Your documentation says Community Management is limited to registered legal organizations for commercial use cases and requires a separate product-isolated application. Please confirm whether any supported access path is available for our current private/non-commercial use case, or whether we should retain only the existing basic integration and member-provided statistics.

Our public privacy policy is available at:
https://immi-arash-amir.dr-gerami-md.workers.dev/privacy.html

We do not request permission to scrape private networks, browse second-degree connections, send automated invitations or mass messages, or enrich recruiting leads with LinkedIn Marketing API member data.

If no eligible access path exists for this use case, we will keep the advanced API features disabled rather than misrepresenting our organization or the available permissions.
```

اگر بعداً سازمان و کاربرد تجاری واقعی معرفی شد، درخواست رسمی باید با **همان واقعیت‌ها** بازنویسی شود؛ این پرسش برای شرکت ثبت‌شده قابل کپی بدون تغییر نیست. در فرم پشتیبانی، Client ID همان اپ موضوع پرسش را وارد کنید؛ Secret، access token، authorization code یا callback دارای `code=` وارد نکنید.

## راه عملی تا روشن‌شدن دسترسی

اتصال پایه، متن/تصویر پیشنهادی، پیش‌نویس، انتشار صریح پست مجاز، CSV مالک و آمار دارای برچسب منشأ ادامه می‌یابد. پیشنهادهای شبکه‌سازی از منابع عمومی مستقل و فرصت‌های واقعی با ذخیره/پیگیری خصوصی ساخته می‌شوند. این مسیرها به‌عنوان شبکهٔ زندهٔ LinkedIn معرفی نمی‌شوند. نگه‌داشتن مرز مجوز، مانع ادامهٔ موتور فرصت‌ها و آماده‌سازی رزومه/پژوهش نیست.

## منابع رسمی خوانده‌شده

۱. [Community Management App Review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review?view=li-lms-2026-10) — پیش‌نیاز حقوقی/تجاری، business email، بررسی Development/Standard و screencast.

۲. [LinkedIn API Partner Support](https://learn.microsoft.com/en-us/linkedin/shared/linkedin-api-partner-support-guide) — علت دکمهٔ خاکستری، اپ جدا، survey و مسیر پشتیبانی.

۳. [Increasing Access](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-10) — جدول محصول/مجوز؛ Development در برابر Standard و اختیارات موردی LinkedIn.

۴. [Member Follower Statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/follower-statistics?view=li-lms-2026-10) — endpoint واقعی و نیاز به `r_member_profileAnalytics`.

۵. [Connections API](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/connections-api) — دسترسی ویژه، درجهٔ اول و عدم ارائهٔ شبکهٔ درجهٔ دوم.

۶. [Associate an app with a LinkedIn Page](https://www.linkedin.com/help/linkedin/answer/a548360/associate-an-app-with-a-linkedin-page) — نقش super admin و دائمی‌بودن رابطهٔ اپ/Page؛ default Page فردی برای Member Data Portability مخصوص EEA/Switzerland.

۷. [Restricted Uses of LinkedIn Marketing APIs and Data](https://learn.microsoft.com/en-us/linkedin/marketing/restricted-use-cases?view=li-lms-2026-10) — محدودیت استفاده، ترکیب، صدور و مخاطب دادهٔ اعضا.

۸. [Data Storage Requirements](https://learn.microsoft.com/en-us/linkedin/marketing/data-storage-requirements?view=li-lms-2026-10) — تفاوت نوع داده و مدت نگه‌داری؛ دادهٔ مستقل ارائه‌شده توسط مشتری از این جدول API تفکیک شده است.

## بازبینی رسمی و قدم عملی — ۱۱ نوامبر ۲۰۲۶

محتوای Community Management App Review و Connections API در این تاریخ دوباره خوانده شد. این دو دسترسی یکی نیستند: تأیید Community Management برای آمار/مدیریت محتوا، خودبه‌خود مجوز شبکه، دعوت، پیام‌رسانی یا جست‌وجوی همهٔ مشاغل نمی‌دهد.

- Community Management همچنان سازمان حقوقی ثبت‌شده، کاربرد تجاری پشتیبانی‌شده، ایمیل کاری قابل تأیید، دامنه و Page تأییدشده و بررسی LinkedIn می‌خواهد. Page مستقل یا ایمیل دانشگاهی شخصی به‌تنهایی این شرط را احراز نمی‌کند. برای پروژهٔ شخصی فعلی وعدهٔ تأیید یا توصیهٔ ثبت شرکت صرفاً برای API داده نمی‌شود.
- Connections API با `r_1st_connections` محدود به توسعه‌دهندگان مورد تأیید LinkedIn است. فقط کانکشن‌های درجهٔ اول صاحب رضایت را می‌دهد؛ شبکهٔ درجهٔ دوم در دسترس آن نیست. افزودن دستی نام scope به درخواست OAuth مجوز نمی‌سازد.
- Job Posting API برای ایجاد/مدیریت آگهی از طرف کارفرما/ATS است؛ مجوز عمومی جست‌وجوی همهٔ آگهی‌های LinkedIn برای اپ شخصی نیست. صفحهٔ رسمی فعلی اعلام می‌کند شریک جدید Job Posting نمی‌پذیرد و به Apply Connect ارجاع می‌دهد؛ آن هم یکپارچه‌سازی استخدامی است، نه ابزار جست‌وجوی شغل متقاضی.
- Premium، Sales Navigator یا ساخت Page را معادل دریافت مجوز API شخصی معرفی نکنید.

### اقدام رایگان قابل انجام صاحب حساب

۱. در نسخهٔ دسکتاپ LinkedIn: Me → Settings & Privacy → Data privacy → Get a copy of your data / Download your data. اگر Connections جداگانه قابل انتخاب است همان را درخواست کنید؛ وگرنه آرشیو بزرگ‌ترِ شامل connections را بگیرید. فقط `Connections.csv` را برای ورود در پنل همان مالک استفاده کنید، نه ZIP کامل شامل پیام‌ها و لاگ ورود. بعضی ایمیل‌ها به انتخاب حریم خصوصی خود کانکشن در خروجی وجود ندارند؛ نبودن ایمیل با حدس پر نمی‌شود. واردکنندهٔ فعلی سقف ۱۰۰۰ ردیف و ۵۰۰٬۰۰۰ بایت در هر درخواست دارد؛ فایل بزرگ‌تر باید با حفظ سرستون بخش‌بندی شود.

۲. در Jobs برای Australia جست‌وجوهای General Practitioner، Rural GP، GP supervision و IMG GP را بسازید؛ هشدار هر جست‌وجو را روشن و دریافت روزانه با Email را انتخاب کنید. عنوان عمومی GP هم حفظ شود تا آگهی فاقد کلمهٔ IMG/Level1 حذف نشود. Jobs → Preferences → Job alerts محل مدیریت آن‌هاست. LinkedIn فعلاً تا ۲۰ هشدار هم‌زمان ذکر می‌کند. گیرندهٔ ایمیل باید صندوق Google متعلق به همان پزشک و متصل به سایت باشد.

۳. از اطلاعات CSV و بانک کلینیک‌ها برای اولویت‌بندی مدیران، پزشکان و افراد مرتبط استفاده شود؛ متن معرفی، لینک پروفایل و تاریخ پیگیری در پنل خود مالک آماده باشد. دعوت و پیام در LinkedIn با اقدام مالک انجام می‌شود؛ API انتشار پست مجوز دعوت یا پیام خصوصی نیست. تطبیق نام شرکت، اثبات ارتباط مشترک یا معرفی‌شدن توسط فرد نیست.

### مرز پیاده‌سازی فعلی

ورود CSV مالک، پیشنهاد متن و پیگیری خصوصی در پروژه پیاده‌سازی شده‌اند. استخراج خودکار همهٔ کانکشن‌ها/پیام‌ها و جست‌وجوی سراسری مشاغل با API عمومی فعال نیست. ایمیل خبرنامه در Gmail می‌تواند در مکاتبات بازخوانی شود، اما خط لولهٔ اختصاصی «هشدار LinkedIn → استخراج لینک آگهی → بررسی منبع کارفرما → پیشنهاد شغلی خصوصی» هنوز پیاده‌سازی‌شده اعلام نمی‌شود. هشدار یا لینک به‌تنهایی جای خالی فعلی یا مجوز ارسال ایمیل نیست.

منابع رسمی بازخوانی‌شده:

- https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review
- https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/connections-api
- https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview?view=li-lts-2026-04
- https://www.linkedin.com/help/linkedin/answer/a566336/export-connections-from-linkedin
- https://www.linkedin.com/help/linkedin/answer/a1339364
- https://www.linkedin.com/help/linkedin/answer/a511279
- https://www.linkedin.com/help/linkedin/answer/a1420165
