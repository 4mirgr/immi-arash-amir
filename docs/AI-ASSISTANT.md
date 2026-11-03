# Bounded private AI drafts

Checked 2026-11-03 against Cloudflare's current public model catalog and pricing. The fixed model is `@cf/meta/llama-3.1-8b-instruct-fp8`. The catalog exposes this FP8 variant, and the pricing table lists 13,778 Neurons per million input tokens / 26,128 per million output tokens. The documented free allocation is 10,000 Neurons per account per UTC day. A Free Workers plan stops inference at its allocation; Paid plans can charge overage. The application caps below do **not** monitor other apps' account-level usage. Do not upgrade a plan or assume zero cost on a Paid account. Root/operator must verify plan/free availability with a small synthetic probe before enabling.

Sources actually read:
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/models/ (current catalog; the legacy non-FP8 model URL redirected to the catalog)

## Deploy and scope

Apply `cloud/ai-assistant-schema.sql` to the private `GOOGLE_DB`. Add an AI binding named `AI` only on the verified suitable account and set `AI_ENABLED=true` only after the provider probe. No API key or model selector is exposed to the browser. Missing binding/flag/storage fails closed; it never falls back to another provider or a user's other account.

Wire `handleAiAssistantRequest(request,env,{userId,profileId})` only after trusted application authentication/membership. Render named `AiAssistant({person,notify})`. Endpoint GET `/api/ai/status` returns configuration, current quotas and ten recent own completed drafts. POST `/api/ai/analyze` accepts `{task,question,context?,contextConsent?}` for pathway/CV/email; PESCI is Arash-only. Unknown fields, forged owners/models, cross-profile queries and cross-origin writes fail before inference.

## Cost controls

- Fixed model, max 600 output tokens; no caller/provider setting override.
- Combined question and explicit context ≤6,000 characters; bounded reviewed-public-evidence pack and fixed system prompt.
- Three inference reservations per owner and six across this application per UTC day, atomically enforced by one SQLite INSERT...SELECT.
- Failed/time-out attempts still consume reservations. There are no automatic retries. Identical completed own requests are cached for that day; another owner never receives that cache. Concurrent duplicates cannot trigger multiple calls.
- Only actual provider token usage is returned when present; missing usage is null, never invented. Neuron use is not estimated and presented as measured.

## Data and quality boundaries

There is no automatic profile, CV, mailbox, Drive or calendar ingestion. Users type a question; optional private context requires an explicit checkbox and server `contextConsent:true`. The screen explains that supplied text is sent to Cloudflare Workers AI. Raw optional context is not stored; its SHA-256 contributes only to the owner-scoped cache key. Questions and generated drafts are stored privately, with 14-day request-time cleanup and ten-item history. No prompt/answer/token is logged by this module. The hosting/provider's current data terms must also be checked before changing data flow.

The answer is an unverified draft, not regulator eligibility, a validated PESCI score, medical treatment advice or a verified achievement. It cannot send messages, post, enroll, modify CVs or alter planning facts. The system explicitly preserves uncertain residency/board/language status, forbids invented credentials/acceptance probabilities and avoids drug-dose prescriptions. Model hyperlinks are plain text and unverified; HTML/script output is rendered inert. Reviewed source dates remain source dates, not a claim that model answers are authoritative.

PESCI mode supports educational reflection, not patient-specific treatment or an official examiner. A clinician must review clinical content. No private material from the other doctor enters a prompt or result.

## Verification

Eight backend regressions cover disabled provider, actual bounded parameters, owner cache/history isolation, context consent, forged input, atomic daily caps, failed-budget reservation and absence of raw context in storage. A synthetic Chromium mock verifies context opt-in, inert script-like output, owner/form resets, late-response rejection and Arash-only PESCI option. Tests do not prove live model quality or provider availability; the deployment probe and controlled owner review are separate.
