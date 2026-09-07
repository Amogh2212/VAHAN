# Vahan Analyst — E: Best-of-System

Approved visual direction: E from the September 2026 dashboard concepts. This system applies to the overview, comparison, map, daily RTO trends, local insights, tracked queries, RTO reports, monthly reports and printable exports.

## Product expression

A calm analytical workspace with white surfaces, violet actions, dark ink and restrained apricot highlights. The answer carries the visual weight. Keep exact scope, availability and source context close to the figures they qualify.

The frontend remains vanilla HTML, CSS and JavaScript. `public/styles.css` contains existing component geometry inside a CSS layer. `public/system.css` owns the shared visual system; `public/atlas.css` is a compatibility import. `public/system.js` provides navigation and the staged filter editor.

## Shared tokens

| Role | Value | Use |
| --- | --- | --- |
| Canvas | #f7f8fa | Page background |
| Surface | #ffffff | Evidence and control panels |
| Quiet surface | #f1f2f6 | Tracks and secondary controls |
| Ink | #182139 | Headings and figures |
| Supporting text | #586174 | Labels, descriptions and provenance |
| Violet | #4f46b8 | Primary actions, active routes and main trend |
| Violet tint | #efedf9 | Ask Vahan dock and selected scope |
| Apricot | #f6bea5 | Brand mark and annotated peak |
| Divider | #dde1e8 | Fine separation |
| Control boundary | #8c91a0 | Inputs and secondary actions |
| Success | #17684f on #eaf4ef | Confirmed successful state |
| Warning | #8a5700 on #fff4dc | Partial, stale or bounded evidence |
| Error | #a33b2b on #fff0eb | Failed or missing evidence |

Use a self-hosted Plus Jakarta Sans variable font for headings and the primary total. Use Segoe UI/system fonts for body copy and tabular figures. Page titles are 32px desktop / 26px mobile; panel titles 18px; body 16px; supporting copy 13–14px. The primary total scales from 32–52px. Monthly averages may be rounded for display; exported data retains its underlying value.

Panels have 12px corners, controls 8px, compact status labels 4px. Prefer borders and spacing to shadows. Reserve shadow for temporary menus and the filter sheet. Typical desktop gaps are 24px with 24px panel padding; mobile uses 16px gutters. No count interpolation, decorative glows, glass or hover lift.

## Navigation and composition

Use one horizontal header across routes: Overview, Compare, Map, RTO workspace (Daily trends and Local insights), Reports (RTO and Monthly sales), Tracked queries, and Account. Current routes carry a tinted violet state. At widths below 1200px the navigation opens with a Menu button; Escape closes menus and returns focus.

Overview uses an asymmetric 28/72 layout. The left region holds the primary total, supporting measures and exact fuel composition. The right region holds the trend and monthly evidence. Compact scope chips open the same full editor. Monthly rows expand without changing the answer. Ask Vahan sits below the evidence in document flow; before the first answer and on mobile it moves above the results. It never overlays data or the software keyboard.

Compare uses two explicit scopes with separate staged editors, exact totals and monthly bars on a shared scale. Do not add the scopes into a combined total: they can overlap. Keep missing months distinct from zero.

Map uses a violet sequential scale with neutral missing states. Comparison against India uses an apricot-to-violet diverging scale. Every bucket has a text label; state selection must work by keyboard. Daily trends, insights, tracked queries and report workspaces retain their established workflows inside the shared header and visual tokens.

## Scope editor contract

The modal sheet stages geography, month range, broad vehicle groups or exact classes/categories, exact fuel labels, fuel family, emission norms and supported exclusions. Cancel and Escape make no query request. Apply submits the whole scope to `/api/query` as `{filters}`; changes are not converted into a new natural-language question. State changes clear incompatible RTO selections. Clear selections preserves the explicitly shown months. Metadata errors are visible and can be retried by reopening the sheet.

Battery electric means ELECTRIC(BOV) plus PURE EV. An exact label remains exact. Hybrid labels, exclusions and non-EV restrictions must survive reopening. Server validation rejects conflicting or unsupported combinations rather than silently widening the answer. The structured route shares the normal retrieval, refresh and error handling path.

## Evidence and interaction

Display counts immediately and exactly. A failed or missing response must not be presented as a trustworthy zero. A failed replacement on Overview preserves the previous answer and its matching exports. Only the latest submitted query can replace the result. Put partial/stale/fetch status in plain text beside the answer; chart colors do not imply reliability.

Month points are interactive by click, Enter and Space and update fuel composition. Responsive charts use fewer visible axis ticks while retaining all observations and accessible month controls. Keep tables in local scroll containers where required, with no page-wide horizontal overflow.

Focus outlines are visible. Dialogs return focus to their opener. Reduced motion removes transitions. Use native buttons, links, details, form labels and dialog semantics. Export menus expose expanded state and close on Escape, outside interaction or focus departure.

## Reports

`public/report-theme.css` and `lib/report-theme.mjs` share the E print treatment. Server-rendered reports embed the font so PDF generation has no remote-font dependency. Use A4 with 14mm margins, repeated table headers, rows that do not split, visible source/quality notes and legible monochrome labels. RTO PDF renderer revision is 3 so previously cached exports cannot retain the discarded theme.

## Verification and reference

The selected composition is `.impeccable/mocks/second-pass-2026-09-06/E-best-of-system.png`. Historical fixture values live in `docs/design/dashboard-second-pass-fixture.csv`; they are design evidence, not a live data verification.

`npm run check:e-ui` checks all eight routes at desktop, tablet and mobile widths with isolated fixtures, plus staged filtering, keyboard month selection, error/missing states and export behavior. `npm run check:structured-query` verifies validation and canonical parity with the text-query path. Existing query-race, RTO workflow and backend regression checks remain applicable.
