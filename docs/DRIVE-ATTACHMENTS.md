# Own-account Drive attachments

The Google send preview supports one attachment: either the owner's immutable CV version or one selected PDF/DOCX/TXT file from the primary Google account's app-authorized Drive files. This does not grant access to all Drive files or implement Google Picker. Existing `drive.file` consent and Drive API activation remain necessary.

## API contract

- `POST /api/google/mail/preview`: existing content/recipient fields plus `driveFileId` (mutually exclusive with `cvVersionId`). No caller-supplied URL, bytes, sender, MIME type or file name is accepted.
- Server uses the selected primary account's grant against fixed Drive metadata/media endpoints, rejects redirects, inaccessible/trashed files, unsupported MIME/content, and files over 1,000,000 bytes. PDF/ZIP signatures and UTF-8 text validity are checked; this is not a malware scanner.
- Preview returns `attachment:{source:'google_drive',name,mimeType,size,hash}`. Names are sanitized for MIME headers. The active account is checked again after download.
- `POST /queue` must include `driveAttachmentHash` from that preview. Changed bytes/name/type reject with `drive_attachment_changed_review_required`. No file is queued without a fresh server-side comparison.
- Queued Drive MIME is an immutable owner-bound AES-GCM envelope in the private D1 queue. Dispatch decrypts this snapshot and never downloads a newer file. Legacy queued plaintext CV messages remain compatible; this change does not silently migrate old rows. Preserve `GOOGLE_TOKEN_KEY` in backups and deployment.
- Raw MIME is capped at 1,400,000 bytes to keep encrypted values within D1 bounds. A near-limit file plus a long body can exceed this cap and must be reduced.
- Secondary Gmail does not borrow the primary Drive grant; direct Drive attachment selection there is disabled. Own CV-version attachments remain available to that sender.

## Root-owner suppression

`mail_automation_suppressions` is required (apply `cloud/mail-automation-schema.sql` before deploying). Preparation excludes recipients suppressed by the authenticated root owner, regardless of chosen mailbox. Dispatch checks the same rule atomically during its claim. The existing suppression action stores a root-level suppression and suppresses queued messages in both that doctor's sender slots; it never changes the other doctor's queue.

Adding to the queue does not send. Existing explicit recipient/identity/CV preview, quota and dispatch controls remain. Browser previews and queue displays are pinned to the current person/mailbox/provider email; a late response cannot move an attachment or sender preview into another slot.

## Checks

`tests/cloud_drive_attachments.mjs` uses synthetic credentials and provider responses to verify owner/scope restrictions, preview-to-queue integrity, immutable encrypted content, size/type rejection, redirect refusal, reconnect races, tampered ciphertext and cross-mailbox suppression. Existing send and secondary-router regressions remain passing. Browser checks exercise the actual component, including hash forwarding, attachment exclusivity and secondary UI restrictions. No real message was sent by these checks.
