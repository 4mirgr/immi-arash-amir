# Telegram notifications — independent owner chats

This adapter is implemented but is not connected merely because code is deployed. It sends no message until the owner links a private Telegram chat and explicitly enables notifications. It never sends email or publishes a LinkedIn post. Initial historical records are not broadcast on activation.

Project bot: **[@AUSPlanAlertsBot](https://t.me/AUSPlanAlertsBot)** (username supplied by the owner; live identity is verified through `getMe` during setup). This public link opens the bot but does not bind a website account. Fresh private binding links must be generated inside each doctor’s authenticated workspace, never shared between doctors.

All outgoing opportunity and test messages address the recipient by the trusted stored profile: «دکتر آرش انتظار عزیز،» or «دکتر امیر هوشنگ گرامی عزیز،». Display names submitted in messages or browser input are not used.

## Free owner setup

1. In Telegram open the verified **@BotFather**, send `/newbot`, and choose the project's bot name and a free username ending in `bot`.
2. Save the resulting bot token directly in Cloudflare Worker Secrets as `TELEGRAM_BOT_TOKEN`. Do not paste it into chat, GitHub, screenshots or public configuration.
3. The project operator generates a random URL-safe secret of at least 32 characters and stores it as `TELEGRAM_WEBHOOK_SECRET`. The webhook URL is fixed by the server: optional `TELEGRAM_WEBHOOK_URL` defaults to `https://immi-arash-amir.dr-gerami-md.workers.dev/api/telegram/webhook`. Update that server setting only when deliberately moving the canonical domain.
4. Apply `cloud/telegram-notifications-schema.sql` to the private `GOOGLE_DB` binding. It contains chat bindings, one-use hashes and receipts; it does not belong in the shared public opportunities database.
5. Amir opens the Telegram settings panel and explicitly clicks **ثبت وب‌هوک همین سایت**. This verifies the bot with `getMe` and calls `setWebhook` with the fixed URL, private verification secret and message-only updates. It does not send a message. Existing bot pending updates are dropped to avoid processing old link messages. Setup is not available to Arash or with a caller-supplied destination URL.
6. Each doctor signs into their own website account, creates their own one-use link, opens it in their own Telegram, and presses **Start**. The link lasts ten minutes and is not meant to be shared. The site polls status; the bot does not automatically send a linking-confirmation message.
7. Back in the site, each owner explicitly enables new-opportunity notifications and saves their quiet hours. A separate **ارسال یک پیام آزمایشی به چت خودم** button sends one test only when the chat is linked and notifications enabled.

A single private chat cannot be assigned to both doctors. Doctor accounts do not borrow the other's destination or notification settings. Connecting a chat does not establish a professional identity or verify credentials.

## API and integration

- Call `handleTelegramWebhook(request,env)` for `/api/telegram/webhook` **before** application bearer checks, because Telegram has no application JWT. The handler requires `X-Telegram-Bot-Api-Secret-Token` matching the server-only secret, a supported private chat and the same numeric sender/chat ID. It does not trust a browser-supplied owner or chat ID.
- Call `handleTelegramRequest(request,env,{userId,profileId},fetcher)` after verified application membership for `/api/telegram/*` private routes. Optional `?profile=` must match the trusted owner profile. POST origin and payload keys are checked.
- `GET /api/telegram/status`: configured/connected/enabled flags, masked chat suffix, quiet hours/timezone, verified bot username, fixed-webhook setup state and limits. Missing configuration is explicit. No token, secret, nonce hash or full destination is returned.
- `POST /api/telegram/setup-webhook {}`: Amir-only fixed-destination registration. `getMe` and `setWebhook` are provider setup operations, not messages. A changed token, verification secret or webhook URL invalidates the local registration fingerprint and requires explicit registration again.
- `POST /api/telegram/link-code {}`: returns the fresh deep link and expiry. A hashed nonce binds the trusted user/profile. A later own link invalidates the prior pending link.
- `POST /api/telegram/settings {enabled,quietStart?,quietEnd?}`: linked owner only. Hours are integers 0–23 in **Asia/Tehran**; equal hours disable quiet time. Enabling sets a new watermark, so past records are not silently replayed.
- `POST /api/telegram/test {}`: an explicit test to the saved own chat, subject to the same daily quota. It returns provider-evidenced `sent`, `failed`, `cancelled` or terminal `delivery_unknown`; uncertainty is not retried automatically.
- `POST /api/telegram/disconnect {}`: deletes only the caller's chat binding and pending link codes. Receipts remain a private audit trail. It does not claim Telegram provider-side revocation.
- Telegram command `/stop` or `/unsubscribe` from the verified own private chat removes the binding even if application login is unavailable.

No endpoint accepts an arbitrary recipient, destination URL, owner ID or message body. Provider HTTP redirects use Workers-supported `manual` and are rejected without forwarding bot credentials. Errors never include provider response text or token-bearing URLs.

## Scheduled behavior

`dispatchTelegramNotifications(env,fetcher,now)` is called by the application's real scheduler. With missing bot secrets it exits before touching private storage. It selects only linked+enabled owner records, excludes quiet hours, and looks for new PUBLIC opportunity editions after that owner's activation time. AU/both is available to each owner; Arash receives job records only (academic/funding records are excluded); Italy/Amir records remain Amir-only.

Each run can attempt **at most three sends globally**. Each owner has an atomic **ten-attempt daily cap**, including explicit tests, on Tehran calendar days. Catch-up is bounded to the latest seven days. Candidate searches exclude receipts already claimed, preventing the oldest ten records from starving later pages. The payload contains only the public title, location, recorded deadline/unknown-deadline label and original HTTPS source link. No private mail, CV, notes, profile facts or contact extraction is sent.

A unique `(owner,event_key)` claim precedes transport. `sent` requires a successful Telegram response and a valid provider message ID. Timeout, network exception, ambiguous acknowledgment or storage uncertainty never trigger automatic retry. Connection/settings changes before transport cancel a claim. Provider 403 disables future automatic notifications for that chat. Users should inspect their chat before repeating any uncertain explicit test.

The schedule follows collector availability and cooldowns; this is not a guarantee of immediate delivery. The adapter adds at most about 16 D1 queries at the worst two-owner/three-send case, so the root scheduler must keep total invocation query and subrequest budgets within the deployed free plan. No background messaging happens while the adapter remains unconfigured or notifications disabled.

## Verification

`node --test tests/cloud_telegram.mjs` uses synthetic Telegram and SQLite fixtures. Tests cover owner/origin/payload controls, hashed expiry/replay links, private-chat requirement, chat uniqueness, explicit setup, per-owner quotas, Italy isolation, global run budget, Tehran quiet time, activation watermark, no retry after ambiguous delivery, redirect rejection, unsubscribe and absent-configuration early exit. These tests are not proof of a real bot connection or a real message delivery.

Public provider references: https://core.telegram.org/bots/api#setwebhook · https://core.telegram.org/bots/features#deep-linking · https://core.telegram.org/bots/api#sendmessage

Official Bot API content was read on 2026-11-03 to verify secret-token character rules, allowed updates, fixed webhook setup and current `link_preview_options` send parameters. No bot credentials or real chat were used.
