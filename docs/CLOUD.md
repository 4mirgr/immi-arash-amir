# Authenticated cloud adapter

`cloud/worker.mjs` is a separate cloud backend; the loopback Python demo remains local. The cloud Worker never falls back to demo profiles or local private files.

## Runtime contract

- `SUPABASE_URL`: HTTPS origin for the dedicated project.
- `SUPABASE_PUBLISHABLE_KEY`: publishable API key (not a service-role/secret key). These values may be returned to the login UI; Supabase authorization is enforced by user JWT plus RLS.
- `ASSETS`: Cloudflare Workers Static Assets binding for the built `dist` directory.
- `GET /api/public-config` → `{mode:'cloud',authRequired:true,supabaseUrl,publishableKey}`. No session needed.
- `GET /api/health` → cloud-auth mode indicator; does not assert database health, an authenticated user or external integration connectivity.
- All other API routes require `Authorization: Bearer <Supabase user access token>`. The Worker asks `/auth/v1/user` to validate it on every request, then loads the user's administrative workspace membership. Anonymous or unprovisioned users have no access. A supplied foreign profile query or body is rejected.
- `GET /api/me` → `{profileId,userId}`.
- `GET /api/bootstrap` → `{mode:'cloud',currentProfileId,profileId,profiles:[ownProfile],clinics,settings,stations,integrations}`.
- `GET /api/clinics`, `/api/profiles`, `/api/stations`, `/api/drafts`, `/api/settings` preserve the local UI shapes; profiles/drafts/settings are owner-scoped. Contact listing is capped at 20,000 records and batch-fetched in pages of 1,000; imported contacts remain unverified leads.
- `POST /api/drafts` → same `{profileId,clinicIds,subject,body}` shape, persisted with the authenticated owner. It only creates `status:'draft'`.
- `PUT /api/settings` stores bounded typed preferences. `auto_after_connection` is a preference, never an active sender.

Cloud endpoints also support immutable CV snapshots and mail presets:

- `GET/POST /api/cv/versions`; create accepts only `{name,expectedSourceHash?}` and snapshots the current saved private profile `cvText`, never client-generated achievements.
- `POST /api/cv/default {id}`; `GET /api/cv/export?id=UUID&format=txt`. TXT and minimal DOCX exports are supported in cloud and local backends; neither invents CV content.
- `GET/POST /api/presets` with `{name,subject,body}`; `POST /api/presets/default {id}`. Each save creates an immutable revision; multiline mail subjects are rejected.

Google OAuth, mailbox sync/ranking, explicit send queue/replies and Calendar/Drive adapters now use a server-only D1 binding with independently encrypted owner grants. They require Google client credentials and each owner's consent before live operations; see docs/GOOGLE.md. Telegram, AI and external collectors remain disconnected.

## Database setup

The CLI-created migration is `supabase/migrations/20261103105538_immi_auth_workspace.sql`. Apply it only to this project's dedicated database; do not mix it into an unrelated existing project. All five exposed tables have RLS and explicit grants. Membership and profile writes are administrative only. `immi_memberships` binds one verified auth user to one unique `arash` or `amir` profile, with a composite foreign key preventing reassignment of private records to a different membership.

Provisioning order:

1. Create/verify the real person's Supabase Auth account through the configured sign-in/invitation flow; do not guess or fabricate passwords.
2. Use privileged administrative SQL to insert the verified `auth.users.id` into `immi_memberships` with the intended profile ID.
3. Insert its private profile into `immi_profiles` with matching `user_id`, `profile_id` and `data.id`; import private contacts into `immi_clinics` separately from git.
4. Run project security advisors, then verify anonymous denial and real two-user RLS isolation on the deployed database before uploading full private data.

There is no authorization from editable user metadata, service-role key in the Worker, or public CV asset. Merely registering a user does not grant workspace access. Test users alone are not proof of a real identity.

Additional migrations, applied in order:

- `20261103105718_immi_cv_presets.sql`: owner-RLS CV/preset snapshots, composite-FK defaults, security-invoker RPCs with transaction locks for atomic revision allocation.
- `20261103105827_immi_verified_onboarding.sql`: private administrative approved-email roster and a tightly scoped `SECURITY DEFINER` auth trigger. The function is in the unexposed `immi_private` schema, has an empty search path, fully qualified references, and revoked execution grants. It creates membership only for a nonanonymous auth user whose exact lowercased email has been confirmed and matches the administrative roster. No real roster email is committed. Users cannot write the roster.

Administrative roster provisioning (replace placeholders privately; never commit actual values):

```sql
insert into immi_private.approved_accounts(email,profile_id)
values ('actual-verified-owner@example.invalid','amir');
```

Add the roster before the real user signs up/verifies. Existing already-verified accounts require the explicit administrative membership/profile provisioning described above; editing the roster alone does not retroactively create membership. Conflicting memberships are never reassigned by the trigger.

## Build/deployment

From the repository root: `npm run build`, then deploy using the project's configured Cloudflare tool/CLI with `cloud/wrangler.jsonc`. Its API paths run the Worker before SPA fallback, so an unauthenticated API request cannot resolve to demo assets. No deployment has been performed by this module's author; the coordinator manages real resources and deployment.

Static shell assets may be publicly available; all personal data is fetched through authenticated APIs and returned with `Cache-Control: no-store`. Do not bundle private attachments in `dist`. Token transport is bearer-based; frontend must keep tokens private, handle expiry/sign-out, and must not keep demo profile switching enabled in cloud mode. This adapter validates access tokens on each API request; strict immediate token revocation and a full session-management UI remain separate work.

## Verification and sources

`node --test tests/cloud_auth.mjs` runs mocked API tests for missing/invalid tokens, unprovisioned users, foreign profiles, forced draft ownership, cross-origin writes, typed settings, publishable-only config, immutable CV input, missing/foreign CV access, safe exports, default metadata and mail-header validation. These tests do not replace real database RLS queries or deployed browser testing. Live SQL verification/advisors belong to the coordinator after resource creation.

Documentation checked 2026-11-03:

- https://supabase.com/changelog.md — relevant November TLS cipher removal concerns legacy clients; Worker uses modern TLS and no TLS verification bypass.
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/workers/static-assets/routing/worker-script/

No specific free-tier capacity or Iran accessibility is guaranteed by this adapter.

## Private staged profiles before first signup

`20261103110332_immi_staged_profile.sql` adds optional `profile_data` to the private administrative roster. The object must have the approved profile's `id`. Seed only the selected source's CV text, source filename and basic profile fields privately; do not include alternate documents or expose this column to any application role. No personal values are included in the migration.

When the real approved email is verified for the first time, the existing private auth trigger copies the staged object into that new owner's private `immi_profiles` row. If no object is staged it creates the generic empty profile instead. The trigger always overwrites the object's `id` with the approved roster profile ID, ignores editable auth user metadata, and never updates an existing private profile or transfers an existing membership.

Administrative seeding uses a parameterized JSON value in the coordinator's private import flow, conceptually:

```sql
update immi_private.approved_accounts
set profile_data = :private_selected_profile_json
where profile_id = :approved_profile_id;
```

The staged source retains its supplied/unverified evidence status; copying a CV does not verify its claims. `supabase/tests/private_roster.sql` provides a non-disclosing live SQL check that both `authenticated` and `anon` roles cannot read the roster. Run it after migration; a mocked API test does not establish database permissions.

## Low-bandwidth dataset polling

`20261103110536_immi_dataset_revision.sql` adds an indexed, security-invoker `immi_dataset_revision()` RPC. `GET /api/updates` returns only `{revision:string}` after normal token and membership validation. Bootstrap includes the same `revision`. The browser should load bootstrap initially, then poll updates every 10 seconds and reload dataset only when the revision changes. Explicit refresh may fetch bootstrap immediately. No contact/profile payload is sent by the updates endpoint.

The revision is the maximum clinic `updated_at`, or `empty`. Every clinic upsert must advance `updated_at`. This tracks insert/update imports; deletion of a non-latest clinic does not necessarily change the maximum, so a future delete workflow needs an explicit dataset-state revision or a tombstone update. CV/draft/settings changes are fetched by their relevant user action and are not represented by this clinic-only revision.

The revision migration also adds covering indexes for private owner/profile and default-version composite foreign keys. A security-advisor informational notice that `immi_private.approved_accounts` has RLS with no policies is intentional: application roles must have no access to this administrative roster; its schema/table grants are also revoked. Do not add a permissive policy to silence that informational notice.

## Google account separation (implemented contract; live setup pending)
Arash and Amir require distinct verified Google identities, separate consent and encrypted token records, mailboxes, sender identities, synchronization state, attachments, extraction/ranking, defaults and queues. The OAuth client infrastructure may be shared; private mailbox systems may not. Authenticated application ownership must be enforced server-side and in database policies, with no fallback to another user's account. A revoked connection stops only its owner's jobs. Implementation is in cloud/google-*.mjs. Live connection is reported only by the authenticated owner status endpoint after consent; code/tests alone do not establish a connection.
