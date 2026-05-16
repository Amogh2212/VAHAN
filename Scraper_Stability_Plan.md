# Scraper Stability Plan

## Goal

Fix the VAHAN scraper logic in this repo so that:

- fresh queries do not fail because of brittle page automation
- scraper failures are visible and diagnosable
- the query API fails gracefully instead of returning misleading empty results

## Current Problem

The current backend may trigger live scraping during a user query in [server.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/server.mjs:579). When the scraper fails, the query flow falls through to zero matched rows, so the UI shows empty stats even though the real problem is a fetch failure.

Recent failures show timeouts waiting for VAHAN controls such as:

- `j_idt32_input`
- `j_idt41_input`
- `selectedRto_input`

These controls are used in [scripts/vahan-scraper.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/scripts/vahan-scraper.mjs:384).

## Root Causes

### 1. Brittle selectors

The scraper depends on hard-coded PrimeFaces-style IDs that can change when VAHAN updates the page or renders differently.

### 2. Weak recovery behavior

If VAHAN loads slowly or partially, the scraper times out instead of retrying with a refresh or full page reload.

### 3. Poor failure propagation

The query layer treats scrape failure almost the same as “no matching data,” so users see zero rows instead of a clear fetch error.

### 4. Limited debugging evidence

The current error logs capture the message, but not enough runtime artifacts like screenshots or HTML snapshots to diagnose layout changes quickly.

## Desired End State

After the fix:

- the scraper can find VAHAN controls more reliably
- transient failures are retried automatically
- scrape failures are returned as explicit warnings/errors
- the UI does not present empty results as if they were valid data
- logs contain enough evidence to debug selector breakage fast

## Work Areas

## 1. Make the scraper more resilient

Target file:

- [scripts/vahan-scraper.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/scripts/vahan-scraper.mjs)

### Changes

- Replace direct dependence on fixed IDs where possible.
- Prefer helper functions that locate dropdowns by:
  - nearby label text
  - known option values
  - stable semantic patterns
- Keep ID-based lookup only as a fast path, not the only path.

### Example direction

Instead of assuming `j_idt41_input` is always the state selector:

- scan available `select` elements
- match the control that contains known state options
- then choose the requested state

Do the same for:

- report type selector
- state selector
- RTO selector
- year selector
- axis selectors

## 2. Add retry and recovery logic

Target file:

- [scripts/vahan-scraper.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/scripts/vahan-scraper.mjs)

### Changes

- Add retry attempts around:
  - `openDashboard`
  - control selection
  - report refresh
  - report extraction
- On retry:
  - reload the page
  - reopen the dashboard
  - re-run control detection
- Use bounded retries, for example 2-3 attempts per scrape job.

### Recovery behavior

- first failure: retry after reload
- second failure: retry after full reopen
- final failure: record structured error and artifacts

## 3. Capture failure artifacts

Target file:

- [scripts/vahan-scraper.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/scripts/vahan-scraper.mjs)

### Changes

When a scrape attempt fails, save:

- screenshot
- HTML snapshot
- selected control inventory
- failure timestamp
- query context: state, RTO, year, month

Suggested output folder:

- `data/vahan/failures/`

Suggested file naming:

- `YYYYMMDD_HHMMSS_state_month_attempt.png`
- `YYYYMMDD_HHMMSS_state_month_attempt.html`
- `YYYYMMDD_HHMMSS_state_month_attempt.json`

This will make VAHAN layout regressions much easier to debug.

## 4. Improve table extraction robustness

Target file:

- [scripts/vahan-scraper.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/scripts/vahan-scraper.mjs:424)

### Current issue

The report parser assumes a recognizable “month-wise fuel table.” If VAHAN changes the table shape, the scraper throws errors like:

- `Could not find VAHAN report table after refresh`
- `Could not find month columns in VAHAN report table`

### Changes

- Expand table detection rules.
- Allow multiple candidate table shapes.
- Log sample headers before failing.
- Validate extracted month headers before continuing.
- Detect “no data available” states distinctly from parsing failure.

## 5. Distinguish scrape failure from empty data

Target file:

- [server.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/server.mjs)

### Current issue

The query flow currently:

1. parses filters
2. checks missing months
3. tries auto-scrape
4. reloads data
5. returns rows, which may still be empty

If scrape fails, the response still looks like a valid empty result.

### Required behavior

If scraping was attempted but failed, the API response should explicitly say:

- scrape was attempted
- scrape failed
- results may be incomplete or stale

### Response changes

Return structured fields such as:

- `scraper.autoTriggered`
- `scraper.success`
- `scraper.failedRuns`
- `scraper.errorSummary`
- `dataStatus`

Suggested `dataStatus` values:

- `complete`
- `partial`
- `stale`
- `fetch_failed`
- `missing`

## 6. Fail gracefully in the UI

Target file:

- [public/app.js](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/public/app.js)

### Current issue

The page renders zero totals and zero rows even when the backend scrape failed.

### Required behavior

If the backend reports `fetch_failed` or failed scrape attempts:

- show a warning banner
- avoid presenting zero rows as trustworthy
- explain that live fetch failed and cached/local data may be incomplete

### UI behavior options

- If stale data exists, show stale data plus warning.
- If no data exists, show a clear “Could not fetch fresh data” message.
- If partial scrape succeeded, show partial results with a caution banner.

Suggested warning text:

- `Live VAHAN fetch failed for this query. Results may be missing or stale.`

## 7. Prefer stale data over misleading empties

Target files:

- [server.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/server.mjs)
- [public/app.js](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/public/app.js)

### Policy

If scraping fails and older matching data exists:

- return the last known data
- mark it as stale
- include freshness and warning metadata

If scraping fails and no matching data exists:

- do not silently return a clean empty result
- return an error/warning state that the UI can render properly

## 8. Add better internal logging

Target files:

- [server.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/server.mjs)
- [scripts/vahan-scraper.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/scripts/vahan-scraper.mjs)

### Log fields

- query text
- decoded filters
- missing months
- scrape attempts
- retry count
- final scrape outcome
- stale/fallback response mode

This will make production debugging much faster.

## Suggested Implementation Steps

1. Refactor selector lookup into reusable helper functions in the scraper.
2. Add retry and page-recovery logic.
3. Save failure screenshots, HTML, and metadata.
4. Improve report table detection and parsing.
5. Change backend query response to expose scrape failure states.
6. Update frontend to render fetch failures and stale data clearly.
7. Test with known failing queries such as `EV registrations in assam in Jan 2025`.

## Testing Plan

### Manual tests

- query an existing loaded month
- query a missing month that should trigger scrape
- simulate a selector failure and confirm UI shows warning
- simulate scrape retry success and confirm data appears
- simulate complete scrape failure with no cached data

### Expected outcomes

- successful scrape returns normal results
- failed scrape returns warning metadata
- UI no longer implies that zero rows means “real zero”

## Optional Follow-Up

After this stabilization work, the next architecture step should be moving data storage away from local CSV files and into Neon so that:

- query responses do not depend on live scraping
- stale data can be served safely
- retries and backfills can run in the background

That is a separate improvement. The immediate priority is fixing scraper robustness and graceful failure handling in the current repo.

## Short Version

The repo should be fixed in two places:

1. Scraper logic
   Make Playwright resilient to VAHAN page changes and transient failures.

2. Query flow
   If scraping fails, return a clear failure or stale-data state instead of empty results that look valid.
