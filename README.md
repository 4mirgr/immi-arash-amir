# IMMI • Arash & Amir

دو فضای کاری برای مسیر پزشکی استرالیا: GP/PESCI دکتر آرش انتظار و مسیر تخصصی دکتر امیرهوشنگ گرامی.

**وضعیت: پایهٔ محلی قابل اجرا؛ سامانهٔ آنلاین تولیدی نیست.** فایل‌های شخصی در GitHub قرار نمی‌گیرند. جابه‌جایی پروفایل، احراز هویت محسوب نمی‌شود. لیست کلینیک‌ها سرنخ‌های فایل‌های ورودی است و آگهی زنده یا تضمین پذیرش نیست.

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

Gmail, Google Drive/Calendar, Telegram, AI, cloud database, production login and live external job collectors are not connected in this version. Only local imports, browsing, persisted drafts and educational practice are available. Ten-second refresh polls the local database, not external websites. No email is sent.
