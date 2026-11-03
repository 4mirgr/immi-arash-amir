# Owner isolation review — 2026-11-03

Scope: authenticated Worker routing, Supabase profile/CV/settings access, private Google and LinkedIn adapters, frontend session transitions, and Amir-only Italy opportunity visibility. This is a focused implementation review with synthetic regression tests, not an independent penetration test or a claim that every feature is enabled.

## Invariants checked

- Membership comes from the verified bearer identity and server-side membership row. Browser profile/owner fields cannot select another workspace.
- Profile, CV versions/defaults, presets, drafts and settings are queried with the trusted profile and protected by database RLS. Shared public-source clinic/organization records are intentionally shared; private correspondence and integrations are not.
- Google account grants, messages, queue entries, calendar and Drive operations use the authenticated owner. Tokens have owner-bound authenticated encryption. The same Google subject cannot bind two owners; there is no fallback to the other doctor's token.
- LinkedIn grants, sections, immutable drafts, posts, manual metrics, contacts and provider publication evidence are owner-scoped. A shared OAuth developer application does not merge the two account grants. A foreign post/contact ID yields no access. Ordinary OAuth does not imply analytics, connection-graph access or direct profile editing.
- Italy opportunities are restricted on the server, including direct organization-history routes, not merely hidden by the interface.
- Browser workspace components reset or reject stale results on profile changes; cloud profile selection remains determined by authentication.

## Fixed session-transition race

A refresh response arriving after logout could previously call `openSession` and restore an earlier login's bearer/session. A late identity bootstrap could also overwrite a newer login. `src/auth.jsx` now invalidates the authentication generation on logout, new login and unmount. Candidate identity bootstrap uses that candidate's captured bearer explicitly; only the current generation may update session, global bearer or error state.

The browser regression used synthetic accounts and deferred responses for two distinct cases: (1) previous owner's refresh grant completes after logout and a new owner's login; (2) previous owner's `/api/me` identity response completes after the new login. In both cases the visible owner and API bearer remained the new owner. No real account, credentials, mail, connection request or post was used. Harness artifacts remain outside the repository at `/workspace/scratch/owner-audit/`.

## Validation

`tests/cloud_owner_isolation.mjs` adds five main-router regressions using in-memory SQLite and synthetic auth/REST responses: independent profile/CV/settings reads; rejection of forged profile queries across private adapters; trusted owner assignment for CV defaults/settings; LinkedIn private object isolation; and Italy list/filter/direct-history enforcement. All five pass. Existing Google/LinkedIn suites additionally cover encryption identity binding, foreign-owner records and publication idempotency.

Live provider consent, real message transport and newly configured integrations still require their own end-to-end checks. No real external action was executed by this review.
