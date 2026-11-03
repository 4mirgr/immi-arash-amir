# Bounded cache and expired-link maintenance

`runMaintenance(env, now)` uses only the private `GOOGLE_DB` binding and issues exactly **five** fixed SQL delete statements when configured, at most **500 rows per table** per invocation. It makes no provider calls and does not read tokens or cached bodies. Missing storage exits before queries. Invalid time fails before mutation. Each task reports only its fixed task name, result and affected count; errors do not expose SQL/provider/private content.

The policy deletes expired Google/LinkedIn OAuth and Telegram one-use link states; received Gmail cache rows not updated for more than 30 days; and OAuth diagnostic identifiers older than 30 days. Mail cache expiry uses `updated_at`, **not** the original message date, so a newly fetched historical message remains available. Gmail originals are never deleted. A removed cache row may be fetched again through its owner's mailbox connection.

AI drafts/history are deliberately retained. Live provider grants, profile/CV records, mail drafts, sync cursors, long-term planning, PESCI reflections, pending/terminal send queues, scheduled approvals, suppression records, notification/publication receipts and all idempotency/audit evidence are outside this allowlist. This is not account deletion, credential revocation, backup or disaster recovery.

Integrate into an existing suitable scheduled job only after accounting for these five extra D1 queries; do not create a sixth cron trigger on the current Free account. Repeated runs gradually drain expired rows; one run does not promise immediate deletion of every stale record. It is a server-owned policy across the two workspaces and never trusts an HTTP-supplied table or owner selector. If a task fails, the others continue and a partial-failure summary is returned.

`node --test tests/cloud_maintenance.mjs` verifies TTL boundaries, cache refresh semantics, fixed query/table limits, retained grants/AI drafts, failure redaction and bounded draining using synthetic SQLite fixtures. Production execution and scheduling require a separate runtime check by the integrator.
