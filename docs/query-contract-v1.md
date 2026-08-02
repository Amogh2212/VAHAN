# Dashboard query contract v1

Status: Phase 1 contract freeze
Contract version: `dashboard-query-v1`
Scope: `POST /api/query` registration-total questions

## Objective

This document freezes the query meaning that later hardening phases must
preserve. It does not change parsing, database, scraper, refresh, provider, or
UI behavior.

The endpoint answers one vehicle-registration total with monthly rows. A
supported question may constrain geography, date, fuel, one vehicle selector,
emission norm, and supported exclusions. Different dimensions intersect
(`AND`). Multiple canonical labels inside one dimension form a union (`OR`).
A zero-row answer can still be a semantically correct answer.

The machine-readable companion is
`data/query-tests/dashboard-query-contract-v1.json`. Its expected filters are
an independent oracle and must not be generated from the parser under test.

## Canonical filter shape

Every corpus case carries the complete shape below, including explicit empty
arrays. Rejected cases carry the same recognized-filter shape plus an expected
error.

```json
{
  "state": null,
  "rtoContains": null,
  "from": null,
  "to": null,
  "metric": "registrations",
  "fuelSegment": null,
  "fuelType": null,
  "fuelFilters": [],
  "selectedFuelTypes": [],
  "vehicleCategories": [],
  "selectedVehicleCategories": [],
  "selectedVehicleGroups": [],
  "vehicleClasses": [],
  "selectedVehicleClasses": [],
  "norms": [],
  "selectedNorms": [],
  "excludedFuelTypes": [],
  "excludedVehicleGroups": [],
  "excludedVehicleClasses": [],
  "excludedVehicleCategories": [],
  "excludedNorms": []
}
```

`rtoContains` is a stable canonical code fragment for tests. The API may return
the longer official RTO label in `filters.rto`.

The compatibility fields (`fuelSegment`, `fuelType`, `fuelFilters`,
`vehicleCategories`, `vehicleClasses`, and `norms`) remain observable API
fields. The `selected*` and `excluded*` arrays are the authoritative semantic
selection.

## Supported dimensions

### Geography (`G`)

- One state, one city/RTO alias, or one RTO code.
- State-only scope uses the all-RTO aggregate for that state.
- RTO codes accept punctuated, spaced, and compact forms such as `MH-12`,
  `MH 12`, and `MH12`.
- A resolved RTO determines its state.
- Exact state/RTO/code matches take precedence over fuzzy location repair.
- Multiple states, multiple RTOs, or a state that conflicts with a resolved
  city/RTO are contradictions and must be rejected locally.
- India-wide scope (`state: null`) remains available when geography is omitted,
  preserving existing dashboard behavior.

### Date (`D`)

- Inclusive canonical bounds use `YYYY-MM`.
- Supported forms include:
  - month names and abbreviations;
  - numeric `YYYY-MM`, `YYYY/M`, and `M/YYYY`;
  - month ranges;
  - calendar years and year ranges;
  - calendar quarters;
  - consecutive fiscal years;
  - current month, previous month, year-to-date, and last N months.
- A partial future range is capped at the current month with a warning.
- A future-only range and a reversed range are errors.
- Exact-day requests are unsupported because result rows are monthly.
- Omitting a date continues to mean all loaded months, preserving current
  behavior.

Relative-date cases use a fixed `TEST_CURRENT_MONTH` during automated tests.

### Fuel (`F`)

- Exact fuel labels are authoritative.
- Plain families expand to their canonical labels.
- Exact or family values within this dimension form a union.
- The compatibility fields must agree with the canonical selection; they may be
  null when a family contains more than one exact fuel label.

### Vehicle selector (`V`)

The current dashboard counting path supports three user-facing selector modes:

- broad group wording;
- exact VAHAN vehicle category;
- exact VAHAN vehicle class.

Broad `2W`, `3W`, and `4W` wording is implemented as canonical category
expansion in the current counting path. `selectedVehicleGroups` is
interpretation metadata only and is not independently applied to stored rows.
The contract therefore expects the category expansion and an empty
`selectedVehicleGroups` array for those broad forms.

An explicit class and an explicit category may coexist and intersect, as in
`passenger cars`. Explicit class/category evidence suppresses any additional
broad-group inference.

### Emission norm (`N`)

- Norms resolve only to canonical VAHAN side-filter labels.
- Exact vocabulary and documented abbreviations take precedence over fuzzy
  repair.
- Multiple selected norms form a union inside the norm dimension.

### Exclusion (`X`)

- Supported exclusions target exact fuel, vehicle category, vehicle class, or
  emission-norm labels.
- Positive filters are extracted first; exclusions are applied afterward.
- An include/exclude collision is a contradiction and must not silently broaden
  the query.
- Broad vehicle-group exclusion is not supported by the current data path and
  must be rejected.
- The current data path supports only one excluded side-filter dimension among
  category, class, and norm in a single query.

### Metric

The only metric is `registrations`. The result contains:

- filtered source rows;
- total registrations;
- monthly trend;
- fuel breakdown;
- peak month and peak count;
- filter, freshness, warning, and data-status metadata.

## Preserved wording

| Wording | Canonical interpretation |
| --- | --- |
| `car`, `cars`, `motor car` | class `MOTOR CAR` only |
| `LMV`, `light motor vehicle` | category `LIGHT MOTOR VEHICLE` only |
| `passenger car(s)` | class `MOTOR CAR` intersected with category `LIGHT MOTOR VEHICLE` |
| `four wheeler`, `4W` | categories `LIGHT MOTOR VEHICLE` and `LIGHT PASSENGER VEHICLE`; no class |
| `two wheeler`, `2W` | categories `TWO WHEELER(NT)` and `TWO WHEELER(T)` |
| `three wheeler`, `3W` | categories `THREE WHEELER(NT)` and `THREE WHEELER(T)` |
| plain `EV`, `electric`, `BOV` | `ELECTRIC(BOV)` and `PURE EV` |
| `pure EV` | `PURE EV` only |
| `electric BOV` | `ELECTRIC(BOV)` only |
| `hybrid` | all seven canonical hybrid labels |
| `PHEV` | `PLUG-IN HYBRID EV` only |
| `strong hybrid` | `STRONG HYBRID EV` only |
| plain `LPG` | `LPG ONLY`, `PETROL/LPG`, and `PETROL(E20)/LPG` |
| `LPG only` | `LPG ONLY` only |
| `non-EV` | `fuelSegment: NON_EV` and exclusion of both battery-electric labels |

## Precedence

The required interpretation order is:

1. Reject clearly unsupported intent and hard contradictions locally.
2. Prefer exact RTO/state/code evidence to fuzzy geography.
3. Prefer exact canonical vocabulary to aliases, aliases to abbreviations, and
   abbreviations to conservative fuzzy matches.
4. Prefer the longest, most specific exact phrase when aliases overlap.
5. Extract each positive semantic dimension independently.
6. Let explicit class/category evidence suppress broad-group inference.
7. Preserve exact deterministic evidence when an AI repair is merged.
8. Apply exclusions after positive filters; a direct collision is an error.
9. Validate the final canonical labels and internal consistency.
10. Never invent an omitted value.

These are contract rules. Later phases are responsible for making the runtime
follow all of them.

## Routing policy

Each corpus case declares one policy:

- `local_required`: deterministic handling is required and Groq calls are
  forbidden.
- `local_reject`: the query must be rejected or clarified locally and Groq
  calls are forbidden.
- `groq_allowed`: unusual but apparently supported wording may use Groq. If the
  provider is unavailable or its proposed labels fail validation, the endpoint
  must ask for a rephrase rather than return weak deterministic filters.

There is no `groq_required` policy. Provider availability never determines
whether a query is safe.

## Unsupported intents

The dashboard must reject without Groq:

- comparisons and rankings;
- top/bottom lists;
- state-wise, RTO-wise, district, manufacturer, maker, OEM, brand, or model
  breakdowns;
- daily, weekly, quarterly, or annual grouping requests;
- shares, percentages, growth, CAGR, forecasting, or causal explanations;
- exact-day requests;
- unrelated subjects or questions with no supported registration subject.

The expected API contract is HTTP `422` with
`details.code: "unsupported_dashboard_query"` where that structured code
applies.

## Corpus coverage

The validator requires:

- 14 atomic modes:
  - geography: state and RTO;
  - date: month and range;
  - fuel: exact and family;
  - vehicle: group, category, and class;
  - norm;
  - exclusion: fuel, category, class, and norm;
- all 15 valid pairs among `G`, `D`, `F`, `V`, `N`, and `X`;
- all 20 valid triples among those axes;
- at least six full combinations rotating state/RTO, month/range,
  exact/family fuel, group/category/class, and supported exclusion types;
- three equivalence sets with at least five word orders each;
- documented aliases and abbreviations;
- approved single and multiple spelling mistakes;
- isolated unsupported-intent cases;
- isolated contradiction cases;
- at least one genuinely unusual supported case marked `groq_allowed`.

Every case has target canonical filters, routing policy, activation phase,
provenance, and data assertions.

## Phase activation

`activationPhase` records when a case becomes a mandatory runtime gate:

- Phase 1 freezes structure and protects already-working behavior.
- Phase 2 activates normalization and abbreviation cases.
- Phase 3 activates compositional and contradiction cases.
- Phase 4 activates approved fuzzy spelling cases.
- Phase 5 activates routing and clarification cases.
- Phase 6 activates validated AI-repair cases.
- Phase 7 makes the complete corpus a release gate.

Staging does not weaken the expected filters. It prevents Phase 1 from
pretending later-phase parser work has already been implemented.

## Legacy 50-case baseline

The historical file
`data/query-audits/random-filter-oracle-2026-07-30.csv` remains immutable:

- SHA-256:
  `0f3b1865d0579a70dabce11b919b618fd5225034ba06a7af32813292e5fa1d5c`;
- 50 unique cases;
- mix: 30 coverage, 10 spelling/shorthand, 10 paraphrase.

The latest pre-Phase-1 deterministic baseline was 38 canonical passes and 12
filter mismatches. It was never a 50/50 passing suite. Phase 1 therefore
enforces:

- exact legacy file integrity;
- all 38 previously passing cases must remain passing;
- no Groq use;
- no unexpected live refresh;
- no data-file mutation;
- improvements are allowed, regressions are not.

The 12 known gaps remain visible target failures for later phases. Calling the
legacy oracle "50/50 passing" would be inaccurate.

## Validation safety

Phase validation must:

- use a dedicated local port;
- use `AI_QUERY_PROVIDER=none`;
- blank external AI keys in the test process;
- set `VAHAN_DISABLE_LIVE_REFRESH=1`;
- disable Telegram polling and the factor agent;
- use in-memory test rate limits;
- avoid scraper, scheduler, queue, migration, schema, and provider calls;
- profile the database with `SELECT` only;
- hash the actual VAHAN CSV, `_errors.jsonl`, and `_summary.json` files before
  and after execution;
- assert `liveRefresh` is absent/null;
- compare filters before judging data availability;
- recompute total, monthly trend, fuel breakdown, and peak values from returned
  rows;
- treat zero rows as a separate data-availability observation.

## Known Phase 1 limitations

- The frozen legacy suite starts at 38/50 deterministic canonical matches.
- Independent vehicle-group selectors are not applied to stored rows.
- Some RTO codes, no-space `BS4`/`BS6`, full 2W/3W/4W expansion, and
  paraphrase equivalence are known parser gaps.
- Some conflicting fuels or include/exclude collisions are not yet rejected.
- AI is currently invoked before all deterministic support/conflict checks in
  the runtime; later routing phases must correct that.
- The current oracle does not compare directly with the live VAHAN website.

These are explicit later-phase targets, not reasons to alter runtime behavior in
Phase 1.
