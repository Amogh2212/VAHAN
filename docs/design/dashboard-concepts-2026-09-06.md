# VAHAN Analyst: five dashboard directions

Design exploration only. No existing UI implementation is changed. Branch: `feature/dashboard-ui-redesign`. Existing uncommitted work is preserved. No database writes, live collection, library installation, deployment, or implementation plan is part of this exercise.

## Reference key

There are four distinct visual sources, not five: uploaded photos 1 and 2 are two views of ACERO.

| Reference | Evidence | Borrow | Do not copy |
| --- | --- | --- | --- |
| R1 — Skillify | [Habib: Online Education Dashboard](https://dribbble.com/shots/25267960-Online-Education-Dashboard) | Group navigation by task; put the working area in the center; use a secondary rail for context; make the selected chart period obvious. | Course illustrations, upgrade promotions, tilted cards, calendar widgets without a registration task. |
| R2 — InfoGraphix | [Dashboard Infographic Template](https://dribbble.com/shots/21488881-Dashboard-Infographic-Template) | Combine concise measures with varied chart sizes; directly label composition and change; align compact statistical modules. | Glossy gradients, decorative radial gauges, unrelated metrics, presentation density carried unchanged into an interactive app. |
| R3 — ACERO | Uploaded `1.webp` and close crop `2.webp` | Narrow navigation, warm white surfaces, restrained navy/peach contrast, spacious chart area with tidy detail rows below; distinguish the supporting column. | Student/earnings labels, promotional people illustrations, gender gauge, large event calendar, low-contrast gray text. |
| R4 — Finance dashboard | Uploaded `3.webp` | Grouped navigation, small summaries, a clear chart-to-table sequence, a separate analytical inspector and restrained purple selection. | Balances, payment actions, avatars in data rows, smooth curves that imply unobserved registration values. |

The screenshots establish desktop appearance; they do not prove responsive layouts, keyboard behavior, filter semantics, or live interactions. Those behaviors below are proposals.

## Current product and preservation inventory

Inspected the Graphify report, product/design context, all public HTML route surfaces, dashboard rendering/filter/export code, selected report/insight/tracking code, package manifest, shared style sources, and existing screenshot artifacts. Existing screenshot artifacts include older designs and are not asserted to match the current source. This is a frontend workflow inventory, not a complete backend or production audit.

The frontend uses vanilla HTML, CSS and JavaScript. `public/styles.css` supplies the dashboard styling; `public/atlas.css` extends the other analytical routes. Charts in the main dashboard are built with SVG and DOM elements. There is no React component framework or third-party chart dependency listed in the package manifest. The application runs through Node, with PostgreSQL and Playwright dependencies.

Current source presents an editorial dashboard with persistent route navigation, a prominent natural-language question, query scope, total/monthly-average/peak/status summaries, a monthly line chart, fuel composition, monthly distribution, grouped monthly evidence, Overview/Detail/Brief modes, and CSV/PDF export. Selecting a month in the trend already updates the fuel breakdown.

| Surface | Functionality to retain |
| --- | --- |
| Dashboard — `public/index.html`, `public/app.js` | Query submission, example questions, interpreted exact filters including exclusions, clarification/failure handling, trend selection, fuel details, zero-row visibility, view modes and exports. |
| Compare — `public/compare.html`, `public/compare.js` | Two query contexts, comparative summary, monthly trends and fuel breakdown for each side. |
| Map — `public/map.html`, `public/map.js` | Geographic query controls, state EV share and selected-state detail. |
| Tracked queries — `public/tracked.html`, `public/tracked.js` | Sign-in, saved queries, schedule settings, active state and observation history. Keep this discoverable even though it is absent from the main dashboard's present sidebar. |
| RTO trends — `public/rto-trends.html`, `public/rto-trends.js` | Collection coverage, RTO search, EV/ICE, 2W/3W/4W, OEM selection, snapshot trend and private pinned RTOs. |
| RTO reports — `public/rto-reports.html`, `public/rto-reports.js` | Period/search/status controls, individual reports, missing-cycle states. |
| RTO insights — `public/rto-insights.html`, `public/rto-insights.js` | Source health, radius/limit controls, pattern ranking, EV-versus-charger comparison, RTO detail. Correlation must not become a causal AI claim. |
| Monthly reports — `public/reports/monthly-sales.html` and `.js` | Period and fuel scope, authentication, coverage, report generation/retrieval, PDF, and permission-sensitive refresh. |
| External access | Preserve the Telegram bot link and existing sign-in boundaries. |

Grouping navigation must preserve every route; showing fewer controls initially must not remove filtering capability. Daily RTO snapshots and monthly registration flows require separate labels. Dashboard query refresh and fixed RTO collection must remain separate workflows.

## Data in these mockups

The visual comparison uses one consistent historical UI snapshot from `ui-preview-screenshots/dashboard-preview.png` and `light-dashboard-desktop.png`: **Maharashtra / all loaded RTOs / FORK LIFT / January–December 2024**. It is design evidence, not freshly validated official registration data.

- Total 294; diesel 274; electric 20.
- Monthly totals: 26, 23, 19, 23, 38, 34, 16, 14, 24, 19, 25, 33.
- Derived for the study: EV share 6.8%, diesel share 93.2%, monthly average 24.5, December versus November +32.0%.
- Peak: May 2024, 38 registrations; May contains diesel 18 and electric 20.
- Petrol, CNG and hybrid are not shown in this snapshot; their proposed slots use a dash and explicit explanation. Absence is not assumed to mean numeric zero.
- No state/RTO ranking, all-India total, complete national coverage, year-on-year change, or charger correlation is invented.

The seven proposed filter controls are State, RTO, Date Range, Fuel Type, Vehicle Category, Vehicle Class and BS/Euro/CEV Norms. Expanded detail retains exact source labels and exclusions. These concepts improve access to existing query semantics; equivalent GUI controls across all dimensions still need implementation after approval.

## 1. Modern SaaS Analytics

**Philosophy and audience:** an approachable daily overview for mixed analyst and stakeholder teams. Question → scope → headline figures → trend and fuel → evidence.

**Composition:** a narrow labeled sidebar, query bar, top geographic/date filters and advanced disclosure, generous metric cards, a broad trend beside fuel mix, and evidence below. The main canvas has no permanent utility rail.

**Reference contribution:** R1 supplies task grouping; R2 supplies summary-and-chart modularity; R3 supplies spacing and the chart-to-detail layout; R4 supplies the table hierarchy.

**Redesigned components and improvements:** route sidebar, query form, filter controls, summaries, trend/fuel panels and table. Useful context becomes easier to scan, export is explicit, and analysts can edit common filters without rewriting the question.

**Proposed interactions:** selecting a fuel KPI updates fuel scope only after making that change visible; selecting a month changes the fuel detail. Advanced filters reveal class/category/norms and exclusions. Reports remain a separate destination.

**Responsive:** navigation becomes a drawer; Filters opens a sheet; the total spans the width; other summaries pair; charts and evidence stack. Coverage stays adjacent to the answer.

**Advantages:** familiar, balanced, good first-use experience. **Disadvantages:** more vertical space and less evidence above the fold. **Difficulty: Medium**, principally because structured filters and clickable KPI behavior exceed a style-only change.

## 2. Data-Heavy Analytics

**Philosophy and audience:** precise repeated filtering and row inspection for expert analysts.

**Composition:** horizontal route navigation; persistent left filter inspector; compact metric strip; two concise charts; a large sortable evidence grid occupying the lower workspace. May is visibly selected across chart and table.

**Reference contribution:** R1's grouping becomes top-level navigation; R2 informs statistical density; R3 informs aligned control spacing; R4 informs the primary table and row hierarchy.

**Redesigned components and improvements:** filter inspector, compact query command, metric strip, chart coordination and evidence grid. All seven dimensions are visible together; exclusions are inspectable; exact monthly values need less scrolling than the current grouped cards.

**Proposed interactions:** stage multiple filter changes, Apply once, clear individual restrictions, sort columns, select a month and export the same context. The UI must distinguish staged filters from those behind the displayed result.

**Responsive:** inspector moves into a sheet; trend and fuel use tabs; evidence supports horizontal scrolling with its month identity retained. No global page overflow or reduction to unreadable font sizes.

**Advantages:** strongest precise analysis and repeated comparisons; high visible information density. **Disadvantages:** steeper learning curve and less comfortable on phones. **Difficulty: Hard**, because staged filter state and coordinated table/chart interactions require careful behavior work.

## 3. Minimal Enterprise

**Philosophy and audience:** a legible statistical brief for enterprise stakeholders, researchers and report readers.

**Composition:** restrained top navigation; centered evidence sheet; one dominant total and a ruled fuel summary; explicit scope; full-width trend; simple table and source note. No permanent sidebar, utility rail or card wall.

**Reference contribution:** R1 contributes the clear primary task; R2 contributes selective percentage annotations; R3 contributes generous spacing; R4 contributes the disciplined chart-to-table reading order.

**Redesigned components and improvements:** navigation, headline summary, scope editor, chart framing and evidence table. Removes repeated panel headings, foregrounds what was counted, and makes the answer easier to read or export as a brief.

**Proposed interactions:** Edit question and Edit filters disclose existing detail; export stays prominent; the monthly chart retains existing fuel selection. The compact appearance must preserve access to every route and exact filter.

**Responsive:** the evidence sheet becomes a single reading column; summaries wrap; the table gets an accessible scroll container; source/methodology notes remain in reading order.

**Advantages:** strongest readability, restrained professional appearance and easiest adaptation. **Disadvantages:** less simultaneous analysis and lower discoverability of advanced tools. **Difficulty: Easy relative to the others**, provided the first implementation reuses current query/export/chart behavior; a full structured filter editor would raise it to Medium.

## 4. Visual Analytics

**Philosophy and audience:** exploration through month selection for analysts investigating trends and changes.

**Composition:** collapsed navigation rail; compact query and active filters; one dominant monthly plot; a right selected-month inspector; an expandable evidence tray. Trend/Fuel/Compare switches alter the analytical focus.

**Reference contribution:** R1 contributes visible selection and context; R2 contributes varied visualization scale; R3 contributes a strongly separated support area; R4 contributes the large central chart with a secondary inspector.

**Redesigned components and improvements:** plot, selection model, range control, contextual fuel detail and evidence tray. More space goes to data marks; month-to-fuel relationships become explicit. It does not invent a geographic breakdown for an all-RTO snapshot.

**Proposed interactions:** point selection, keyboard-selectable months, range selection, clear selection, and an explicit table alternative. A time-range brush is a new proposed interaction, not an existing feature.

**Responsive:** large readable chart follows the title/scope; selected-month detail becomes a bottom sheet or inline panel; evidence remains accessible through a labeled control. Provide a data-table alternative to every visual interaction.

**Advantages:** strongest visual exploration and focus on trends. **Disadvantages:** hidden table requires another action; brushing and selections can confuse scope without careful feedback. **Difficulty: Hard**, due to accessible range controls, coordinated selections and mobile inspector behavior.

## 5. Hybrid Reference-Inspired Design

**Philosophy and audience:** move naturally from a question to trustworthy evidence and then a report; best for teams mixing quick answers with deeper investigation.

**Composition:** grouped route sidebar; query-and-scope workbench across the top; an evidence canvas with a prominent total, compact fuel strip, trend and table; a separate context rail for selected period, source, changes and reports. Overview/Detail/Brief remains explicit.

**Reference contribution:** R1 supplies workspace grouping; R2 supplies compact statistical annotation; R3 supplies the warm spacing rhythm; R4 supplies the evidence table and context rail. These are combined around VAHAN's query workflow rather than assembled as decorative widgets.

**Redesigned components and improvements:** navigation taxonomy, query workbench, interpreted filter chips, metric hierarchy, analytical canvas, context rail and report access. Restores discoverability of tracked queries, makes the selected context persistent and reduces the distance from answer to evidence to report.

**Proposed interactions:** edit scope chips, Apply once, select a month, clear selection, switch existing detail modes, export the current answer, or enter the monthly report workflow. A report action should carry only compatible supported context and show what changes.

**Responsive:** query and active scope come first, then the total and trend; context rail becomes a labeled accordion below the answer; route drawer retains all destinations. Freshness and failure warnings stay visible even when the context accordion is closed.

**Advantages:** best overall balance of query access, analytics, traceability and report workflow. **Disadvantages:** widest desktop layout; careful reflow needed to prevent a cramped three-column screen. **Difficulty: Medium**, assuming existing APIs and rendering behaviors are reused.

## Shared UX and data rules

- Keep all seven filter dimensions, inclusive/exclusive semantics, multi-selection and exact interpreted values. A shortened label must not broaden the query.
- Loading, refreshing, partial, stale, missing and failed states must be distinct from zero. Do not display stale results under new filter labels.
- Growth requires matching geography, vehicle scope, fuel definition and comparable periods; show “Comparison required” when absent. Registrations are not necessarily vehicle sales, and snapshots are not monthly flows.
- Show whether a selected month affects only the fuel panel or the entire answer. Exports should state that same scope.
- Avoid adding an unsupported all-purpose AI chat. Keep natural-language interpretation, grounded analyst notes and existing RTO analysis distinguishable.
- Preserve report authentication, administrative refresh permissions and download behavior. A Generate report button must enter the actual existing report workflow, not suggest instant unrestricted generation.
- Charts need zero-based bar axes, direct labels, stable fuel colors, keyboard selection and an equivalent table. Use straight segments for monthly observations, not decorative smooth curves.
- Target readable body text, visible keyboard focus, non-color status cues and useful touch targets. Static mockups do not validate accessibility or responsiveness.

## Comparison

These are design judgments, not user-testing results. Difficulty is relative and includes the proposed interactions.

| Concept | Visual quality | Data density | Ease of use | Professional feel | Difficulty |
| --- | --- | --- | --- | --- | --- |
| 1 Modern SaaS | High | Medium | High | High | Medium |
| 2 Data-heavy | High | Very high | Medium | High | Hard |
| 3 Minimal enterprise | High | Low–medium | Very high | Very high | Easy* |
| 4 Visual analytics | Very high | Medium–high | Medium | High | Hard |
| 5 Hybrid | Very high | High | High | Very high | Medium |

*Easy relative to the others, with the reuse boundary described above.

**Recommendation:** Concept 5 overall and for the strongest combined reference interpretation; Concept 2 for detailed analytics; Concept 3 for enterprise reading and easiest adoption; Concept 4 for visual exploration.

No direction has been approved. Stop after review; do not create an implementation plan or change the UI until the user explicitly chooses or approves a combination.
