# بازیابی رمز ورود

در صفحهٔ ورود، «رمز عبور را فراموش کرده‌ام» را بزنید و **ایمیل ورود به سایت** را وارد کنید؛ ایمیل Google متصل به پنل الزاماً همان ایمیل ورود نیست. لینک داخل ایمیل، فرم رمز جدید و تکرار آن را باز می‌کند. حداقل ۱۲ و حداکثر ۱۲۸ کاراکتر لازم است. پس از ثبت، با رمز جدید وارد شوید. این فرایند حساب تازه نمی‌سازد، عضویت/مالکیت را تغییر نمی‌دهد و اتصال‌های Google/LinkedIn را جابه‌جا نمی‌کند.

برای حفظ حریم خصوصی، پاسخ درخواست نمی‌گوید ایمیل ثبت شده است یا خیر. محدودیت ارسال Supabase برقرار است و رابط برای درخواست مجدد دست‌کم ۶۰ ثانیه فاصله می‌گذارد. پوشهٔ Spam را بررسی کنید. لینک نامعتبر یا منقضی به فرم درخواست لینک تازه برمی‌گردد. صفحه را پس از بازکردن لینک تازه‌سازی نکنید: اطلاعات بازیابی فقط در حافظه است و بعد از پاک‌شدن نشانی، با تازه‌سازی باید لینک تازه گرفت.

## تنظیم انتشار

- در Supabase همین پروژه (`waxpjylnvwqdlktayyww`)، فهرست Authentication → URL Configuration → Redirect URLs باید `https://drgerami-md.ir/aus/` را داشته باشد. نشانی canonical قبلی Worker حفظ شود. این تنظیم از ابزار مدیریتی فعلی قابل ویرایش نیست؛ مالک در ۱۴۰۵/۰۸/۱۵ افزودن و ذخیرهٔ نشانی را تأیید کرد. Site URL قبلی می‌تواند باعث برگشت به Worker شود که همین فرم را نیز دارد.
- درخواست مستقیم Supabase Auth: POST `/auth/v1/recover?redirect_to=...` با ایمیل؛ implicit callback با fragment `type=recovery`؛ GET `/auth/v1/user` برای اعتبارسنجی؛ PUT همان مسیر با فقط `password`؛ پس از موفقیت POST `/auth/v1/logout` و ورود مجدد دستی.
- Gateway دامنهٔ اصلی در مخزن `gerami-website` فقط recover به مسیر دقیق `/aus/` و GET/PUT محدود user را به پروژهٔ ثابت Supabase می‌فرستد؛ تغییر ایمیل/metadata از این مسیر پذیرفته نمی‌شود. Origin، محدودیت حجم، no-store و منع redirect سرور حفظ شوند.
- Access token و خطاهای callback پیش از استفاده از نشانی پاک می‌شوند؛ refresh token بازیابی دور ریخته می‌شود. هیچ توکنی در localStorage/sessionStorage/cookie یا APIهای workspace ثبت نمی‌شود. callback هرگز مستقیماً پنل را باز نمی‌کند. پس از تغییر رمز، تلاش برای ابطال refresh sessionها انجام می‌شود؛ اعتبار access tokenهای از قبل صادرشده به سیاست و عمر توکن Supabase وابسته است.
- هیچ رمز، ایمیل خصوصی یا callback واقعی در تست/گیت ثبت نمی‌شود. آزمون مرورگر با provider ساختگی انجام شده؛ ارسال ایمیل واقعی و تغییر رمز واقعی باید به درخواست خود صاحب حساب انجام شود.

مراجع بررسی‌شده: [Password-based Auth](https://supabase.com/docs/guides/auth/passwords)، [Reset password](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail). آزمون پایدار قرارداد: `node --test tests/cloud_auth_recovery.mjs tests/cloud_auth.mjs`؛ آزمون gateway در مخزن میزبان: `node --test scripts/test_aus_gateway.mjs`.
