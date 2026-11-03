# Independent Google connections

The website's Google OAuth connection is separate from ChatGPT's Gmail/Calendar/Drive connectors. Each doctor signs in to the website first and then authorizes a distinct Google account. One shared Google OAuth client may serve both; Google grants, sender identities, inbox data and queues must remain isolated by the verified application owner. The database enforces a unique Google subject across the two owners.

## Runtime configuration

Cloudflare Worker bindings:

- `GOOGLE_DB`: dedicated server-only D1 database, initialized using `cloud/google-schema.sql` plus the other Google modules' schemas.
- `GOOGLE_CLIENT_ID`: Web application OAuth client ID.
- `GOOGLE_CLIENT_SECRET`: Cloudflare encrypted secret, never a frontend variable or git file.
- `GOOGLE_TOKEN_KEY`: Cloudflare encrypted secret containing base64 of 32 cryptographically random bytes; used for AES-256-GCM. Losing/changing it requires reconnecting stored Google accounts. Keep it across deployment; do not print it.
- `GOOGLE_REDIRECT_URI`: `https://immi-arash-amir.dr-gerami-md.workers.dev/api/google/callback`

The coordinator provisions bindings and secrets; the module does not create Google projects or claim a connected mailbox without a successful callback.

## Google Cloud setup that requires the account owner

1. Select/create a Google Cloud project for this website; no paid compute service is needed for OAuth.
2. Enable Gmail API, Google Calendar API and Google Drive API in [API Library](https://console.cloud.google.com/apis/library).
3. In [Google Auth Platform](https://console.cloud.google.com/auth/overview), configure Branding and Audience. Choose External for accounts outside a Google Workspace organization. For Testing, add the actual Google emails of **both doctors** as test users. The connected website login email and selected Google mailbox may differ only through that owner's explicit consent.
In Data Access, add the scopes listed below (Gmail read/send, Calendar events, Drive file, and OpenID identity); Google may classify Gmail read access as restricted.
4. Create a **Web application** OAuth client. Authorized redirect URI must exactly match the value above. The website origin is `https://immi-arash-amir.dr-gerami-md.workers.dev`.
5. Store the client ID and secret in this Worker's bindings/secrets through Cloudflare; do not paste the secret into chat, a source file or a browser bundle. The UI reports only the names of missing configuration values.
6. Each doctor opens their own website workspace and clicks Connect Google. Keep the website tab open; OAuth opens in a separate window so its memory-only app session is preserved. Choose that doctor's Google account, review the requested scopes and consent. Return to the original workspace after the popup reports success.
7. Confirm the displayed connected Google email belongs to that doctor before syncing mail or preparing sends. Repeat separately in the other doctor's account. A shared mailbox cannot be connected to both workspaces.

Testing apps that request these scopes may have refresh tokens expiring after seven days; reconnect is then required. Google may display an unverified-app warning, limit test users or require OAuth verification before production use. Restricted Gmail scopes can introduce additional verification/security requirements; enabling APIs alone does not complete that review. No perpetual free/unrestricted access is promised.

## Scope boundaries

Initial requested scopes: OpenID identity (`openid email profile`), `gmail.readonly`, `gmail.send`, `calendar.events`, and `drive.file`. No Gmail modify/delete scope is requested. `drive.file` covers files created/opened with this app, not arbitrary full Drive access. Further access must be an explicit incremental consent change. The callback stores the actual granted scopes; status returns capability flags so partial consent never falsely enables every service. Each consuming module must check its required scope before calling Google.

## HTTP and internal contracts

- After app authentication: `handleGoogleRequest(request,env,{userId,profileId},fetcher=fetch)` handles GET `/api/google/status`, POST `/api/google/start`, POST `/api/google/disconnect`, returning a Response or `null` for other paths.
- `/start` returns `{authorizationUrl}` and a Secure/HttpOnly/SameSite=Lax host-only binding cookie. It must be fetched in the same browser; send the returned URL to the popup. No client secret, code verifier or token is returned.
- `/status` returns `{configured,connected,status,email,scopes,capabilities,missing?}`; capability keys are `gmailRead`, `gmailSend`, `calendar`, `drive`. `connected` means an accepted stored grant exists, not proof that every external service request will succeed. Expired/revoked refresh tokens become `reconnect_required` on access.
- `/disconnect` deletes only the authenticated owner's local grant/states first, attempts Google's revocation endpoint, and returns `{connected:false,status:'not_connected',revocationConfirmed}`. Local sending is blocked even if provider revocation cannot be confirmed. It does not alter the other doctor's grant.
- Before app bearer handling: `handleGoogleCallback(request,env,fetcher=fetch)` consumes a one-use, ten-minute, browser-bound state and PKCE verifier, exchanges the authorization code server-side, verifies Google's `sub` and `email_verified` through Google's userinfo endpoint, and stores encrypted tokens. It returns a generic safe HTML completion/error page with no code or credential details.
- Server modules only: `getGoogleAccess(env,userId,fetcher=fetch)` returns `{accessToken,email,subject,scopes}` and refreshes at a 60-second margin. Never return this object to frontend code or logs.
- `googleStatus(env,userId)` reads public-to-owner metadata only, without refreshing access tokens.
- Safe thrown error type: `GoogleError` with `status`, `code`, and sanitized message. Callers must preserve this distinction from generic internal errors without exposing provider response bodies.

Tokens and PKCE verifiers are encrypted with random 96-bit AES-GCM IVs and authenticated owner bindings. Stored state is hashed and consumed atomically. Google subject uniqueness prevents account reuse across doctors. Refresh writes and reconnect-required status transitions use compare-and-swap on the original Google subject and ciphertext to avoid overwriting or invalidating a newer grant; a concurrent disconnect/replacement is checked before returning access. Private email metadata is never automatically added to shared clinic records.

## Verification

`node --test tests/cloud_google_oauth.mjs` uses synthetic grants and SQLite-backed D1. It verifies secure PKCE state/cookies, expiration/replay, wrong-browser rejection, verified-identity requirements, owner-bound encryption, distinct Google account ownership, refresh/revocation and disconnect isolation. Mocked tests do not prove live consent/API access. Live OAuth verification requires the owner-provided Google client and separate consent by each doctor.

Official references retrieved 2026-11-03:

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/openid-connect/openid-connect
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/identity/protocols/oauth2#expiration
