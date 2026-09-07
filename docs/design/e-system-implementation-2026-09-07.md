# E — Best-of-System implementation

The approved E direction is implemented across all eight frontend routes, plus dashboard print, monthly sales PDF and RTO PDF exports. Source files remain vanilla HTML/CSS/JavaScript.

## Changed behavior

- Shared horizontal navigation, self-hosted Plus Jakarta Sans, violet/ink/apricot colors, consistent panels, tables, controls, mobile layouts and focus states.
- Overview has a 28/72 metric-and-fuel / trend-and-evidence layout. Ask Vahan is in document flow below an answer and above results on mobile. Monthly evidence expands from the latest three months to all rows.
- A staged full filter sheet supports geography, months, vehicle groups/classes/categories, fuel family and exact labels, norms and supported exclusions. Apply sends structured filters through the shared backend query/refresh pipeline; Cancel makes no query request. Changing state clears the old RTO.
- Compare has independent scope editors, exact totals and monthly bars on a shared scale. Overlapping scopes are not summed into a combined total.
- Counts appear immediately. Failed replacement queries preserve the previous overview answer and its export scope. Missing data and missing maker matches render as unavailable rather than an invented zero; verified zero rows retain zero.
- Chart month selection and export menus have keyboard controls. RTO suggestions keep a stable accessible label and discard stale pending responses after selection or dismissal.
- Shared print styles embed the font for server-generated reports. RTO PDF renderer revision increased from 2 to 3, invalidating the old visual cache.

## Review and checks

Run `npm run check:e-ui` for the isolated browser suite and `npm run check:structured-query` for structured-filter validation and text-query parity. The browser suite makes no database, provider, login or live VAHAN request. Screenshots and sample PDFs are written to `output/playwright/e-redesign/`; values are clearly labelled fixtures, not newly verified registration data. Set `E_UI_SCREENSHOTS=0` to run assertions without rewriting screenshots.

Validation during implementation:

- All eight routes at 1536px, 1024px and 390px; populated monthly report at desktop/mobile. No horizontal page overflow or uncaught browser errors.
- Staged cancel/apply/clear; state/RTO changes; exact structured request payloads; comparison scope reopening; non-EV preservation; month selection by keyboard; RTO suggestion selection; CSV output; missing/error states; dialog focus return; overview latest-request protection.
- Canonical filter parity for petrol, two wheelers, BOV, Pure EV, CNG, strong hybrid, plug-in hybrid, broad EV and non-EV. Invalid labels, arrays, dates, geography, mixed request formats and conflicting filters are rejected.
- Syntax check includes public JavaScript as well as server, library and script modules.
- Query routing, AI repair, acceptance, contract structure, refresh, HTTP router and security checks passed. The acceptance corpus covers 200 cases.
- Existing RTO report unit and browser checks passed, including cadence, date/search/status controls and category OEM tabs. Monthly OEM unit checks passed.
- Monthly and RTO sample PDFs rendered and visually inspected. Repeated table headers and source/quality notes remain present.
- `graphify update .` refreshed the code graph.

The installed validation runtime is Node 24.13.1; the repository declares Node 22. The existing database-dependent daily RTO browser script could not complete with DATABASE_URL empty. Its local search/selection and layout behavior is covered by the isolated E browser fixture; live database, OAuth, queue/collection and deployment integrations have not been exercised. No production deployment, data refresh, migration, commit or push was performed.

## Source entry points

- `public/system.css`: shared visual tokens and responsive rules.
- `public/system.js`: shared navigation and staged filter sheet.
- `public/index.html`, `public/app.js`: overview composition and interactions.
- `public/compare.js`: structured comparison scopes and paired charts.
- `server.mjs`: `normalizeStructuredDashboardFilters`, `/api/metadata/query-filters`, shared `/api/query` dispatch.
- `public/report-theme.css`, `lib/report-theme.mjs`: shared browser/PDF report presentation.
- `DESIGN.md`: current visual authority. The older concept brief remains a historical planning artifact.
