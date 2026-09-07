# Dashboard redesign — second exploration

Status: unapproved design concepts. Branch: `feature/dashboard-ui-redesign`. No UI code, dependencies, styles, runtime, database, scheduler or deployment changes are authorized by this document. The first-pass compositions are rejected as starting points.

## Critique of the first pass

1. Too much of each screen was devoted to repeated scope labels, disclaimers and bordered containers. The primary answer did not consistently win the visual hierarchy.
2. Several concepts repeated essentially the same navigation/KPI/chart/table arrangement. Naming them differently did not create sufficiently different workflows.
3. Desktop-plus-mobile boards squeezed both designs. Small labels and unrealistically packed screens obscured spacing quality.
4. The six-card treatment was especially weak: totals, shares and unavailable fuel groups were treated as equally important objects.
5. Tables had too many dividers; charts sometimes repeated the same information as adjacent summaries without clarifying another question.
6. Generated imagery introduced factual errors: invented full coverage in Concept 1, an unsupported exclusion in Concept 2, and a fuel/class label mix-up in Concept 5. Those images cannot serve as implementation specifications.
7. The first pass borrowed reference colors more successfully than reference rhythm, restraint and proportions. Generic transport icons added little identity.
8. Interaction descriptions existed, but the screen structures did not always explain selection scope, next actions or the transition from a question to a report.

The second pass starts from five distinct task structures and a shared preliminary system. It does not edit the old images.

## Resource method and actual stack

UI/UX Pro Max was not installed locally. Its [official SKILL.md](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/SKILL.md), [static rule index](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/references/quick-reference.md), and source datasets were read directly. The bundled Python search workflow was **not run**, and no claim of an automated design-system match is made. Direct review of its published rules is the primary UX discipline for this pass, consistent with the user's no-install boundary.

The actual frontend is **vanilla HTML/CSS/JavaScript**, with SVG/DOM chart rendering. There is no React, Next.js, shadcn Sheet, or installed third-party chart library to reuse. The named component libraries therefore supply behavioral references, not a migration decision.

| Resource inspected | Adopt or adapt | Reject/defer |
| --- | --- | --- |
| UI/UX Pro Max: rule index, charts, typography and colors | Progressive disclosure, deliberate emphasis, consistent navigation, readable number columns, chart choice tied to the analytical question. The typography catalog includes Plus Jakarta Sans for dashboard use; the analytics palette is a reference, not an instruction to replace product colors. | A generic preset overriding the supplied references or source semantics; framework-specific assumptions. |
| [Animate UI Sheet](https://animate-ui.com/docs/components/radix/sheet), [Sidebar](https://animate-ui.com/docs/components/radix/sidebar), [Tabs](https://animate-ui.com/docs/primitives/animate/tabs) | A contained filter-editing surface, unmistakable active view, spatially consistent open/close feedback. | Copying spring defaults, adding React solely for a drawer, or animating primary content out of reach. |
| React Bits [CountUp source](https://github.com/DavidHDev/react-bits/blob/main/src/content/TextAnimations/CountUp/CountUp.jsx) and [FadeContent source](https://github.com/DavidHDev/react-bits/blob/main/src/content/Animations/FadeContent/FadeContent.jsx) | A brief content replacement treatment after a real query completes; stable metric width. | Rolling registration numbers, scroll-triggered hiding of evidence, blur on data, default long entrances. The inspected CountUp implementation formats en-US; do not copy it into Indian-number displays. |
| [Inspira UI Bento Grid](https://docs.inspira-ui.com/docs/en/components/miscellaneous/bento-grid), [Number Ticker](https://docs.inspira-ui.com/docs/en/components/text-animations/number-ticker) | Unequal spatial allocation can establish importance; the metric region need not be six identical cards. | Vue/Nuxt adoption, a wall of feature tiles, number tickers and decorative hover effects. |
| [Lenis](https://lenis.dev/) | No main-dashboard use proposed. | Smooth-scrolling dependency: this workflow benefits from predictable native scrolling, keyboard navigation and table access. Reconsider only for a separately approved long report/story experience. |

All timing below is a proposed product choice, not a claim that a library's defaults match it. Motion remains optional and interruptible. Reduced-motion users receive immediate final states.

## Four-reference interpretation

R1 is [Habib's Skillify dashboard](https://dribbble.com/shots/25267960-Online-Education-Dashboard). R2 is [InfoGraphix](https://dribbble.com/shots/21488881-Dashboard-Infographic-Template). R3 is ACERO, shown in uploaded images 1 and 2; these are two crops of one design. R4 is the uploaded finance dashboard, image 3.

| Reference | Useful principle | Exclusion |
| --- | --- | --- |
| R1 | Group tasks and distinguish the main work area from supporting choices. | Promotions, courses, tilted cards and nonfunctional calendars. |
| R2 | Give each statistical view an appropriate scale; concise changes and composition belong near the relevant chart. | Glossy fills, decorative gauges and unrelated charts. |
| R3 | Warm surfaces, strong spacing, quiet navigation and a clear chart/detail relationship. | Low-contrast text, student content, avatars and community panels. |
| R4 | Reliable chart-to-table hierarchy and a restrained selection state. | Banking metaphors and smoothed curves suggesting unobserved data. |

## Current dashboard: keep, change and reorganize

The source was revisited: main HTML, dashboard filter/reliability/rendering code, style overrides, package manifest, route headings and the current Graphify report. Existing screenshot files are historical artifacts, not verified current browser screenshots.

**Keep:** natural-language query, exact interpreted scope and exclusions, monthly trend-to-fuel selection, grouped source detail, CSV/PDF exports, Overview/Detail/Brief behavior, and all analytical routes. Preserve compare, map, tracked queries, RTO trends, RTO reports, RTO insights, monthly reports, Telegram access and authentication/refresh restrictions.

**Redesign:** oversized or repeated section framing, equal-weight summaries, information-dense interpreted-filter panels, long monthly card lists and the visual distinction between selection and filtering.

**Reorganize:** group navigation by Explore / Monitor / Reports where appropriate; make tracked queries discoverable; place monthly detail directly behind a visible View data action; separate answer export from the monthly-report workflow.

**Promote:** the counted scope, total and primary trend, query entry and the path to supporting rows. Keep a concise source state visible; expand its detail when needed.

**Demote:** default-All filters, parsing internals, duplicate export buttons, repeated explanatory banners and secondary routes. Demotion means progressive disclosure, not removal.

The fixed daily RTO collector stays separate from dashboard query refresh. Historical cumulative snapshots and monthly registrations must never be mixed in a single unlabeled measure. EV/charger signals remain correlations, not causal explanations.

## Preliminary design system

This is a proposal for the concept study. Existing PRODUCT.md, DESIGN.md and CSS are not changed.

| Role | Proposed treatment |
| --- | --- |
| Display/title | Plus Jakarta Sans, 40/48, weight 650–700; used sparingly. |
| Page heading | 32/40, weight 650. |
| Section heading | 18/26, weight 600. |
| Body | Segoe UI, 16/24, weight 400. |
| Labels | 13/18, weight 500; normal sentence case. |
| KPI numbers | 52/56 primary; 26/32 supporting; tabular figures. |
| Tables | 14/20, tabular numbers, right-aligned measures; comfortable 40–44px rows. |
| Metadata | 12/18 minimum, only for secondary context. |
| Spacing | 4, 8, 12, 16, 24, 32, 48; 24px content gutters, 32px section separation. |
| Radius | 4px tags, 8px controls, up to 12px major surfaces; no universal pill shape. |
| Elevation | Flat analytical content; hairline dividers; a restrained shadow only for menus, drawers and dialogs. |

| Color role | Value / use |
| --- | --- |
| Primary ink | `#182139`; headings and numeric evidence. |
| Action / selected | `#4F46B8`; a clear primary action or current view. |
| Accent | `#F6BEA5` with dark ink; selective emphasis, never a status by itself. |
| Positive | `#17684F`; confirmed success, accompanied by text. A numerical increase is not automatically good. |
| Warning | `#8A5700` on `#FFF4DC`; incomplete/stale evidence. |
| Negative | `#A33B2B`; error or an explicitly labeled decrease, not moral judgment. |
| Neutral | `#586174`; secondary text. |
| Surfaces | `#F7F8FA` canvas, `#FFFFFF` evidence, `#EFEDF9` selected/control field. |
| Dividers | `#DDE1E8`; decorative separation. Interactive boundaries need their own sufficient contrast. |
| Chart roles | Petrol `#535E8D`; ELECTRIC(BOV) `#137C73`; PURE EV `#7258AC`; PETROL(E20) `#AD602F`; CNG `#2F718C`; ethanol gray. Pair marks with exact labels; color alone never identifies a fuel. |

**Component principles:** a card exists only when a task needs grouping. KPIs have unequal emphasis. Primary filters are small and direct; advanced scope uses a labeled editing surface. Charts answer one named question and have a table alternative. Tables minimize grid lines and emphasize alignment. Navigation has one model at each level and visible active state. One primary button per task region; exports are secondary unless the page's task is exporting. Badges describe real states. Dialogs retain context, close predictably and return focus. AI interprets a question into reviewable filters; it does not impersonate an independent source of registrations.

**Motion proposal:** feedback 150–200ms; selected tabs 180ms; results crossfade 150ms; panels/dialogs enter 240ms and exit 180ms. Indicate an action immediately; animation never delays its result or input. Report feedback follows actual queued/running/ready/failed states, not fabricated progress percentages.

Calculated contrast of the proposed token pairs: ink/white 15.96:1; secondary text/white 6.22:1; white/action-indigo 7.24:1; ink/apricot 9.75:1; warning text/paper 5.58:1. These checks cover proposed colors, not the rasterized mockups or an implemented interface. Touch controls target 44px; keyboard focus, error recovery and reduced motion remain explicit design requirements.

## Data used for this pass

Source artifact: `ui-preview-screenshots/two-wheeler-maharashtra-2024-result.png`. This is a **historical project screenshot**, not a newly verified official or live database result. It offers a broader design context than the first pass's fork-lift slice. Totals reconcile arithmetically within the screenshot; this does not establish source validity.

Scope: Maharashtra; all loaded RTOs; January–December 2024; `TWO WHEELER(NT)` and `TWO WHEELER(T)`. Retain Class, Norms, Fuel, exclusions and exact source categories in expanded scope.

| Fuel label as shown | Registrations |
| --- | ---: |
| PETROL | 17,74,110 |
| ELECTRIC(BOV) | 1,28,983 |
| PURE EV | 81,190 |
| PETROL(E20) | 59,072 |
| CNG ONLY | 8,022 |
| ETHANOL(E100) | 52 |
| Total | 20,51,429 |

Both electric labels remain separate. A future grouped EV KPI requires a confirmed grouping definition; a convenient display must not silently change the calculation. Diesel and hybrid are not assigned invented zeroes.

Monthly totals Jan→Dec: **1,73,348; 1,48,091; 1,52,806; 1,73,552; 1,60,256; 1,35,274; 1,40,476; 1,37,112; 1,38,070; 2,59,252; 2,68,441; 1,64,751.** Their sum equals 20,51,429.

Derived: November peak 2,68,441; December versus November −38.6%; Jul–Sep 4,15,658; Oct–Dec 6,92,444; the latter is +66.6% versus the former. No cause, forecast or year-on-year claim follows from these figures.

## Concept A — Executive Intelligence

![Executive Intelligence](<C:/Users/amogh/Desktop/BHAIYA/Vahan EY/.impeccable/mocks/second-pass-2026-09-06/A-executive-intelligence.png>)

**Job / user:** quick understanding for decision-makers and occasional analytical users.

**Structure:** horizontal global navigation, an open three-part summary, a dominant trend beside fuel composition, and short next-step links. The monthly table is behind View data, not forced into the opening screen.

**Why this layout:** answer size is primary; peak and latest movement are secondary; supporting composition answers what contributed. The absence of a permanent sidebar and table leaves a calm first viewport.

**Filters / AI / reports:** non-default chips plus More filters; compact Ask Vahan command in the masthead; Export answer and Monthly reports are separate actions.

**Interaction specification:** Animate UI-inspired filter sheet and navigation selection; React Bits-inspired short result crossfade, with no count-up; reuse existing query submission, filters, chart selection and export logic; custom semantic summary and responsive navigation. No dependency is selected.

**Mobile:** header menu, question entry, scope summary, total, trend, then fuel details; supporting measures wrap beneath the total. View data opens a readable table surface. No hidden source status.

**Advantages:** lowest visual noise and clear executive hierarchy. **Weaknesses:** table is one action away; subtle controls may be missed; broad fuel composition can become a long list. **Difficulty: Medium.**

## Concept B — Analytics Command Center

![Analytics Command Center](<C:/Users/amogh/Desktop/BHAIYA/Vahan EY/.impeccable/mocks/second-pass-2026-09-06/B-analytics-command-center.png>)

**Job / user:** compare matched periods and inspect differences, for analysts and power users.

**Structure:** labeled global sidebar, two equal-width period columns using the same chart scale, one shared evidence table. This is a comparison workspace, not the previous permanent-filter-inspector design.

**Why this layout:** symmetry makes A/B comparison easier; shared scale prevents visual exaggeration; a single table consolidates the evidence instead of repeating it under two independent results.

**Filters / AI / reports:** common scope appears once; Edit periods changes dates in a drawer; Ask Vahan can supply either comparison question; Month/Fuel switches dimension. Export comparison and monthly report entry retain clear context boundaries.

**Interaction specification:** Animate UI-inspired period editor and dimension tabs; React Bits-inspired replacement fade only when the result set changes; reuse the existing Compare route's two-query results and CSV/PDF machinery where compatible; custom shared selection/table model and matched-scope validation.

**Mobile:** A and B stack with matching scales; a persistent text difference remains visible. Evidence switches to month rows with a period label. Advanced controls move into a sheet rather than shrinking.

**Advantages:** strongest comparative analysis and evidence visibility. **Weaknesses:** not the best default landing screen; cross-context comparisons need strong validation; the shared-table behavior is new. **Difficulty: Hard.**

## Concept C — AI-First Analytics

![AI-First Analytics](<C:/Users/amogh/Desktop/BHAIYA/Vahan EY/.impeccable/mocks/second-pass-2026-09-06/C-ai-first-analytics.png>)

**Job / user:** formulate an analytical question, inspect its interpretation and refine the result, for researchers and users less familiar with source filter terminology.

**Structure:** a question-to-answer canvas with a secondary Refine this answer area. Clear sequence: question → interpreted scope → result → supporting fuel/monthly evidence. No chat bubbles or fictional conversation history.

**Why this layout:** the interpretation is an editable intermediate result; AI is integrated into the workflow without taking space from the chart. Suggested follow-ups are proposed questions, never preclaimed answers.

**Filters / AI / reports:** the question is primary; visible interpretation chips and a full-filter editor remain available. Refinement offers period comparison or a fuel-specific query. Monthly reports and Export answer sit beside the completed result.

**Interaction specification:** Animate UI-inspired refinement disclosure and focus-managed scope dialog; React Bits-inspired short reveal after the query is resolved; reuse existing query parsing/clarification/reliability handling and exports; custom orchestration of question, pending interpretation and applied evidence states.

**Mobile:** input, interpretation, answer and chart appear in that order; refinement becomes an inline accordion below the answer. Query entry stays keyboard-accessible without covering the result.

**Advantages:** strongest AI integration and understandable scope. **Weaknesses:** input can dominate returning users' workspace; follow-ups must not imply unsupported conversational memory; interpretation errors require excellent recovery. **Difficulty: Medium–Hard.**

## Concept D — Visual Data Story

![Visual Data Story](<C:/Users/amogh/Desktop/BHAIYA/Vahan EY/.impeccable/mocks/second-pass-2026-09-06/D-visual-data-story.png>)

**Job / user:** understand and communicate the shape of a year's registrations, for reviewers and analytical storytellers.

**Structure:** horizontal global navigation and separate content chapters, an oversized year total, a wide annotated monthly plot, and a concise fuel-composition summary. The hierarchy is narrative, not a grid of dashboard modules.

**Why this layout:** chart space makes the late-year peak visible. Annotations state observations rather than explanations. Secondary composition provides another question after the trend rather than competing with it.

**Filters / AI / reports:** concise place/year/category scope, More filters for detail, small Ask Vahan entry. View monthly data and Monthly reports provide the evidence and publishing paths.

**Interaction specification:** Animate UI-inspired chapter/selection indicator; React Bits-inspired one brief annotation fade when the selected month changes; reuse monthly data, fuel details and exports; custom narrative annotations and accessible chapter navigation. No scroll hijacking, autoplay or pinned animation sequence.

**Mobile:** a shorter chart with fewer visible axis ticks, exact values on tap/focus and the table alternative; annotations become text below the plot. Fuel composition switches to a direct-label list if segments become too small.

**Advantages:** strongest chart emphasis and communication. **Weaknesses:** weaker repeated filtering; a narrative can overemphasize selected events; tiny fuel shares need a non-graphical fallback. **Difficulty: Medium.**

Image review chose a direct-label fuel summary instead of the generated stacked bar: its proportions were misleading. The final composition preserves the dominant monthly plot and avoids using inaccurate marks merely for visual variety.

## Concept E — Best-of-System

![Best-of-System](<C:/Users/amogh/Desktop/BHAIYA/Vahan EY/.impeccable/mocks/second-pass-2026-09-06/E-best-of-system.png>)

**Job / user:** scan an answer, inspect its trend and immediately ask the next question, for mixed analyst/stakeholder teams.

**Structure:** top-level navigation, an asymmetric metric/fuel column on the left and a larger trend/evidence area on the right. A bottom Ask Vahan bar belongs to the document layout; it must not cover the table. This is not the first pass's sidebar-plus-context-rail layout.

**Why this layout:** totals and composition share one aligned area; most width goes to the trend; the query is easy to reach after reading, without consuming the top third of the screen. The asymmetry provides identity while remaining functional.

**Filters / AI / reports:** compact current scope and Filters; full editor groups geography/time, vehicle context, and fuel/norms. Ask Vahan remains visible at the lower action boundary. The report menu separates answer download from monthly-report scope.

**Interaction specification:** Animate UI-inspired filter sheet, report dropdown and active navigation; React Bits-inspired result replacement feedback without number interpolation; reuse query, reliability, trend selection and CSV/PDF behavior; custom layout, filter staging and dock keyboard/viewport handling.

**Mobile:** the dock becomes an ordinary top-of-content query form when the keyboard opens; primary total and trend precede full fuel detail. The scope editor becomes a sheet; table access and provenance stay visible. No fixed footer covering content.

**Advantages:** strongest overall balance and distinctive task arrangement. **Weaknesses:** bottom query placement needs user testing; long fuel labels must wrap; mobile keyboard behavior adds complexity. **Difficulty: Medium.**

## Reference contribution by concept

| Concept | R1 Skillify | R2 InfoGraphix | R3 ACERO | R4 Finance |
| --- | --- | --- | --- | --- |
| A | Task grouping in menus | Unequal statistical emphasis | Calm spacing | Trend then evidence |
| B | Functional navigation groups | Comparative chart modules | Control alignment | Evidence-table discipline |
| C | Primary workspace plus support | Compact answer measures | Quiet surface contrast | Clear result hierarchy |
| D | Visible selected context | Chart-to-number scale | Breathing room | Restrained chart framing |
| E | Clear task regions | Unequal region sizes | Warm spatial rhythm | Chart/table continuity |

## Provisional scoring

Scores are comparative design judgments, not usability or accessibility test results. No implementation exists, so accessibility and responsiveness cannot receive verified passing scores. Maintainability estimates assume vanilla JS and reuse of existing functions.

| Criterion / 10 | A | B | C | D | E |
| --- | ---: | ---: | ---: | ---: | ---: |
| Visual quality | 7 | 7 | 7 | 8 | 8 |
| Usability | 8 | 7 | 7 | 7 | 8 |
| Information hierarchy | 8 | 8 | 8 | 8 | 8 |
| Analytics capability | 6 | 9 | 7 | 7 | 8 |
| Filter UX | 7 | 8 | 8 | 6 | 8 |
| AI integration | 6 | 6 | 9 | 6 | 8 |
| Accessibility potential | 7 | 6 | 7 | 6 | 7 |
| Responsive potential | 8 | 6 | 7 | 7 | 7 |
| Maintainability | 8 | 6 | 6 | 7 | 7 |
| Enterprise feel | 8 | 8 | 7 | 7 | 8 |
| Uniqueness | 6 | 7 | 8 | 8 | 8 |

## Recommendation

**E is the recommended direction**, subject to review of the actual image and the dock-placement trade-off. Its main strength is coherent allocation of space: measures left, analytical evidence right, next question below.

- Best layout: E.
- Best navigation for an expert multi-route product: B; A's grouped top navigation is preferable for occasional users.
- Best KPI emphasis: A.
- Best filter system: E's compact scope plus grouped full editor; B for explicit two-period editing.
- Best chart composition: D for communicating a trend; B for direct comparison.
- Best AI integration: C.
- Best interaction balance: E; effects confirm actions without delaying evidence.
- Easiest adoption: A, assuming reuse of current data/query/export behavior.

An optional sixth synthesis would use E's main structure, A's summary restraint, C's reviewable interpretation step and B's dedicated comparison mode. It would keep D's annotation treatment only when a fact warrants emphasis. This is an unimplemented combination, not a selected design or implementation plan.

## Review boundaries

Five 1536×1024 desktop images were generated with the built-in image tool and inspected, followed by one bounded correction pass. Exact generation prompts are in `dashboard-second-pass-prompts.json`, correction intent in `dashboard-second-pass-corrections.json`, and the historical monthly fixture in `dashboard-second-pass-fixture.csv`. No source UI edits were made: SHA-256 hashes for `public/index.html`, `public/app.js`, `public/styles.css`, `public/atlas.css` and `package.json` match the baseline taken during this pass. Existing dirty work was retained. No UI changes were committed.

The five concepts share a palette and type system intentionally; their structural distinction lies in executive summary, matched comparison, guided question interpretation, annotated yearly story and asymmetric overview. Some plot geometry remains illustrative rather than a pixel-exact rendering of the fixture. Mobile behavior is specified in writing, not demonstrated by a functioning prototype or tested mobile screen.

The generated images are visual composition studies. Their exact numeric labels and marks need inspection; the data table in this document is the authoritative fixture for this design exercise. Images cannot prove keyboard support, contrast compliance, focus order, filter correctness, responsive behavior or API support. Any generator-introduced claims must be rejected rather than implemented.

Stop after presenting and comparing the five concepts. Wait for explicit design approval before planning or changing the UI implementation.
