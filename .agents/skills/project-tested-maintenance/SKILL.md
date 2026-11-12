---
name: project-tested-maintenance
description: Maintain verified patch updates, CI/browser checks and read-only live probes for this website while preserving its public mounts, medical goals, private accounts and existing deployment boundaries.
---

Read AGENTS.md, docs/POLICY.md and docs/AUTOMATIC-MAINTENANCE.fa.md. references/upstream.md is pinned GitHub Actions documentation; examples are fragments, not instructions to add Docker/Kubernetes or new infrastructure.

Keep actions pinned by full SHA, read-only tokens by default, bounded jobs and browser tests using synthetic owners. Never send real mail/posts/applications in checks. Use scripts/check_skills.py to validate the local reference lock. The project has no need for an automatic external skill loader.

Automatic dependency changes are stable patches only, validated across the entire lockfile; reject major/minor drift, changed registries, added/removed packages and manifest changes. Candidate generation happens in a temporary directory with package scripts disabled. Apply only package-lock.json after unit, browser, build and audit gates pass. Verify main has not moved and push without force. Never change auth/schema/provider grants or application goals from a dependency bot.

The website host independently advances tested commit pins. A Worker code deployment still needs its authorized Cloudflare transport; do not claim a GitHub push deployed backend code. Keep backend and frontend release receipts. New features and architectural migrations require deliberate implementation/review, not unattended AI rewrites.

Pinned source and license: ../sources.lock.json and references/LICENSE. Existing session authorization controls production actions; do not ask again for actions already authorized by the user.
