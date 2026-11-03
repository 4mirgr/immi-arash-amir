# اتصال واقعی Google به دو پنل

کد و زیرساخت آماده‌اند؛ مراحل زیر به حساب مالک Google Cloud و رضایت خود پزشک نیاز دارند. اتصال Gmail در ChatGPT، جای اتصال مستقل سایت را نمی‌گیرد.

## ۱. پروژه و APIها
در [Google Cloud Console](https://console.cloud.google.com/) یک پروژهٔ مخصوص همین سایت انتخاب یا ایجاد کنید. در **APIs & Services → Library** این سه API را Enable کنید:

- Gmail API
- Google Calendar API
- Google Drive API

برای این اتصال، VM یا سرویس محاسباتی پولی لازم نیست. سهمیه و شرایط فعلی Google همچنان برقرار است.

## ۲. صفحهٔ رضایت
در **Google Auth Platform**:

- در **Branding** نام برنامه و ایمیل پشتیبانی خودتان را ثبت کنید.
- در **Audience** برای دو حساب شخصی، External و حالت Testing را انتخاب کنید.
- در **Test users** ایمیل واقعی Google امیر و آرش را جداگانه اضافه کنید؛ این ایمیل ممکن است با ایمیل ورود به سایت متفاوت باشد.
- در **Data Access** مجوزهای زیر را اضافه کنید: `openid`، `email`، `profile`، `https://www.googleapis.com/auth/gmail.readonly`، `https://www.googleapis.com/auth/gmail.send`، `https://www.googleapis.com/auth/calendar.events` و `https://www.googleapis.com/auth/drive.file`.

Gmail خواندن، مجوز حساس/محدودشده دارد. Testing ممکن است هشدار تأییدنشده نشان دهد و refresh token با این مجوزها پس از هفت روز منقضی شود؛ اتصال دوباره لازم می‌شود. انتشار دائمی ممکن است بررسی اضافی Google بخواهد؛ فعال‌کردن API به معنی پایان این بررسی نیست.

## ۳. ساخت Client
در **Clients → Create client** نوع **Web application** را انتخاب کنید.

**Authorized JavaScript origin:**

```text
https://immi-arash-amir.dr-gerami-md.workers.dev
```

**Authorized redirect URI** — دقیقاً، بدون اسلش اضافه:

```text
https://immi-arash-amir.dr-gerami-md.workers.dev/api/google/callback
```

برای سایت یک Client کافی است؛ هر پزشک با حساب Google خودش رضایت جداگانه می‌دهد و توکن‌ها/صندوق‌هایشان جدا می‌مانند.

## ۴. ثبت امن Client ID و Secret
در [Cloudflare Worker settings](https://dash.cloudflare.com/c570d16fc41cf9f0fa9be67c4bcceafd/workers/services/view/immi-arash-amir/production/settings)، بخش **Variables and Secrets**، دو ورودی از نوع **Secret** اضافه و Deploy/Save کنید:

| نام | مقدار |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID ساخته‌شده در Google |
| `GOOGLE_CLIENT_SECRET` | Client Secret همان Client |

کلید `GOOGLE_TOKEN_KEY` قبلاً امن ساخته شده است؛ آن را تغییر ندهید. کلیدها، فایل client-secret و کد ورود را در چت، GitHub یا اسکرین‌شات عمومی نفرستید.

## ۵. اتصال هر پزشک
در [سایت](https://immi-arash-amir.dr-gerami-md.workers.dev)، هر پزشک:

1. با حساب سایت خودش وارد شود؛ آرش ابتدا با ایمیل مجاز CV ثبت‌نام و ایمیل را تأیید کند.
2. در «اتصال‌ها و تنظیمات» روی اتصال Google بزند؛ پنجرهٔ اصلی را باز نگه دارد.
3. حساب Google خودش را در پنجرهٔ جدا انتخاب و مجوزها را بررسی/تأیید کند.
4. به پنل برگردد و صحت ایمیل نمایش‌داده‌شده را بررسی کند.
5. ابتدا sync صندوق و Calendar/Drive را آزمایش کند. ارسال ایمیل تنها با پیش‌نمایش، ساخت صف و انتخاب صریح پیام انجام می‌شود؛ اتصال باعث ارسال به همهٔ سرنخ‌ها نمی‌شود.

حساب Google یکسان نمی‌تواند به هر دو پنل وصل شود. قطع یا خرابی اتصال یکی، مجوز دیگری را جایگزین نمی‌کند. Drive فعلاً فقط فایل‌های مجاز برای همین برنامه را نشان می‌دهد، نه کل Drive.

اگر خطایی رخ داد، متن خطا را بدون رمز، token یا پارامتر code نشانی callback گزارش کنید. تا تأیید اجرای واقعی، موفق‌بودن تست‌های برنامه را معادل اتصال Google نمی‌دانیم.
