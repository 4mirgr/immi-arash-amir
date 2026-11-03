# Amir's second Gmail mailbox

An additional mailbox is available only to the authenticated Amir workspace. Its configured address is stored in the server-only `GOOGLE_SECONDARY_EMAIL` binding, never in public source/config. It needs its owner's separate consent; deploying the adapter does not connect an account.

## Runtime contract

The authenticated Worker must call `googleAccountContext(request,{userId,profileId,rest})` before **every** `/api/google/*` private handler. The optional query `mailbox=primary|secondary` chooses an authorized slot, not an owner. Default/primary preserves the original user ID and encryption binding. Secondary is refused for Arash and maps to the trusted user's ID plus `:secondary`, with `rootUserId` retained separately. Repeated/invalid mailbox selectors fail. Calendar and Drive remain primary-account services.

Existing paths remain unchanged: `status`, `start`, `disconnect`, `mail/messages`, `mail/sync`, `mail/extract-contact`, and the mail queue paths receive `?mailbox=secondary` when selected. The callback's state records the selected storage identity; the browser cannot change it with callback query parameters. The secondary start requests only OpenID/email/profile and Gmail read/send scopes. A login hint is only convenience; callback must enforce a verified exact match with the configured secondary address. The same Google subject cannot bind to another account slot/workspace.

All Google D1 rows use the selected server-derived identity: encrypted grant, OAuth states/diagnostics, message cache, synchronization cursor, send queue and suppression state. Existing tables and primary data need no migration or deletion. Secondary failure/revocation cannot activate or invalidate the primary grant. There is no primary fallback. CV/preset lookup through the original authenticated `rest` closure still uses the actual doctor's profile and RLS, independent of sender choice.

`POST /api/drafts` is outside the Google router: reply drafts must explicitly validate/persist the selected mailbox and derive original-message routing with the matching scoped Google ID. Queue preview/dispatch must use that saved/selected slot. Foreign or unconnected secondary replies must fail rather than search the primary account.

## Owner setup

1. Retain the existing Google OAuth client and primary connection. No new paid project is required.
2. In Google Auth Platform → Audience → Test users, add the requested second Gmail address while the app is in Testing.
3. Ensure the server-only `GOOGLE_SECONDARY_EMAIL` binding is configured to that same verified address.
4. In Amir's mail panel select the second mailbox and start Google consent; select the configured second Google account and authorize Gmail scopes.
5. Confirm the second account's own address/status and run its initial mail sync. Do not disconnect/reconnect the primary account to add another one.

A Testing OAuth application can require consent renewal under Google's token policies. The dashboard must show each slot's own state; one account's expiration must not hide the other mailbox or borrow its sender. This implementation does not claim either account has completed an actual send/reply test.

## Verification

`tests/cloud_google_accounts.mjs` covers authorized slot selection; Arash/duplicate selector denial; primary-grant preservation; independent encryption; Gmail-only requested scopes; wrong secondary identity rejection; missing setup/grant without fallback; global Google-subject uniqueness; identical Gmail-ID cache isolation; and isolated revocation/disconnect. Existing OAuth tests remain unchanged and passing.
