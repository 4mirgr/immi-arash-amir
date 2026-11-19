# بازپردازش پیام‌های قبلی پس از اصلاح استخراج آگهی

این دستور عملیاتی خودکارِ ارسال نیست. پس از انتشار و آزمون parser جدید، فقط ورودی‌های قبلاً تکمیل‌شده را از cache همان صاحب صندوق/Google subject دوباره وارد صف خصوصی می‌کند. تاریخ اصلی دریافت پیام عوض نمی‌شود. history باید بعد از زمان پایدار انتشار جدید، کامل و بدون gap باشد. پیام حذف‌شده، Sent، Spam، Trash، Draft، cache گمشده/خراب یا منبع حذف‌شده برنمی‌گردد. این کار نباید پوشش کامل آرشیو نامیده شود.

پارامترها: صاحب دقیق صندوق، Google subject فعلی همان حساب، زمان تأییدشدهٔ پایداری parser بر حسب epoch میلی‌ثانیه، زمان اجرای سرور و اندازهٔ batch حداکثر ۲۰۰. از مقدارهای واقعی در Git استفاده نشود. پس از اجرا فقط شمارش و رسید ثبت شود؛ بدنهٔ cache یا payload چاپ نشود.

```sql
-- Read-only source cache -> private extraction queue; run only after the new parser is live.
-- Bind: owner-slot UUID[:secondary], Google subject, parser cutover UTC epoch ms,
--       operator-now UTC epoch ms, bounded batch size (e.g. 200).
WITH scope(owner_id,google_sub,cutover_at,run_at,batch_size) AS (
 SELECT ?,?,CAST(? AS INTEGER),CAST(? AS INTEGER),CAST(? AS INTEGER)
), eligible AS (
 SELECT i.owner_id,i.google_sub,i.gmail_id,m.data AS payload,
        f.history_last_synced_at AS observed_at,s.run_at
 FROM private_mail_opportunity_inputs i
 JOIN scope s ON s.owner_id=i.owner_id AND s.google_sub=i.google_sub
 JOIN google_mail_messages m ON m.owner_id=i.owner_id AND m.google_sub=i.google_sub AND m.gmail_id=i.gmail_id
 JOIN google_accounts a ON a.owner_id=i.owner_id AND a.google_sub=i.google_sub AND a.profile_id='arash' AND a.status='connected'
 JOIN google_mail_full_scan f ON f.owner_id=i.owner_id AND f.google_sub=i.google_sub
 WHERE i.profile_id='arash' AND i.status='completed' AND i.payload_json='{}'
   AND i.gmail_id<>'__history_gap__' AND i.lease_until<=s.run_at
   AND i.created_at<s.cutover_at AND i.updated_at<s.cutover_at
   AND m.updated_at>=i.created_at AND m.updated_at>=f.archive_started_at
   AND m.updated_at<=f.history_last_synced_at
   AND f.history_last_synced_at>=s.cutover_at AND f.history_last_synced_at<=s.run_at
   AND f.history_caught_up=1 AND coalesce(f.history_gap_since,0)=0
   AND f.history_recovery_active=0 AND f.gap_rescan_active=0
   AND f.history_pending_ids='[]' AND f.history_deleted_ids='[]'
   AND f.history_page_token IS NULL AND f.history_pending_target IS NULL
   AND coalesce(f.lock_until,0)<=s.run_at
   AND json_extract(CASE WHEN json_valid(m.data) THEN m.data ELSE '{}' END,'$.id')=m.gmail_id
   AND json_extract(CASE WHEN json_valid(m.data) THEN m.data ELSE '{}' END,'$.threadId')=m.thread_id
   AND json_extract(CASE WHEN json_valid(m.data) THEN m.data ELSE '{}' END,'$.direction')='received'
   AND json_type(CASE WHEN json_valid(m.data) THEN m.data ELSE '{}' END,'$.labels')='array'
   AND NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(m.data) THEN m.data ELSE '{}' END,'$.labels') label WHERE label.value IN ('SPAM','TRASH','DRAFT','SENT'))
   AND m.updated_at>=coalesce((SELECT gap.created_at FROM private_mail_opportunity_inputs gap WHERE gap.owner_id=i.owner_id AND gap.google_sub=i.google_sub AND gap.gmail_id='__history_gap__'),0)
   AND NOT EXISTS(SELECT 1 FROM private_mail_opportunities p WHERE p.owner_id=i.owner_id AND p.google_sub=i.google_sub AND p.gmail_id=i.gmail_id AND p.status='source_removed')
 ORDER BY m.message_date DESC,i.gmail_id LIMIT (SELECT batch_size FROM scope)
)
UPDATE private_mail_opportunity_inputs AS target
 SET payload_json=eligible.payload,status='queued',candidate_offset=0,lease_until=0,
     created_at=max(target.created_at,eligible.observed_at),updated_at=eligible.run_at
 FROM eligible
 WHERE target.owner_id=eligible.owner_id AND target.google_sub=eligible.google_sub
   AND target.gmail_id=eligible.gmail_id AND target.status='completed'
 RETURNING gmail_id,created_at,updated_at;
```

در ۱۹ نوامبر پس از انتشار `3494f297dee8f60685d44f89c78bc7cd6a3ddc83`، checkpointِ history پس از زمان پایداری ۰۹:۰۴:۵۰٫۸۱۴ UTC تأیید و ۱۳۲ ورودی cacheدار با این دستور دوباره صف شدند. ۳۵ حالت منع و حالت‌های مثبت/عدم تکرار و حفظ تاریخ اصلی در SQLite ساختگی آزموده شدند. ورود به صف، پایان پردازش نیست؛ پردازش عادیِ سرور ادامهٔ آن را انجام می‌دهد. اجرای دوباره با همان cutover موارد تکمیل‌شدهٔ بازپردازش‌شده را دوباره انتخاب نمی‌کند. برای parser آینده باید زمان انتشار واقعی و cache/history همان حساب دوباره بررسی شوند.

