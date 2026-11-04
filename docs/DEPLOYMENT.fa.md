# منابع و انتشار جاری

نشانی: https://immi-arash-amir.dr-gerami-md.workers.dev

- Worker مستقل: `immi-arash-amir`، حساب متصل Cloudflare. Workerهای `intmed-api-proxy` و `damp-mud-edff` متعلق به این پروژه نیستند و تغییر نمی‌کنند.
- Supabase پروژهٔ مستقل `waxpjylnvwqdlktayyww` در سازمان انتخاب‌شدهٔ مالک. پروژهٔ قدیمی `upwbktvnybsjugdegjji` دست‌نخورده می‌ماند.
- GOOGLE_DB خصوصی: `faf37526-9c8c-4a86-9f91-3ab41ee8ddff`؛ OPPORTUNITY_DB عمومی: `a9605bec-79b7-430d-8d15-cfacb4cb1a58`.
- ورود با عضویتِ ایمیل تأییدشده و RLS است. اطلاعات خصوصی/رزومه/مکاتبات در Git نیستند. کلید service_role در frontend یا Worker قرار ندارد.
- Google و LinkedIn سایت از اتصال‌های چت مستقل‌اند. رضایت هر پزشک جداست؛ وضعیت جاری در [STATUS](STATUS.fa.md) است.

## انتشار

`npm ci`، build، تست‌های Node و Python، سپس `node scripts/build_worker.mjs`. فایل `worker-dist/bundle.mjs` فقط دارایی‌های عمومی برنامه و کد سرور را دارد؛ private/ و دادهٔ ورودی خوانده نمی‌شوند. assetهای hashدار immutable و HTML بدون cache دائمی‌اند. بخش‌های بزرگ UI به chunkهای مجزا تقسیم شده‌اند.

هنگام آپلود با API، `main_module` با filename قسمت multipart تطبیق داشته باشد. همهٔ bindingهای `secret_text` حفظ شوند؛ GOOGLE_TOKEN_KEY عوض نشود، وگرنه داده‌های رمز‌شدهٔ فعلی قابل‌خواندن نیستند. bindingهای D1 و AI و تنظیمات غیرمحرمانه را با نسخهٔ فعلی تطبیق دهید. نام Secretها ممکن است در راهنما باشد؛ مقدارشان هرگز چاپ/commit نمی‌شود.

migrationهای D1 از `cloud/*schema.sql` طبق نقش private/public اجرا می‌شوند؛ جدول موجود reset نشود. برای Supabase، قبل از DDL ساختار و RLS بررسی و migration قابل‌بازبینی تهیه شود. هیچ فرایند restore عمومی یا overwrite خودکار production نداریم.

## بررسی پس از انتشار

- صفحهٔ اصلی و JS chunkهای تازه پاسخ۲۰۰ و APIهای خصوصی بدون bearer پاسخ۴۰۱ بدهند.
- metadata و نام Secretها، نه مقدارشان، بررسی شوند؛ وضعیت اتصال هر مالک جدا خوانده شود.
- cronها باید با router در `cloud/worker.mjs` یکسان باشند. کارهای خصوصی در اجرای منابع عمومی ادغام نشوند؛ سقف query و تعداد trigger پلن رایگان محدود است.
- CI موفق به معنی انجام ارسال واقعی، ورود واقعی تازه یا تأیید تمام معیارهای بالینی نیست. شواهد واقعی و mock جدا گزارش شوند.
- برای `.ir` مراحل [DOMAIN-IR](DOMAIN-IR.fa.md) و برای بازیابی [BACKUP-RESTORE](BACKUP-RESTORE.md) را دنبال کنید.

برای رسید مستقل اجرای cron، `cloud/source-automation-schema.sql` را روی OPPORTUNITY_DB اعمال کنید. این رسید از دریافت دستی منابع جداست؛ نبودن آن اجرای خودکار را تأیید نمی‌کند.

جدول فهرست دانشگاه‌ها و رسیدهای فنی از `cloud/university-catalogue-schema.sql` روی OPPORTUNITY_DB ساخته می‌شود. دادهٔ خام رسمی `cloud/italian-universities.json`، ابزار پویش و تهیهٔ SQL در scripts هستند؛ credential یا دادهٔ خصوصی برای این واردکردن عمومی لازم نیست. جدول فهرست با opportunity_editions یکی نیست.
