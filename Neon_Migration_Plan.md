# Neon Migration Plan

## Goal

Move the project from a CSV-backed query flow to a Neon/PostgreSQL-backed data platform that:

- stores historical VAHAN and TDC data centrally
- serves dashboard queries from the database
- scrapes only missing or recent data
- supports retries, logs, and daily refresh jobs

## High-Level Strategy

The system should work in two phases:

1. Historical backfill
   Import all existing historical data from the current CSV files into Neon.

2. Incremental sync
   On a schedule, scrape only new or recently changing months and upsert them into Neon.

This avoids scraping the full country every day and makes the dashboard fast and reliable.

## Why This Change

The current flow in [server.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/server.mjs:518) reads from `data/vahan/vahan_fuel_monthly.csv` and may trigger live scraping during user queries. That creates a few problems:

- user queries can block on scraping
- a scraper timeout can produce zero rows in the UI
- there is no durable job history beyond local files
- CSV is not ideal for concurrent reads, retries, and analytics

Neon gives us:

- one central source of truth
- fast filtered queries
- resumable scrape jobs
- auditability for failures and retries
- cleaner future deployment

## Environment Setup

Add the Neon connection string to `.env`.

Example:

```env
DATABASE_URL=your_neon_connection_string_here
```

Optional future variables:

```env
GEMINI_API_KEY=your_gemini_key_here
SCRAPER_HEADLESS=true
SCRAPER_DELAY_MS=1200
SCRAPER_MAX_RETRIES=3
SYNC_RECENT_MONTHS=3
```

## Proposed Database Tables

### 1. registrations

Main fact table for dashboard queries.

Suggested columns:

- `id`
- `year`
- `month`
- `state`
- `rto`
- `fuel_segment`
- `fuel_type`
- `vehicle_count`
- `source_name`
- `source_url`
- `scraped_at`
- `created_at`
- `updated_at`

Recommended unique key:

- `(year, month, state, rto, fuel_type)`

Purpose:

- stores the final monthly counts used by the dashboard
- supports upserts when the same month is re-scraped

### 2. scrape_jobs

Tracks every scrape attempt.

Suggested columns:

- `id`
- `state`
- `rto`
- `year`
- `month`
- `job_type` (`backfill`, `incremental`, `on_demand`)
- `status` (`pending`, `running`, `success`, `failed`, `retry`)
- `attempt_count`
- `started_at`
- `finished_at`
- `error_message`
- `created_at`
- `updated_at`

Purpose:

- acts as the job queue
- records retries and failures
- prevents duplicate work

### 3. scrape_job_logs

Optional but useful for debugging.

Suggested columns:

- `id`
- `job_id`
- `log_level`
- `message`
- `payload_json`
- `created_at`

Purpose:

- stores scraper output, warnings, and failure context

### 4. sync_state

Optional helper table for scheduler metadata.

Suggested columns:

- `key`
- `value`
- `updated_at`

Purpose:

- track last successful incremental sync
- store scheduler checkpoints

## Data Sources To Import

Initial import should cover:

- [data/vahan/vahan_fuel_monthly.csv](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/data/vahan/vahan_fuel_monthly.csv)
- [data/tdc-history/vahan-vehicle-registrations-by-fuel-type.csv](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/data/tdc-history/vahan-vehicle-registrations-by-fuel-type.csv)
- any other TDC files we decide to expose later

Important note:

- Keep source metadata so we always know whether a row came from VAHAN scraping or TDC historical data.

## Import Plan

Create a one-time import script that:

1. reads existing CSV files
2. normalizes columns to the `registrations` table format
3. batches inserts/upserts into Neon
4. logs imported row counts
5. skips duplicates safely

Suggested file:

- `scripts/import-to-neon.mjs`

## Incremental Sync Plan

After historical import, run a scheduled sync once per day.

The scheduler should:

1. determine which months are still "live" or recently changed
2. enqueue scrape jobs only for those months
3. skip months already marked fresh and complete
4. retry failed jobs with limits

Recommended default policy:

- scrape current month daily
- rescrape previous month daily for a short window
- optionally rescrape the last 2-3 months
- do not rescrape old historical months unless missing or explicitly requested

## Job Queue Behavior

The queue can be database-backed using `scrape_jobs`.

Worker flow:

1. pick one `pending` or `retry` job
2. mark it `running`
3. run the Playwright scraper
4. parse and upsert rows into `registrations`
5. mark job `success` or `failed`
6. write logs/errors to `scrape_job_logs`

Safety rules:

- one job should be idempotent
- rerunning a job should update existing rows, not duplicate them
- failed jobs should preserve error details

## API Migration Plan

The dashboard should stop using CSV as the primary source.

Current backend behavior:

- [server.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/server.mjs:518) loads rows from CSV
- [server.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/server.mjs:530) detects missing months
- [server.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/server.mjs:579) may auto-scrape during a query

Target behavior:

1. query Neon first
2. return stored data immediately if available
3. if data is missing, optionally enqueue a background job instead of blocking the request
4. show the user that data is pending instead of returning misleading zeroes

Suggested migration path:

### Phase 1

- keep scraper as-is
- add Neon import and Neon read path
- make dashboard queries read from Neon

### Phase 2

- add `scrape_jobs` table
- move auto-scrape from request path into background jobs

### Phase 3

- add scheduled daily sync
- add admin visibility for failed jobs and missing months

## Scraper Improvements Needed First

Before scaling scraping, make the current scraper more resilient.

Current weak spots in [scripts/vahan-scraper.mjs](C:/Users/amogh/Desktop/BHAIYA/Vahan EY/scripts/vahan-scraper.mjs:384):

- relies on brittle element IDs like `j_idt32_input`
- can fail when VAHAN changes page structure
- timeouts currently cause job failure without enough recovery

Recommended improvements:

- find controls by labels and option text where possible
- retry failed page loads and refreshes
- capture screenshot/HTML on failure
- increase diagnostics in error logs
- support job-level retries with backoff

## Suggested Folder Additions

Possible new files:

- `scripts/import-to-neon.mjs`
- `scripts/run-sync.mjs`
- `scripts/run-worker.mjs`
- `db/schema.sql` or Prisma schema
- `.env`

Possible new runtime modules:

- `lib/db.mjs`
- `lib/jobs.mjs`
- `lib/registrations.mjs`
- `lib/sync-policy.mjs`

## Recommended Implementation Order

1. Add Neon connection via `.env`
2. Create database schema
3. Write import script for existing CSV data
4. Switch backend reads from CSV to Neon
5. Add scrape job table and worker
6. Move auto-scrape out of live request path
7. Add daily incremental sync
8. Add monitoring for failures and freshness

## Expected Outcome

After this migration:

- historical data lives in Neon
- new monthly data is scraped and saved into Neon
- the dashboard becomes faster and more reliable
- scraper failures no longer break user queries
- we can track freshness, retries, and gaps centrally

## Short Version

Yes, the core idea is:

- import old historical data into Neon once
- when a new month arrives, scrape only the new or recent months
- save those updates into Neon
- serve all dashboard queries from Neon

That gives us a cleaner and more scalable architecture than relying on local CSV files and on-demand scraping.
