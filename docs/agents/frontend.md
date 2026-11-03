# Frontend
Own src/, index.html, vite.config.js. Read API contract from server/README if present. RTL responsive dark navy, restrained neon match indicators, accessible controls. Distinct GP/PESCI and specialist workspaces. Never put secrets or raw CV data in bundle; demo selector is not auth. Verify npm run build. Hand off endpoint/property changes only.

Reusable display helpers: MixedText isolates Latin runs in RTL prose; DualCalendar uses canonical ISO instant with Tehran/Jalali and Australian/Gregorian views. GoogleSendPanel previews/queues are pinned to person+mailbox+provider identity. Preserve those guards when changing layout. Theme and font size are separate per profile in browser storage.
