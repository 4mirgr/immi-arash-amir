# IMMI • Arash & Amir

دو فضای کاری برای مسیر پزشکی استرالیا: GP/PESCI دکتر آرش انتظار و مسیر تخصصی دکتر امیرهوشنگ گرامی.

**وضعیت: نسخهٔ آنلاین اولیه با ورود و دیتابیس مستقل، به‌علاوه اجرای محلی.**

[بازکردن سایت](https://immi-arash-amir.dr-gerami-md.workers.dev) · [وضعیت اتصال‌ها و ورود](docs/DEPLOYMENT.fa.md) · [فهرست تعهدات و باقی‌مانده‌ها](docs/STATUS.fa.md)

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

- [اتصال Google هر پزشک — راهنمای فارسی](docs/GOOGLE-SETUP.fa.md)
- [راهنمای حساب‌ها، اتصال‌ها و دامنه](docs/SETUP.fa.md)
- [قوانین اصلی](docs/POLICY.md) · [شروع کار ایجنت‌ها](AGENTS.md)
- [طراحی و محدودهٔ نسخه](docs/superpowers/specs/2026-11-03-platform-design.md)
- [تحقیقات مسیرها](docs/research/)

Cloudflare hosting and a dedicated Supabase database with authenticated owner-scoped access are deployed. CV snapshots/TXT/DOCX, mail presets, drafts, contact browsing and educational practice are implemented. Real users must finish email verification. Independent Google OAuth, Gmail sync/ranking/queue/replies and Calendar/Drive adapters are implemented; live Google client credentials and separate owner consent are still required. No real Google operation is claimed before setup/testing. Telegram, AI and continuous external collectors remain disconnected. The legacy Python queue remains local-only; the authenticated cloud Google queue is separately implemented. Feed collection remains a foundation rather than a running comprehensive service. See docs/DEPLOYMENT.fa.md for verified status and remaining manual setup.
