# RTO source-scope incident and recovery gate

## Finding

The original hosted run proved throughput, not source correctness. The September
8 and 9 production reports must not be used as trusted RTO stock baselines or as
daily registration flow. A successful job count was insufficient evidence.

Read-only inspection found 600 segment reports on each date (100 RTOs × six
fuel/category segments), in collection runs 1604 and 1605. None carries the new
verified source-scope contract. The six Odisha RTOs account for 36 reports per day.
No production rows were deleted or overwritten during diagnosis.

## Browser-confirmed contract

Observed on the official Public Dashboard on September 9, 2026, with **As On Date**,
active compliant and active non-compliant vehicles selected:

- State values come from the live `stateCode` select; Odisha is **OR**, not OD.
- RTO values come from `/analytics/json_rtos?stateCode=OR`, not a number guessed
  from a display label. The exact office identity must match the live catalog.
- Chart requests include `fromYear=2026`, `toYear=2026`, `timePeriod=2`, an explicit
  RTO, category/fuel filters, and only the two active archive scopes.
- The dashboard headline uses the same scope but PHP-style array parameters
  (`vehicleFuels[]`, `vehicleSubCategories[]`). Its total must equal the category
  chart total. The source top-five manufacturer rows must reconcile within it.

Browser and repaired client agreed on EV two-wheelers:

| Office | Verified active stock | Source-code mapping |
| --- | ---: | --- |
| Balasore | 20,236 | OR / 1 |
| Pune | 149,238 | MH / 12 |

The old saved Balasore EV two-wheeler total was 1,405,015. Besides the Odisha
mapping error, old requests omitted the year/time-period parameters used by the
browser. Merely correcting OD to OR does not repair the complete source contract.

The seed retains its immutable historical labels. Twelve names differ from the
live catalog (11 Delhi offices and Maharashtra's MH16). An explicit name crosswalk
requires both the known legacy identity and exact current catalog identity; fuzzy
or numeric-only matches are forbidden. `validation.mapping.rtoLabel` records the
actual current office name. This is current-office collection, not proof that a
renamed/moved office is historically comparable across the rename.

## Evidence and fail-closed checks

`scripts/rto-source-pilot.mjs --mapping-only` resolved all 100 members. The small
live pilot collected all six segments for Pune, Delhi South and Balasore: 18/18
passed. Runtime artifacts are `artifacts/rto-source-mapping.json` and
`artifacts/rto-source-pilot.json`; these are not production data migrations.

The `public-stock-v2` contract stores mapping/catalog, request and response hashes,
observation timestamps, filters, an independently requested headline, categories,
and the actual source top-five rows. Hashes provide traceability, not a cryptographic
attestation by the source. The source does not echo a signed filter scope or a
dataset-refresh timestamp. Browser comparison, explicit mapped requests, headline
reconciliation and cross-RTO duplicate detection provide complementary checks.

Readiness checks all 600 report identities and exact persisted OEM rows, not only
aggregate row counts. Repeated positive six-segment response fingerprints across
different RTOs fail readiness. Identical observations across dates remain possible:
they do not independently prove fresh underlying source data. Empty chart payloads
are not zero unless a valid matching headline explicitly reports zero.

## Report meaning

Primary metrics and charts describe **active vehicle stock**, not daily sales or
registrations. Calendar-boundary stock differences are explicitly *net stock
movement*, which can include corrections, cancellations and status changes. A
missing baseline remains unavailable; it is never assumed to be zero. OEM tables
use the source's dynamic top five for each segment, not a fixed manufacturer list.

Old persisted report payloads are quarantined at read time and omitted from new
comparison inputs. Their stored records remain untouched. CSV/PDF cache versions
change so old exports cannot bypass the new report contract.

## Safe recovery and historical data

1. Keep the production workflow disabled until the new full hosted test is verified.
   The separate manual hosted workflow remains available with ephemeral PostgreSQL
   and no Neon credentials.
2. Complete offline/database/browser regressions; then run the entire 100-RTO
   feature branch on GitHub Actions. Review all 600 segment evidence records,
   mappings, source/stored OEM rows and `100/100` source eligibility, not just green CI.
3. Review and merge the focused repair PR. Confirm the website runs that revision
   and renders verified stock with the limitation visible.
4. Obtain explicit approval before any historical production cleanup or rerun that
   would overwrite the same snapshot-date keys. Export/back up affected runs and
   their dependent reports before an approved quarantine migration or deletion.
5. Start a new verified baseline on a fresh observation date. **Do not backfill
   September 8–9 from today's stock endpoint**: it does not provide historical
   as-of snapshots. Historical reconstruction needs archived, correctly scoped
   source evidence; without it those dates stay unavailable.
6. Only after credible full-run evidence and production verification, re-enable
   the daily schedule. GitHub scheduling can be delayed: the September 9 scheduled
   run was created at 23:02 UTC on September 8 (04:32 IST), not exactly 02:30 IST.

Production GitHub runs inspected: manual `34245523281`, scheduled `34288793807`.
The corrected full hosted run has not yet been executed at the time of this note.

### Validation checkpoint

- Isolated PostgreSQL integration passed: 100 synthetic RTOs, 600 reports,
  genuine zero fixture, missing/tampered OEM rows, missing legacy evidence,
  duplicate positive response fingerprints, report materialization, unavailable
  first baseline, and read-time historical quarantine. The cluster was stopped;
  retained diagnostic directory ends in `source-check-7f412eed-d01b-4161-93f1-a477b6121e41`.
- Worker/source and report unit checks passed again after the final local OEM
  null-handling and export/context changes. Secret scan passed; server syntax passed.
- Every constituent check in `npm test` passed across the verification runs.
  Two frozen data files needed LF normalization locally because Windows checkout
  line endings changed byte hashes. Their expected hashes were NOT changed and
  the line-ending-only changes must NOT be included in the repair PR.
- A real browser opened the local three-RTO preview using the live pilot data.
  It rendered Pune's 170,998 EV stock and dynamic source OEMs. The only console
  error was a missing preview favicon. The preview exposed a hardcoded `100/100`
  badge and partial OEM totals; those were subsequently corrected. Final browser
  refresh, screenshot and integration rerun after those last edits remain pending.
- GitHub API last confirmed production state `disabled_manually`. Approval review
  then hit its usage limit while attempting the browser refresh. No push, repair PR,
  full hosted dispatch, merge or production re-enable has occurred.

Outstanding release checks: final rendered UI/export checks, current-revision full
database regression, legacy batch availability/status accuracy, focused diff review,
branch push/PR, the full real 100-RTO hosted run and artifact review, then an approved
production rollout. Keep the schedule paused while these are incomplete.

Update at 14:33 UTC: privileged access recovered. Final isolated database regression
passed, including legacy batch counts and status filters (diagnostic cluster suffix
`source-check-7610a633-b309-48e5-b286-f89983ca9065`, stopped). Desktop/mobile browser
checks passed for all three real pilot totals with N/A baselines and no horizontal
mobile overflow. Screenshots are under `output/playwright/rto-source-pilot-*.png`.
The screenshot was visually inspected: source stock labels, explicit limitations,
dynamic OEM rows and unknown partial OEM totals render correctly. These are local
preview results, not evidence of a production deployment or a full hosted run.

## Reproduction

- Offline contract/worker checks: `npm.cmd run check:rto-daily`.
- Report contract checks: `npm.cmd run check:rto-reports`.
- Isolated database checks: `node scripts/rto-source-db-check.mjs`. This creates a
  new loopback-only cluster, ignores configured database URLs, stops it afterward,
  and retains its synthetic files under `.local/postgres/` for diagnosis.
- Read-only production inspection: `scripts/inspect-rto-source-history.mjs` using
  an explicitly selected production environment. It rejects non-Neon hosts and
  uses a read-only transaction. Do not print or commit its environment file.
