# IMMI • Arash & Amir

دو فضای کاری برای مسیر پزشکی استرالیا: GP/PESCI دکتر آرش انتظار و مسیر تخصصی دکتر امیرهوشنگ گرامی.

**وضعیت: نسخهٔ آنلاین اولیه با ورود و دیتابیس مستقل، به‌علاوه اجرای محلی.**

[بازکردن سایت](https://immi-arash-amir.dr-gerami-md.workers.dev) · [وضعیت اتصال‌ها و ورود](docs/DEPLOYMENT.fa.md)

 فایل‌های شخصی در GitHub قرار نمی‌گیرند. جابه‌جایی پروفایل، احراز هویت محسوب نمی‌شود. لیست کلینیک‌ها سرنخ‌های فایل‌های ورودی است و آگهی زنده یا تضمین پذیرش نیست.

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

- [راهنمای حساب‌ها، اتصال‌ها و دامنه](docs/SETUP.fa.md)
- [قوانین اصلی](docs/POLICY.md) · [شروع کار ایجنت‌ها](AGENTS.md)
- [طراحی و محدودهٔ نسخه](docs/superpowers/specs/2026-11-03-platform-design.md)
- [تحقیقات مسیرها](docs/research/)

Cloudflare hosting and a dedicated Supabase database with authenticated owner-scoped access are deployed. CV snapshots/TXT/DOCX, mail presets, drafts, contact browsing and educational practice are implemented. Real users must finish email verification. Gmail, Google Drive/Calendar, Telegram, AI and continuous external collectors remain disconnected; no email is sent by this app. The blocked mail queue and feed collector foundation are currently local-only. See docs/DEPLOYMENT.fa.md for verified status and remaining manual setup.
