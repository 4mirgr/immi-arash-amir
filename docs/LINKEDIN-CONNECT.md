# Optional LinkedIn connection and explicit publication

This module adds a real provider adapter behind configuration and user consent. Merely shipping this code does not mean either doctor's LinkedIn account is connected or that API access has been approved. It never edits profile headline/About/experience, fetches private connections, reads full personal analytics or publishes from a cron. The separate LinkedIn workspace offers manually sourced metrics, copyable suggestions and manual-publication scheduling.

## Owner setup

1. In https://www.linkedin.com/developers/apps create an app for this website. LinkedIn may require association with an organization LinkedIn Page and verification by its administrator. These are LinkedIn product prerequisites, not permissions supplied by ChatGPT.
2. Request/enable **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn** in the app's Products. Confirm its Auth tab actually exposes `openid profile email w_member_social`; product availability/approval can vary.
3. Add this exact redirect URL: `https://immi-arash-amir.dr-gerami-md.workers.dev/api/linkedin/callback`.
4. Add Cloudflare encrypted secrets `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`; add `LINKEDIN_REDIRECT_URI` matching the URL above. Preserve the existing `GOOGLE_TOKEN_KEY` and private `GOOGLE_DB` binding. Tokens use a distinct `linkedin:<owner_id>` authenticated encryption binding and separate tables; they never use the other doctor's or Google's grant.
5. Each doctor signs into their own application workspace, clicks Connect LinkedIn, selects their own LinkedIn account and reviews consent. A single LinkedIn identity cannot be assigned to both owners. A shared developer app does not merge private identities.
6. Confirm the returned account name/email and exact publish capability. Actual returned scopes are recorded; missing scope does not silently enable publication. Email is displayed only if LinkedIn's userinfo marks it verified. OIDC identifies an account; it is not verification of professional credentials.

The standard confidential server authorization-code flow follows LinkedIn's documented web flow. A random state and Secure/HttpOnly/Lax browser cookie bind the callback. State is hashed, expires after ten minutes, and is consumed atomically. No undocumented PKCE parameter is assumed for this flow. Access tokens are encrypted at rest. Ordinary self-service refresh-token access is not assumed; expiry requires reconnecting. Local disconnect immediately deletes the grant, but does not claim provider-side revocation; users can also remove the app through LinkedIn account settings.

## API contract

After the application's verified member check, call `handleLinkedInOAuthRequest(request,env,{userId,profileId},fetcher)` **before** the general LinkedIn workspace router. Unknown paths return null.

- `GET /api/linkedin/connection`: `{configured,connected,status,name,email,canPublish,expiresAt?,capabilities,missing?}`. Analytics, direct profile editing, graph sync and automatic publication remain false.
- `POST /api/linkedin/connect`: returns `{authorizationUrl}` plus the host-only browser cookie. Keep the main application's memory-only session open; use a popup and poll connection status.
- `POST /api/linkedin/disconnect`: owner-only deletion and `{connected:false,providerRevocationConfirmed:false}`.
- `POST /api/linkedin/publish {postId}`: **explicit text-only publication** of an existing owner-saved post. No caller-supplied author, recipient, body or owner is accepted. It snapshots the post's content hash and current author identity, refuses already self-reported published records and checks the connection again before transport. It uses the Posts API, `w_member_social`, `LinkedIn-Version: 202610` (override using `LINKEDIN_API_VERSION` when current supported-version requirements change), and `X-Restli-Protocol-Version: 2.0.0`.
- Result: `{postId,status,providerUrn,reused,automaticPublishing:false}`. Only HTTP 201 with a valid provider post URN is `published`. A 4xx rejection is terminal `failed`; 5xx, timeout or missing acknowledgment is terminal `delivery_unknown`. A failed persistence acknowledgment leaves the attempt nonretryable. Repeated calls for the same saved post never send again. Each owner is limited to five attempts per UTC day.
- `GET /api/linkedin/publications`: `{publications:[{postId,status,providerUrn,createdAt}]}`, last 100 owner-scoped attempts. Provider evidence is separate from the workspace's `published_by_user` report; it must not be mislabeled as a manual report.

Call `handleLinkedInOAuthCallback(request,env,fetcher)` only for the exact callback path **before** app bearer handling. It validates browser state, exchanges the code server-side, obtains the current provider subject through userinfo and stores the encrypted grant. It returns safe fixed completion/error HTML without provider responses, authorization code, cookies or credentials.

## Explicit limits

- No publication happens on login, connection, recommendation generation, draft saving, manual scheduling or a background collection job. Scheduling remains `scheduled_for_manual_publication`; automated scheduled publication is not implemented by this module.
- Images generated by the client workspace are for download/manual upload. This first provider adapter only publishes text; it does not silently drop an attached image into a text-only workflow.
- Basic OIDC and Share products do not provide arbitrary profile edits, connection export, profile-view statistics or all post analytics. Those require additional products/permissions and sometimes approved partner access. No missing statistic is represented as zero.
- Never treat mocked tests as a successful real LinkedIn connection/publication. Verify capabilities and make a controlled user-approved publication only after actual product access and consent.
- Before removing a user's app membership, remove or revoke its corresponding integration grant as part of account lifecycle operations. This module contains no background sender.

## Verification

`node --test tests/cloud_linkedin_oauth.mjs` uses synthetic tokens and SQLite-backed D1. Tests cover missing setup, cookie/state/replay, distinct owners, duplicate provider identity, actual scopes, expiry, foreign post IDs, forbidden author/content injection, daily quota, provider acknowledgment, uncertain outcomes, owner-private history and concurrent publication claims. No real social post is sent by these tests.

Official references retrieved 2026-11-03:

- https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
- https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
- https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-10

The Share guide explicitly points to OIDC for the member identifier used to construct a person URN. Product approval and API-version support must be checked again at live setup.
