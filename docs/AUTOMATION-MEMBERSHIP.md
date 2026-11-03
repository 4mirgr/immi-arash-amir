# Current account authorization before unattended actions

`checkAutomationMembership(env, ownerId, profileId, fetcher)` calls the fixed Supabase RPC `immi_automation_owner_active`. It returns `{active,reason}` with reasons `active`, `owner_inactive`, or `membership_check_unavailable`. A missing key/configuration, invalid/oversized response, redirect, timeout or API failure fails closed. The caller must not send/publish unless `active === true`; use it before claiming provider work and immediately before transport. Do not treat an unavailable check as uncertain provider delivery when no provider call happened.

The dedicated server secret `AUTOMATION_MEMBERSHIP_KEY` is URL-safe with at least32characters. The Worker sends it only in an HTTPS JSON request body to its configured Supabase root, alongside the publishable `apikey`; no service-role or user JWT is stored. Do not log the body or provider response. It is not a replacement for owner-scoped D1 checks, immutable approvals, provider identity checks or quotas.

The migration creates the non-exposed `immi_automation_private` schema, a RLS-protected configuration table and a privileged, fixed-search-path boolean function. The public RPC wrapper is SECURITY INVOKER; the inner privileged function checks the shared-secret SHA-256 digest before accessing current membership/auth rows. Only function execution and schema usage are granted to anon/authenticated roles; neither can read or change the key table. No function returns account/profile identifiers or email. The separate schema avoids widening access to existing onboarding-private objects.

After applying the migration, the operator must generate one new random secret outside Git and set it as the Worker's `AUTOMATION_MEMBERSHIP_KEY`. Store only its SHA-256 hex digest using privileged SQL:

```sql
insert into immi_automation_private.server_keys(id,key_sha256)
values('membership','<64 hex digest generated outside Git>')
on conflict(id) do update set key_sha256=excluded.key_sha256;
```

Never put the real secret or digest into a migration, public configuration, test fixture or logs. Test the live RPC with an invalid key (false), the configured key plus a synthetic absent UUID (false), and each current verified member (true). Use rolled-back removal tests to prove deleted membership, banned/unverified/anonymous accounts fail. Run Supabase advisors after migration. No production user must be deleted merely to test the gate.

The check requires a matching current `immi_memberships` row and an existing, nondeleted, nonanonymous, email-confirmed, nonbanned `auth.users` row. Logging out does not cancel an intentionally authorized unattended schedule; deleting membership/account or banning the account blocks later preflights. There is necessarily a tiny race between the last authorization response and provider acceptance; a request already accepted externally cannot be recalled. Domain/secret rotation or an API outage blocks sending until checks work again.
