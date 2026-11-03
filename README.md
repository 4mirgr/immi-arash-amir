# IMMI • Arash & Amir

دو فضای کاری برای مسیر پزشکی استرالیا: GP/PESCI دکتر آرش انتظار و مسیر تخصصی دکتر امیرهوشنگ گرامی.

**وضعیت: نسخهٔ آنلاین اولیه با ورود و دیتابیس مستقل، به‌علاوه اجرای محلی.**

[بازکردن سایت](https://immi-arash-amir.dr-gerami-md.workers.dev) · [وضعیت اتصال‌ها و ورود](docs/DEPLOYMENT.fa.md) · [فهرست تعهدات و باقی‌مانده‌ها](docs/STATUS.fa.md)

 فایل‌های شخصی در GitHub قرار نمی‌گیرند. جابه‌جایی پروفایل، احراز هویت محسوب نمی‌شود. لیست کلینیک‌ها سرنخ‌های فایل‌های ورودی است و آگهی زنده یا تضمین پذیرش نیست.

[بازیابی پروژه برای ایجنت بعدی](docs/RESUME.md) · [اهداف و وضعیت تمام بخش‌ها](docs/GOALS.md)

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

Cloudflare hosting and a dedicated Supabase database enforce independent doctor workspaces. Both Google accounts are connected. Public opportunity collectors are bounded; full all-state/unofficial coverage remains incomplete. LinkedIn planning, source-reviewed pathway/study/development plans and private action tracking are implemented; direct LinkedIn access still requires its own provider setup. See [current goals and boundaries](docs/GOALS.md), not historical deployment notes, for the recovery checklist.
