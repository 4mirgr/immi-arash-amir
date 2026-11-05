# پشتیبان‌گیری؛ وضعیت فعلی و روش کار

## توضیح کوتاه برای کاربر

در سایت می‌توانید یک فایل رمزگذاری‌شده از بخش‌های مجاز اطلاعات همین حساب دریافت کنید و روی دستگاه خود نگه دارید. گذرواژه در مرورگر استفاده می‌شود؛ برای سرور ارسال و در حساب ذخیره نمی‌شود. این فایل محدود است و پشتیبان همهٔ پیام‌ها، فایل‌های Drive، اعتبارنامه‌ها یا تمام سرویس‌ها نیست. پیش‌نویس‌های ذخیره‌شده می‌توانند داخل آن باشند. اگر خروجی بخشی محدود شده باشد، خلاصهٔ فایل آن را نشان می‌دهد.

«بررسی فایل» فقط آن را با گذرواژه روی دستگاه باز و قالب و پروفایل ثبت‌شده را کنترل می‌کند؛ اطلاعات سایت را تغییر نمی‌دهد و چیزی به پایگاه داده برنمی‌گرداند.

**پشتیبان خودکارِ سرور در مقصد جداگانه هنوز راه‌اندازی کامل نشده است.** برای آن باید محل نگه‌داری نسخه‌ها، حفاظت مستقل از کلید، برنامهٔ تهیهٔ نسخه و گزارش خطا مشخص شود. سپس لازم است بازیابی را روی یک نسخهٔ جدا و آزمایشی از سامانه امتحان کنیم: آیا اطلاعات کامل برمی‌گردند، دو حساب همچنان جدا هستند و زمان‌بندی‌های قدیمی ناخواسته فعال نمی‌شوند؟ این آزمون نباید روی اطلاعات اصلی سایت انجام شود. در توضیح‌های فنی بعدی، «staging» همین نسخهٔ جدا و آزمایشی است.

داشتن کد در GitHub، فایل دانلودشده یا امکان بازیابی داخلی یک سرویس به‌تنهایی به معنی تکمیل این روند نیست. یک کپی جداگانه و امن لازم است؛ نگه‌داشتن همهٔ نسخه‌ها و کلید روی همان دستگاه کافی نیست. این سند، راه‌اندازی واقعی ذخیره‌سازی بیرونی یا اجرای منظمِ موفق را ادعا نمی‌کند.

## راهنمای فنی ابزارهای موجود

These tools encrypt explicitly prepared structured exports. They do not query cloud accounts, collect arbitrary files, schedule a service, upload data, create users or restore production databases. No real production backup or automatic weekly schedule is claimed merely because these scripts exist.

## Cryptography and custody

Install the optional pinned dependency in a dedicated environment:

```sh
python -m pip install 'cryptography==50.0.0'
```

The current execution environment already has this version. Core archive-validation tests require only the Python standard library; encrypted round-trip tests explicitly skip when the optional package is absent. CI should install the pin to exercise every test.

Format V1 uses AES-256-GCM authenticated encryption, a random 16-byte salt, a random 12-byte nonce, scrypt (`N=32768,r=8,p=1`) and authenticated version metadata. Each export also carries a SHA-256 manifest. The manifest, filenames, timestamps and scope are inside the ciphertext. This is authenticated encryption, not an unencrypted ZIP or a password-protected filename. A unique strong passphrase is essential; use a password manager and keep its recovery independently from the backup. A lost passphrase cannot be recovered by these tools.

Passwords are accepted only through an interactive hidden prompt or an already-open descriptor with `--password-fd`. They are not accepted as command arguments or environment variables and are never printed. Do not paste passphrases into chat, shell history, GitHub or source files. Noninteractive automation must obtain its descriptor from an approved secret manager rather than hardcoding a password.

## Prepare authorized exports

Use the connected administrative interface or an authorized owner session to export only the selected scope's JSON rows into an ignored, access-restricted folder such as `private/backup-exports/amir/`. Keep Amir and Arash exports distinct. The scope flag is a declared boundary, **not** authorization or content-based owner verification: the caller must enforce ownership when exporting rows.

Include the relevant private Postgres profile/planning, memberships, settings, CV snapshots/defaults, presets/defaults and drafts; include corresponding D1 private account/mail/queue/LinkedIn/planning/practice/automation records as needed. Public opportunity data can be backed up separately or re-collected. Export schema versions and source/project identifiers into JSON too. Preserve UUIDs, profile IDs, record relationships, immutable version IDs and provider identity bindings. Do not treat a generic `all` export as suitable to hand to either individual doctor.

The tool accepts UTF-8 JSON objects/arrays only, up to 128 files, 8 MiB per file and 16 MiB total raw data. It rejects symlinks, non-JSON files, duplicate JSON keys and traversal/nonportable archive paths. It does **not** include PDF/DOCX/photos/Drive files automatically. Back those up using an independently reviewed encrypted storage workflow or export their contents as appropriately bounded JSON outside this tool.

Encrypted Google/LinkedIn grants need the original `GOOGLE_TOKEN_KEY` and owner/subject binding after a disaster. Keep the encryption key and provider app secrets in an independent approved secret vault. They are not recoverable from publishable config or encrypted grants, and must not be committed with the code. If the key/identity mapping cannot be recovered safely, reconnect the relevant provider accounts; never substitute the other doctor's tokens.

## Create an encrypted backup

Create the destination parent folder yourself, then run:

```sh
python scripts/backup_private.py private/backup-exports/amir private/backups/amir-2026-11-03.imbackup --scope amir
```

The script asks for the passphrase twice, encrypts in memory, writes a new mode-0600 file, and refuses to overwrite any existing backup. Input files are unchanged. The equivalent scopes are `arash` and explicit administrative `all`; do not choose `all` by default. Keep plaintext exports in protected ignored storage only as long as necessary for the approved operation.

## Verify without writing any restored data

```sh
python scripts/restore_private.py private/backups/amir-2026-11-03.imbackup --scope amir
```

Default operation authenticates/decrypts, verifies every manifest/hash/path/scope and reports only a count. It writes no files and does not display CVs, messages, addresses, grants or passwords. Wrong passphrase, modified ciphertext, wrong scope or invalid manifests fail before extraction.

## Explicit local extraction

```sh
python scripts/restore_private.py private/backups/amir-2026-11-03.imbackup --scope amir --apply --target private/restore-review/amir-2026-11-03
```

The parent directory must already exist; the target must be new. Extraction creates private directories/files and never overwrites existing contents. It does not import a database or contact any remote service. An I/O failure may leave a partial newly created local review folder; no existing production data is removed to compensate.

Production recovery is a separate reviewed process: create an isolated staging database, verify schema compatibility and counts, preserve authenticating owner UUIDs/RLS/provider subject bindings, test both owner isolation and token readability, then make a concrete production restoration plan. Never point these scripts at production credentials or run an automatic destructive import. Rebinding one doctor's rows/grants to another identity is not a recovery strategy.

## Cadence and actual outstanding work

Recommended starting policy: encrypted exports weekly (for example Sunday 02:00 Tehran), before migrations and before restoring/importing private data. Keep several dated generations in a separate owner-controlled encrypted destination. Test recovery with synthetic data regularly and perform an authorized real staging restore before claiming disaster recovery is complete.

An unattended weekly job still requires a persistent execution environment, authorized database export access, a durable destination, controlled retention, secret custody and a failure notification channel. None is inferred from a local script or a CI checkout. Do not place private exports or encryption passwords in GitHub artifacts, unencrypted email or an unrestricted shared Drive folder. Cloudflare D1 recovery features and GitHub source history are useful additional layers; source history is not a backup of private Postgres/D1 records or provider credentials.

## Checks

```sh
python -m unittest tests.test_private_backup -v
```

The synthetic tests cover authenticated randomized round trips, Unicode contents, wrong-password/tamper/scope rejection, hash/path validation, symlink refusal, local permissions, no-overwrite behavior and dry-run-before-explicit-apply. They use synthetic local data and never write to a production account.

## Site download and local verification

The owner-authenticated site also exposes a separate browser workflow through `OwnerBackup`: it receives a bounded owner-only export, encrypts it locally with WebCrypto AES-256-GCM, a random 16-byte salt, random 12-byte IV and PBKDF2-SHA256 (250,000 iterations), and downloads a `.json.encrypted` file. The passphrase requires at least 16 characters, is confirmed for creation, is never transmitted to the export endpoint, and is cleared after a successful operation or account change. The application does not retain it.

The browser export excludes provider credentials and cached received Gmail message bodies. Saved email drafts and other selected private owner records can be present. The API limits each table/export; `coverage.truncatedTables` must be shown explicitly. Even an export with no reported truncation is not a full backup of every provider, file or database. Provider reconnection remains necessary. The browser verifies only the encrypted export's declared profile and format; server-side owner filtering is the authorization boundary.

Opening an existing browser backup performs local decryption and a count/coverage summary only. No file or passphrase is uploaded, no production import is available, and a different profile is rejected. Keep the passphrase in a secure password manager separately from the file. Forgotten passphrases cannot be recovered by this application.

The browser JSON envelope (`masir-browser-backup`, PBKDF2/AES-GCM) and Python archive (`IMMI-PRIVATE-BACKUP-V1`, scrypt/AES-GCM) are **different formats** and are not interchangeable. Use the browser's verify-only action for browser files and the Python script for Python files. A future cross-format migration must explicitly validate both formats and owner boundaries; do not rename extensions and assume compatibility.

Browser exports include owner publication/delivery fingerprints and suppression metadata where available, without raw Gmail MIME. Scheduled-send approvals are intentionally excluded and must be re-reviewed after any recovery; restoring files must never reactivate timed sends automatically.
