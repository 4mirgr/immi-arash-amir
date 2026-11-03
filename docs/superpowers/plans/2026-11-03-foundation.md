# Foundation implementation plan
Goal: runnable, honest initial workspace in the requested repository.
Architecture: React/Vite + loopback Python API + private SQLite; portable future cloud integrations.
Spec: ../specs/2026-11-03-platform-design.md

- [x] Data agent: extract DOCX/XLSX locally, stable ID dedup, import provenance, profile-scoped persistence; verify unittest and repeated imports.
- [x] Frontend agent: RTL workspace, filters/selections/drafts, CV download, PESCI timer/speech, clear disconnected status; verify production build.
- [x] Research agent: official sourced IMG/PESCI/specialist notes and original educational case library.
- [x] Coordinator: policies/role contexts, deployment/account guide, CI, cross-layer smoke checks, inspect tracked data, push verified foundation.

Review focus: untrusted HTML text; imported contact vs real vacancy; cross-profile drafts; private files in git; external connection claims. Production cloud services and real OAuth are a separate implementation milestone, not complete in this local foundation.
