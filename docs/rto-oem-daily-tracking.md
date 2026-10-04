# Saved OEM daily tracking

The selection is frozen from calendar-year 2025 registration evidence for the existing 100-RTO Daily cohort. Each RTO has six independent scopes: EV/ICE × 2W/3W/4W. Each scope saves up to five verified makers in 2025 rank order. Short source rankings remain incomplete; missing evidence never becomes zero.

Daily collection queries only the saved maker IDs with the current calendar-year filters. The report shows the net change between compatible observations on consecutive IST dates, with the current and previous cumulative counts available in details. The first observation cannot establish a daily change. Decreases are source corrections. Unchanged observations without an upstream freshness timestamp are marked unconfirmed rather than presented as a verified zero.

## Operations

Apply the additive schema using the configured production database:

```powershell
node --env-file=.env.neon scripts/apply-rto-oem-tracking-schema.mjs --production
```

Create a version from a frozen 100-RTO cohort, or explicitly resume it:

```powershell
node --env-file=.env.neon scripts/collect-rto-oem-tracking.mjs --production --mode baseline --selection-year 2025 --cohort-run-id 1645
node --env-file=.env.neon scripts/collect-rto-oem-tracking.mjs --production --mode baseline --resume-baseline-id BASELINE_ID
```

The `RTO Saved OEM Daily Production Collection` GitHub workflow supports these baseline operations through its manual inputs. Daily collection follows completion of `RTO Daily Neon Production Collection`, including a failed parent run. The previous annual OEM workflow is manual-only. Before activation, an automatic Daily run produces an explicit skipped audit.

```powershell
node --env-file=.env.neon scripts/collect-rto-oem-tracking.mjs --production --mode daily
```

A full attempted pass activates the verified selection even when some scopes are unavailable. Its coverage audit still reports partial and exits unsuccessfully. A stopped run or a limited pilot cannot activate a baseline. Resuming skips verified selections and daily observations, retries unavailable evidence, and never silently changes verified 2025 rankings. To refresh an incomplete ranking, explicitly create a new baseline version. Historical report dates keep the version that was activated by that date.

Collection uses the shared VAHAN advisory lock, paced requests, bounded retries, and checkpoints. A request crossing IST midnight is never backdated. Direct Neon connections are used for the session lock. Raw source responses expire after 30 days; compact evidence and hashes remain, daily observations have 365-day retention, and frozen selections are retained permanently.

## Source verification

The 4 October 2026 read-only pilot verified the year and maker filters for AP31, Jaipur RJ14, and Pimpri-Chinchwad MH14. AP31 EV 2W Ather had 1,290 registrations in the 2025 selection and 1,449 in the 2026 source observation. MH14 EV 3W Zenmo was absent from the current chart; the individual saved-maker query explicitly returned zero. These prove the filtered source contract, not full cohort coverage. Other pilot scopes returned HTTP 404 and remained unavailable.

The source supplies literal maker names as filter IDs. Catalog matching requires one exact normalized match. Filtered chart totals are reconciled against the same-filter registration headline; incomplete charts fall back to individual saved-maker counts. Empty charts alone never prove zero.

## Verification and API

```powershell
npm.cmd test
npm.cmd run check:oem-tracking
npm.cmd run check:oem-tracking:integration
node --env-file=.env.local-postgres scripts/rto-oem-annual-api-check.mjs
```

Integration checks create and drop an isolated local PostgreSQL test schema. Tests cover scope/year/maker provenance, immutability, missing baselines, nonadjacent dates, year rollover, source corrections, unconfirmed unchanged counts, stop/resume behavior, and browser rendering.

`GET /api/rto-reports/oem-daily?state=...&rto=...&date=YYYY-MM-DD` serves saved evidence without scraping. Report CSV, HTML, and PDF exports use the same selected-date payload. The annual API remains compatible; annual figures are shown as supporting evidence until a baseline exists.
