# Dompet reference and workspace design

The owner provided `dompet-10.rar` through Google Drive. The27MB archive was downloaded and reviewed on2026-11-11: Dompet v1.0, HTML/CSS/SCSS documentation and dashboard, profile, mail, calendar, forms/table examples. Archive paths and sizes were inspected before extraction into a reference directory outside Git. Static visual inspection did not run the vendor scripts.

The supplied style is adapted to the existing React application with original CSS: rounded24–28px surfaces, teal controls, semantic green/amber/violet pathway cards, a clearer sidebar/profile, consistent forms, tables and disclosures. Existing branding, local Vazirmatn, owner-specific dark/light and font preferences, Persian/English direction and mobile top navigation remain. Finance sample numbers, stock profiles, old jQuery/demo code and unrelated template modules are not part of the medical workspace.

`src/workspace-style.css` is the shared presentation entry for the app and browser regression harnesses. Load order:

1. `style.css`: existing layout and behavior hooks.
2. `dompet-shell.css`: palette tokens, sidebar/header, page spacing and access page.
3. `dompet-dashboard.css`: welcome, pathways, statistics and quick actions.
4. `dompet-components.css`: forms, cards, tables, disclosures, opportunity and correspondence surfaces.

No account, OAuth, queue, consent, source acquisition, CV, provider or database logic changes are part of this visual update. No new dependency, hosted font or external runtime service is required. Keep the original archive/vendor files outside the repository.

Validation: production build;67English views across both owners and mobile/desktop;24home combinations across320/390/1440px, dark/light, RTL/LTR; selected batch and individual send controls, review-before-send, no duplicate replay, private clinic suggestions and transient sync continuity with synthetic providers. Screenshot inspection covers both palettes; wait for appearance transitions to settle before capturing theme-switch results. No live messages or posts were sent.
