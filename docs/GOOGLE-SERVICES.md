# Independent Calendar and Drive adapters

`cloud/google-services.mjs` exports `handleGoogleServicesRequest(request, env, {userId,profileId}, fetcher)`. The authenticated Worker must derive this context from the app session, not request body. Unrelated routes return `null`; safe `GoogleError` failures are handled by the Worker. This module does not connect any Google account, run scheduled jobs, or make external writes during tests.

Prerequisites: the owner's independent verified Google grant from `google-oauth.mjs`, `GOOGLE_DB` server-only D1 binding, the OAuth configuration secrets, and application of `cloud/google-services-schema.sql`. Exact `calendar.events`/`drive.file` grants are checked before service access. Partial OAuth consent never implies permission to the missing service.

## Calendar

- `GET /api/google/calendar/events` synchronizes **one page of at most 50** primary-calendar events for the next 30 days. Optional ISO-offset `timeMin` and `timeMax` must both be supplied and span no more than 90 days.
- Response: `{events,partial,window,checkedAt,email}`. Each event has `{id,title,start,end,etag,updated,status}`. Times use Google's `{dateTime,timeZone}` or all-day `{date}` shape. The displayed title is plain text, not trusted HTML.
- If `partial:true`, repeat the same GET to continue the next provider page. Google page/sync tokens remain server-side. Subsequent requests use incremental sync tokens without prohibited time filters; a Google 410 expires only that owner's same-Google-identity cache/cursor and starts a bounded full refresh. Recurring instances are expanded using `singleEvents:true`.
- Cache/state/lease keys include **both app owner ID and verified Google subject**. Connecting a different Google identity does not reuse another identity's old events or cursor. Concurrent synchronization of the same identity has a lease and returns a 409 while busy. Cache rows may remain server-side after disconnect but cannot be returned without a current matching grant; automatic retention cleanup remains future work.
- `POST /api/google/calendar/events` accepts only `{summary,description?,start,end}`. Title max 300 characters; description max 10,000; valid IANA timezone and explicit-offset datetimes (or valid all-day dates); positive duration at most 90 days. It creates an event only on the connected account's primary calendar, with `sendUpdates=none`. Arbitrary organizer, attendees, conference and sharing fields are rejected. The operation requires an explicit UI action; no invitations are sent.
- `PUT /api/google/calendar/events/<id>` patches the same allowed fields. If either start/end changes, supply both. **`If-Match` must contain the exact quoted ETag from the read event**; absent precondition returns 428, provider 412 becomes 409 `event_changed`. A create/update returns `{event,refreshRequired:true}`; read again to update cache. No deletion endpoint exists.

This is request-driven two-way access, not a permanent background Calendar watcher. Exact synchronization requires completing all indicated pages. It is not a course recommender or automatic course enrollment.

## Drive

The `drive.file` scope grants access only to files created by or explicitly opened/authorized for this app. **It is not full access to all personal Drive files.** A Google Picker for granting access to additional existing files is not implemented.

- `GET /api/google/drive/files?pageToken=...`: at most 50 non-trashed app-authorized PDF, DOCX or plain-text files. Returns `{files,nextPageToken,scope:'app_authorized_files_only',email}` with bounded metadata fields.
- `GET /api/google/drive/files/<id>/download`: fetches metadata and content using this owner's token, permits PDF/DOCX/plain text only, enforces a 2MB byte limit before/during download, and returns a safe attachment filename and `Cache-Control:no-store`. Arbitrary server URLs are never accepted.
- `POST /api/google/drive/files`: explicit upload `{name,mimeType,base64}`, max 1MB decoded. Uploads only supported types to the connected account via explicitly encoded `multipart/related` upload (JSON metadata first, original binary bytes second, an explicit boundary and CRLF separators). Extra owner/sharing/permission fields are rejected; files are not made public. The response contains file metadata only.

Provider timeouts, error bodies and credentials are not passed to clients. Tokens are never returned by these routes. Browser UI should render provider text safely and use authenticated fetch for downloads.

## Verification

`node --test tests/cloud_google_services.mjs` runs synthetic SQLite D1 plus mocked Google HTTP tests. It verifies owner/subject/scope isolation, bounded incremental/calendar paging and 410 reset, event allowlists and ETags, app-scoped Drive listing, download/upload bounds, and sanitized failures. Upload tests parse the actual multipart parts, metadata and binary bytes; they do not merely accept a mocked success response. It makes no real Google request or write. Live consent and provider behavior must be verified after each owner's configuration and approval.

References used for the integration contract:

- https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- https://developers.google.com/workspace/calendar/api/guides/sync
- https://developers.google.com/workspace/calendar/api/v3/reference/events/patch
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
