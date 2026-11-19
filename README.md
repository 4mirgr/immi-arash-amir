# IMMI • Arash & Amir

دو فضای کاری برای مسیر پزشکی استرالیا: GP/PESCI دکتر آرش انتظار و مسیر تخصصی دکتر امیرهوشنگ گرامی.

**وضعیت: پنل آنلاین با ورود مستقل، پژوهش زمان‌بندی‌شده و مکاتبهٔ بازبینی‌شده برای هر پزشک.**

[بازکردن سایت](https://drgerami-md.ir/aus/) · [وضعیت اتصال‌ها و ورود](docs/DEPLOYMENT.fa.md) · [فهرست تعهدات و باقی‌مانده‌ها](docs/STATUS.fa.md)

 فایل‌های شخصی در GitHub قرار نمی‌گیرند. جابه‌جایی پروفایل، احراز هویت محسوب نمی‌شود. لیست کلینیک‌ها سرنخ‌های فایل‌های ورودی است و آگهی زنده یا تضمین پذیرش نیست.

[شروع ادامهٔ کار برای هر دستیار](docs/HANDOFF.md) · [وضعیت ساخت‌یافتهٔ پروژه](docs/PROJECT-STATE.json) · [نمایهٔ گزارش‌ها](docs/RESUME.md) · [اهداف تمام بخش‌ها](docs/GOALS.md)

راهنمای ادامه، قواعد قطعی، ساختار دو حساب، نوشتار و ارسال نامه، زمان‌بندی واقعی، آخرین انتشار و شرط تکمیل کارهای باز را مشخص می‌کند. گزارش‌های قدیمی سابقه‌اند؛ وضعیت اتصال و شمارنده‌ها باید با تاریخ خوانده شوند. Git شامل CV، مکاتبات، اطلاعات تماس خصوصی یا کلید حساب‌ها نیست و جای پشتیبان دادهٔ خصوصی را نمی‌گیرد.

## اجرا

Node 22+ و Python 3.12+:

```sh
npm ci
python -m server.app
# second terminal
npm run dev
```

Import privately (optional; otherwise clinic list is empty):

```sh
python scripts/import_documents.py /path/to/input-folder
```

```sh
npm run build
python -m unittest discover -s tests -v
```

- [راه‌اندازی LinkedIn — راهنمای فارسی](docs/LINKEDIN-SETUP.fa.md)
- [اتصال Google هر پزشک — راهنمای فارسی](docs/GOOGLE-SETUP.fa.md)
- [راهنمای حساب‌ها، اتصال‌ها و دامنه](docs/SETUP.fa.md)
- [قوانین اصلی](docs/POLICY.md) · [شروع کار ایجنت‌ها](AGENTS.md)
- [طراحی و محدودهٔ نسخه](docs/superpowers/specs/2026-11-03-platform-design.md)
- [تحقیقات مسیرها](docs/research/)

Cloudflare and the dedicated AUS Supabase project enforce independent doctor workspaces. Google/base LinkedIn connections have prior verified receipts; recheck current owner-specific state before a provider action. Base LinkedIn access does not include its complete network, messages or advanced analytics. Public collection and private mail/bank research are bounded scheduled jobs; whole-web/archive coverage remains in progress. Applications still require explicit review and approval. Read the [handoff](docs/HANDOFF.md) and [current goals](docs/GOALS.md) before using historical deployment notes as current status.
