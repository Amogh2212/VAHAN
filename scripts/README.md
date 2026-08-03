# VAHAN Scraper

This scraper targets the official VAHAN public dashboard:

https://vahan.parivahan.gov.in/vahan4dashboard/vahan/view/reportview.xhtml

It only collects public aggregate registration counts. It does not fetch owner
details, RC records, phone numbers, addresses, or individual vehicle records.

## Setup

```powershell
npm install
npx playwright install chromium
```

## Discover Page Controls

Run discovery first. It records the dashboard controls and useful network
responses under `data/vahan/`.

```powershell
npm run scrape:vahan:discover
```

If the site blocks headless browsing, run:

```powershell
node scripts/vahan-scraper.mjs --mode discover --headed
```

If discovery writes `discover-error.json` with a 403 message, the dashboard is
blocking this machine/network. Open the VAHAN URL in a normal browser to confirm
whether your connection is allowed before attempting a large scrape.

You can also try an installed browser channel:

```powershell
node scripts/vahan-scraper.mjs --mode discover --headed --channel msedge
```

or:

```powershell
node scripts/vahan-scraper.mjs --mode discover --headed --channel chrome
```

## Sample Scrape

```powershell
npm run scrape:vahan:sample
```

## RTO Catalog

Build the local RTO catalog from the official VAHAN state/RTO dropdowns:

```powershell
npm run scrape:vahan:rto-catalog
```

For a focused refresh:

```powershell
node scripts/vahan-scraper.mjs --mode rto-catalog --states Uttarakhand,Uttar Pradesh
```

The dashboard uses this catalog after deterministic or explicitly enabled local
Ollama parsing to convert city or RTO text into the exact VAHAN dropdown label
before filtering or scraping.

## Local Ollama (optional and manual)

The project stays deterministic by default: `AI_QUERY_PROVIDER=none` and
`FACTOR_AGENT_PROVIDER=none`. Ollama is not bundled, installed, started, or
downloaded by any project script.

For cloud-backed dashboard intent decoding, use `AI_QUERY_PROVIDER=groq` with
`GROQ_API_KEY`. Groq receives the submitted query and the current allowed VAHAN
filter labels, but the server accepts only labels from that list. It makes at
most one uncached request every 30 seconds, caches successful plans for a day,
and falls back to local rules during cooldowns or provider errors. It never
cascades automatically to Gemini or another provider.

### You do manually

1. Install Ollama for Windows from the [official Windows guide](https://docs.ollama.com/windows).
2. Open a new PowerShell window and download the selected local model:

```powershell
ollama --version
ollama pull qwen3:4b
node scripts/check-ollama.mjs
```

The checker makes only a local `GET /api/tags` request to the configured
loopback endpoint. It does not send a prompt, run a model, download a model, or
change configuration. If it fails, it prints the exact next manual action.

If your home drive lacks space, set the Windows user environment variable
`OLLAMA_MODELS` before downloading models, then restart Ollama. The official
guide documents this setting and storage behavior.

### Project configuration after the check passes

In your ignored `.env`, keep this local-only configuration and enable only the
flows you want to use:

```text
AI_QUERY_PROVIDER=ollama
FACTOR_AGENT_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_QUERY_MODEL=qwen3:4b
OLLAMA_FACTOR_MODEL=qwen3:4b
OLLAMA_TIMEOUT_MS=10000
```

Set either provider back to `none` to disable that flow. Local Ollama is never
followed by Gemini or Groq; an unavailable, timed-out, malformed, or rejected
local response falls back to deterministic project behavior. Do not add cloud
keys for this setup. Test runners force the dashboard AI provider to `none` so
they cannot use an active local model or cloud provider from your shell.

## RTO Insights: Geofabrik OSM Signals

For all-India OSM signal refreshes, prefer the Geofabrik local extract path over
the public Overpass API. It downloads one India `.osm.pbf`, filters the POI tags
used by `rto-insights`, then counts those POIs around cached RTO centroids
locally. This avoids Overpass `429` and `504` failures during bulk runs.

Install `osmium-tool` first and verify:

```powershell
osmium --version
```

Prepare the local Geofabrik cache. This downloads a large India extract and
builds `data/rto-insights/geofabrik/osm-signals.geojsonseq`:

```powershell
npm.cmd run rto-insights:geofabrik:prepare
```

Run a small dry run:

```powershell
npm.cmd run rto-insights:geofabrik:dry-run -- --state "Andaman & Nicobar Island" --limit 10 --refresh
```

Run the full local import:

```powershell
npm.cmd run rto-insights:geofabrik:import -- --limit 2000 --refresh
```

To refresh all RTO Insight OSM signals automatically, register the hidden
weekly Windows task. It runs each Sunday at 02:00 local time, starts local
PostgreSQL if required, downloads a fresh India extract, rebuilds the filtered
POI cache, and writes refreshed signals for up to 2,000 enabled RTOs:

```powershell
npm.cmd run tasks:rto-insights:register
```

Use `npm.cmd run tasks:local:register` to register both this weekly OSM task
and the 15-minute RTO daily worker. Task output is appended to
`logs/local-jobs/rto-insights-osm.log`. If `osmium-tool` is unavailable, the
task fails before writes and retries at its next weekly run.

The importer writes the same `rto_external_signals` rows as the Overpass import,
with `provider='openstreetmap'` and Geofabrik attribution in `evidence`, so the
existing `/rto-insights.html` dashboard and APIs continue to work. If `osmium`
is unavailable, the script exits before writing and tells you to install it or
pass a pre-exported `--pois-file`.

When `DATABASE_URL` is present in `.env`, successful scrape rows are upserted
into Neon and also written to the local CSV files. If `DATABASE_URL` is absent,
the scraper continues to write CSV only.

## Database Import

Create the database schema from `db/schema.sql`, then import the existing local
CSV files. These scripts use `DATABASE_URL`, so they can target Neon,
CockroachDB, or another Postgres-compatible database:

```powershell
npm run db:schema
npm run import:db
```

`db:schema:neon` and `import:neon` remain as backwards-compatible aliases for
older workflows.

## Local PostgreSQL Development

Use the bundled PostgreSQL 17 runtime for local development while keeping
CockroachDB and Neon available but inactive. The active `.env` uses a localhost
connection and disables SSL:

```text
DATABASE_URL=postgresql://vahan_app:YOUR_PASSWORD@localhost:5433/vahan_ey_local?sslmode=disable
PGSSL=false
REQUIRE_DATABASE_FOR_READINESS=1
BACKUP_DIR=backups/postgres
BACKUP_RETENTION_DAYS=14
LOCAL_POSTGRES_DATA_DIR=.local/postgres/data
```

Keep cloud credentials only in ignored env files. To copy the current
CockroachDB data into a new, empty local database:

```powershell
Copy-Item .env .env.cockroach.local
# Generate the ignored local connection and initialize PostgreSQL.
npm.cmd run db:configure:local
npm.cmd run db:init:local
npm.cmd run db:migrate:local -- --source-env .env.cockroach.local --target-env .env.local-postgres --confirm-local-write
npm.cmd run db:activate:local
npm.cmd run db:start:local
npm.cmd run db:check:local
```

The migration refuses non-local targets and populated target tables. It copies
all application tables, preserves bigint IDs and foreign keys, resets local
sequences, and compares source/target row counts. It never writes to the source.

Create a local backup manually, clear old local jobs, then register the hidden
RTO daily Windows job:

```powershell
npm.cmd run db:backup:local
npm.cmd run tasks:local:clear
npm.cmd run tasks:rto-daily:register
```

`tasks:local:clear` removes the old `VahanEY-Postgres`,
`VahanEY-TrackedQueries`, `VahanEY-PostgresBackup`, `VahanEY-RtoCatalog`,
`VahanEY-RtoDaily`, `VahanEY-RtoInsightsOsm`, and `VahanEY-RtoFactorDaily` tasks. `tasks:rto-daily:register` creates only
`VahanEY-RtoDaily`, a hidden 15-minute task launched through `wscript.exe` so it
does not open a terminal. Each invocation checks the active local `.env`, starts
local PostgreSQL in a hidden detached process when needed, claims RTO/ARTO jobs
for 10 minutes by default, finishes work already in progress, and then exits.
Missed daily worker runs start when next available. Backups remain stored in
`backups/postgres`, retained for 14 days, and local task logs go to
`logs/local-jobs`.

Tracked queries, backups, and RTO catalog refreshes are intentionally manual in
this setup:

```powershell
npm.cmd run tracked:run
npm.cmd run db:backup:local
npm.cmd run rto-daily:catalog
```

Run `npm.cmd run tasks:local:register` to register both existing local tasks, or use
`tasks:rto-daily:register`, `tasks:rto-insights:register`, and `tasks:rto-factor:register` to register one
individually. The GitHub workflow is manual-only while local PostgreSQL is
active.

Backups are gzip-compressed logical snapshots of every application table. A
restore is intentionally allowed only into an empty local database:

```powershell
npm.cmd run db:restore:local -- --file backups/postgres/FILE.json.gz --confirm-local-write
```

The import is idempotent. Fuel rows are upserted by:

```text
year, month, state, rto, fuel_type, filter context
```

Maker rows are imported from `data/vahan/vahan_maker_monthly.csv` when present,
from the legacy `data/vahan/vahan_state_maker_fuel.csv` fallback, and from the
TDC history file only when `--include-tdc-maker` is passed.
They are upserted by:

```text
year, month, state, rto, maker, filter context
```

## CockroachDB Free-Safe Test

Use this only with a CockroachDB Cloud Basic test cluster. It does not touch the
normal `.env`; keep Neon or production settings there unchanged.

Create a local test env file from the example:

```powershell
Copy-Item .env.cockroach.test.example .env.cockroach.test
```

Edit `.env.cockroach.test` with the CockroachDB general PostgreSQL connection
string. Keep `COCKROACH_TEST=1`; the test runner refuses to run without it and
also refuses Neon-looking URLs.

Run the guarded sample test first:

```powershell
npm.cmd run cockroach:test
```

The sample test applies `db/schema.sql`, imports a small sample from the local
fuel and maker CSVs, imports the same rows again to prove idempotency, then
prints a JSON report. It writes only to the configured Cockroach test database.

If the sample report passes and CockroachDB usage still looks safely inside the
Basic free allowance, run the full CSV import test:

```powershell
npm.cmd run cockroach:test:full
```

The full Cockroach test intentionally excludes the large TDC maker history file
unless `--include-tdc-maker` is passed. Keep it excluded for the student/free
setup unless you have checked CockroachDB usage and really need historical maker
coverage.

Do not update production `DATABASE_URL`, hosting secrets, or GitHub Actions
secrets until the Cockroach test report is clean and migration is approved.

For a production cutover after the full Cockroach test passes:

```powershell
npm.cmd run db:schema
npm.cmd run import:db -- --batch-size 100
```

Keep the old Neon connection string outside the repo until CockroachDB has
completed at least one successful scrape/report cycle. CockroachDB transaction
retry error `40001` is retried automatically by the shared DB helper; tune
`DB_MAX_RETRIES` and `DB_RETRY_BASE_MS` only if the logs show repeated retries.

## Daily Tracked Queries

Apply the schema first so the tracked query tables exist:

```powershell
npm run db:schema
```

Create tracked queries through the API, then run the daily batch from an
external scheduler such as GitHub Actions:

```powershell
npm run tracked:run
```

This repo includes `.github/workflows/daily-tracked-queries.yml`, which runs the
daily batch every day at `02:30 UTC` (`08:00 IST`). It can also be triggered
manually from the GitHub Actions tab with `workflow_dispatch`.

Add these GitHub Actions repository secrets before running it:

- `DATABASE_URL`
- `GEMINI_API_KEY`, if AI query interpretation should use Gemini
- `GROQ_API_KEY`, if AI query interpretation should use Groq
- `TELEGRAM_BOT_TOKEN`, if Telegram alerts are needed
- `TELEGRAM_ALLOWED_CHAT_IDS`, if Telegram alerts are needed

Optional non-secret GitHub Actions variables can be added for `GROQ_MODEL`,
`TELEGRAM_ALERT_THRESHOLD_POINTS`, `TELEGRAM_PUBLIC_DAILY_LIMIT`, and
`TRACKED_QUERY_FAIL_ON_PARTIAL`. The scheduled workflow defaults
`TRACKED_QUERY_FAIL_ON_PARTIAL` to `0`, so one flaky VAHAN fetch stores a failed
run row without failing the whole GitHub Action when other tracked queries
succeed. Set it to `1`, or pass `--fail-on-partial`, when every query must
succeed for the command to exit cleanly. It also defaults
`TRACKED_QUERY_BACKFILL_DAYS` to `7`, so each daily run retries missing
observations from the last week before writing today's observation. Keep secrets
in GitHub Actions secrets; do not commit them to the repo.

Tracked queries do not need to include a month. If a saved query has no date
range, the daily runner defaults it to the observation month, so a query such as
`EV registrations in Maharashtra` is checked against the current month on each
daily run.

Preview due queries without writing run or observation rows:

```powershell
npm run tracked:dry-run
```

Preview missed observations from the last week:

```powershell
node --env-file=.env scripts/run-tracked-queries.mjs --dry-run --backfill-days 7
```

For a controlled rerun of a specific observation date:

```powershell
node --env-file=.env scripts/run-tracked-queries.mjs --date 2026-06-01 --all
```

## Daily RTO Snapshot Trends

This collector is separate from saved tracked queries. It stores current-month
daily snapshots for enabled RTOs across:

```text
2 fuel groups x 3 vehicle categories x 15 OEMs = 90 rows per RTO per day
```

Apply the schema and build the VAHAN RTO catalog first:

```powershell
npm run db:schema
npm run scrape:vahan:rto-catalog
```

Refresh the official catalog into local PostgreSQL (the generated JSON remains
an optional export/cache):

```powershell
npm.cmd run rto-daily:catalog
```

Preview the next queued RTOs and scraper calls without launching the browser:

```powershell
npm run rto-daily:dry-run
```

Run or resume the national daily cycle with two persistent browser workers:

```powershell
npm.cmd run rto-daily:run
```

For the dual lookup/pinning queue, schedule the bounded worker on the deployment
host every 15 minutes. Dependencies and the Playwright browser should be
installed once on that host; the PostgreSQL advisory lock prevents overlapping
invocations:

```cron
*/15 * * * * cd /path/to/vahan-ey && npm run rto-daily:work
```

`rto-daily:work` stops claiming new RTOs after
`RTO_DAILY_WORK_BUDGET_MINUTES` (default `10`). It processes personal pins
first, missing first-snapshot requests second, and the oldest national RTO
snapshots last. A pin is per account, capped by
`RTO_DAILY_MAX_PINS_PER_USER` (default `10`), while the underlying scrape is
shared and deduplicated. The 15-minute target is queue pickup time, not scrape
completion time. While it runs, the terminal progress bar shows successful RTOs
fetched against the full cycle, plus the current running, queued, and failed
counts. Each scheduled invocation resumes the same durable cycle.

### GitHub Actions with Neon

For a laptop-free deployment, this repository includes
`.github/workflows/rto-daily-cloud.yml`. It runs five resumable four-hour
slices per day against the Neon-backed queue. The workflow installs Chromium,
creates the ignored `.env` file required by the npm scripts, and runs:

```text
npm run rto-daily:work -- --retry-failed --time-budget-minutes 240 --workers 2
```

Before enabling the schedule:

1. Apply `db/schema.sql` to Neon with `npm.cmd run db:schema:neon` from a
   trusted environment.
2. Add the Neon pooled connection string as the GitHub Actions repository
   secret `DATABASE_URL`.
3. Confirm that Neon has 100 enabled top-EV configurations in
   `rto_daily_snapshot_configs`; the worker uses this table rather than the
   ignored local catalog cache.
4. Trigger the workflow manually once and confirm a successful browser access
   to VAHAN before relying on the schedule.

The hosted runner is ephemeral, so all resumable state must remain in Neon.
The workflow deliberately serializes runs; the database advisory lock and
GitHub concurrency group prevent overlapping VAHAN scrapers. A full cycle is
usable only when its run is `success`, its frozen cohort is 100, all 100 RTOs
are successful, and no jobs remain failed. If VAHAN blocks GitHub data-center
IPs or the 100-RTO cycle needs more than one IST day, use an always-on cloud
VM/self-hosted runner with a stable outbound IP instead.

Use `--workers 1`, `--workers 2`, or `--workers 4` for the live benchmark. The
runner caps concurrency at four, atomically claims one RTO per worker, reuses
each worker browser across many RTOs, retries failures, and resumes expired
leases after interruption. A pilot can be restricted with `--state NAME`.

To switch future daily rotation fetches to the national top 100 RTOs by EV
sales, first finish a complete all-India run, then apply the cohort:

```powershell
npm.cmd run rto-daily:top-ev:dry-run
npm.cmd run rto-daily:top-ev:apply
```

The ranking uses India-wide EV `report_total` from
`rto_daily_scrape_reports`, summed across 2W, 3W, and 4W for the latest
complete snapshot date. It enables those 100 RTO configs, sets their priorities
to rank order, and disables the other rotation configs. If the official RTO
catalog is refreshed later, rerun `rto-daily:top-ev:apply` before the next
daily cycle so the curated top-100 scope remains active.

The dashboard APIs expose `/api/rto-daily/coverage`, `/api/rto-daily/runs`,
`/api/rto-daily/freshness`, and `/api/rto-daily/trend`. The trend endpoint
returns month-safe daily deltas and flags negative VAHAN corrections.
Public dual-lookup endpoints are `/api/rto-daily/search` and
`/api/rto-daily/status`. Signed-in users manage personal pins through
`GET|POST /api/rto-daily/pins`, `DELETE /api/rto-daily/pins/:id`, and queue an
unpinned first snapshot with `POST /api/rto-daily/requests`.

The runner keeps raw `rto_daily_snapshots` for `RTO_DAILY_RETENTION_DAYS`
(default `30`) and rolls older rows into `rto_monthly_snapshot_aggregates`
before deleting raw snapshots. The UI is available at `/rto-trends.html`.

## Top-100 RTO Reports

The daily worker automatically reconciles reports after every collection slice.
Generation remains blocked until the run has a frozen cohort of exactly 100
non-global RTOs and every member has six successful, filter-confirmed source
reports:

```text
2 fuel groups x 3 vehicle categories x 100 RTOs = 600 required reports
600 required reports x 15 tracked OEMs = 9,000 required OEM rows
```

An eligible cycle creates one daily batch. A Sunday cycle also creates a weekly
batch, and a month-end cycle also creates a monthly batch. Every batch contains
100 individual RTO reports. Reconciliation is idempotent: unchanged source facts
reuse the existing revision, while a late correction creates a new revision.

Headline EV and ICE totals come only from
`rto_daily_scrape_reports.report_total`. OEM detail comes from
`rto_daily_snapshots.vehicle_count`; any non-negative difference is shown
separately as `Other / untracked` instead of being assigned to an OEM. Missing
boundaries, negative source corrections, late fills, unconfirmed filters, and
headline/OEM reconciliation problems are retained as quality warnings or
`needs_review` states.

Reconcile a known run manually, including any still-available history needed for
daily or comparison boundaries:

```powershell
npm.cmd run report:rto:work -- --run-id RUN_ID
npm.cmd run report:rto:rebuild -- --run-id RUN_ID --backfill-history --history-from YYYY-MM-DD
npm.cmd run report:rto:work -- --limit 30 --prune
```

The report UI is `/rto-reports.html`. Its API surface is:

```text
GET /api/rto-reports/readiness
GET /api/rto-reports/batches
GET /api/rto-reports/batches/:id/reports
GET /api/rto-reports/batches/:id.csv
GET /api/rto-reports/:id
GET /api/rto-reports/:id/csv
GET /api/rto-reports/:id/pdf
```

Generated export files expire after 30 days. Daily report batches are retained
for 45 days, compact headline and OEM facts for two years, and weekly/monthly
batches are retained for long-term comparisons. Run the focused checks with:

```powershell
npm.cmd run check:rto-reports
npm.cmd run check:rto-reports:integration
npm.cmd run check:rto-reports:browser
```

## Evidence-backed RTO factor agent

The factor agent adds reviewed context to an RTO report without changing any
VAHAN totals. Its operating sequence is:

```text
allowlisted source -> immutable document -> reviewed event
  -> deterministic VAHAN validation -> draft narrative
  -> admin review -> approved report context
```

The feature is disabled by default. Manual event intake is also dry-run by
default and never starts a VAHAN scrape, changes the daily queue, or changes a
Windows scheduled task. A dry run only validates the JSON contract and prints
the normalized source, document, event, preview checksum, link, and target plan.

### Approved-source discovery collector

`data/rto-factor-source-registry.json` is the reviewed allowlist for the
discovery collector. It starts with official PM E-DRIVE, MoRTH, PIB, IMD, and
SIAM pages; the NSE entry is intentionally disabled until an operator confirms
an OEM-specific, stable route and its access terms. Each source is pinned to an
HTTPS host, a set of permitted link paths, and topic keywords. The collector
will not follow a discovered URL to another host, does not invoke a browser or
LLM, and never writes to Postgres.

Run a collection preview (it fetches the configured landing pages but writes no
files or database records):

```powershell
npm.cmd run rto-factor:sources:collect
```

To save a timestamped review queue locally, still without any database write:

```powershell
npm.cmd run rto-factor:sources:collect -- --write
```

The queue is discovery-only: its URLs, titles, timestamps, and snippets are
not approved evidence or factor events. A reviewer must open the cited primary
document, confirm its effective date and affected geography, write the exact
supporting excerpt, and then create a separate manual event intake below. Do
not schedule this collector until each source's terms and operating cadence are
reviewed. A failed source is recorded in the queue; it never causes a fallback
to an unapproved source.

Create an input file using this versioned shape. The `.example` host and all
placeholder text below must be replaced with the real official source:

```json
{
  "schemaVersion": 1,
  "source": {
    "sourceKey": "replace.transport.authority",
    "publisher": "Replace with official authority name",
    "sourceTier": "A",
    "sourceType": "transport_authority",
    "canonicalHost": "transport.example",
    "evidencePolicy": "report_evidence"
  },
  "documents": [
    {
      "ref": "official-notice",
      "canonicalUrl": "https://transport.example/notices/replace-with-real-document",
      "title": "Replace with the official document title",
      "publishedAt": "2026-07-01T04:30:00.000Z",
      "evidenceExcerpt": "Replace with the exact evidence needed to test the event.",
      "reviewStatus": "approved",
      "reviewedAt": "2026-07-01T10:00:00.000Z"
    }
  ],
  "event": {
    "eventType": "tax_or_fee",
    "title": "Replace with a concise event title",
    "claimSummary": "State only what the cited official document establishes.",
    "hypothesis": "Daily EV registrations may change after the effective date.",
    "expectedDirection": "increase",
    "effectiveStart": "2026-07-01",
    "effectiveEnd": "2026-12-31",
    "reviewStatus": "eligible",
    "sourceReliabilityScore": 0.95,
    "reviewedAt": "2026-07-01T10:05:00.000Z",
    "documents": [
      {
        "documentRef": "official-notice",
        "evidenceRole": "primary"
      }
    ],
    "targets": [
      {
        "targetRole": "affected",
        "geographyScope": "state",
        "state": "Maharashtra",
        "fuelGroup": "EV",
        "vehicleCategory": "ALL"
      }
    ]
  }
}
```

Every document needs a unique lowercase `ref`, and every imported document must
be linked exactly once from `event.documents`. Document URLs must use HTTPS and
their host must exactly match `source.canonicalHost`. An `eligible` or
`context_only` event requires approved primary evidence from a Tier A/B
`report_evidence` source. Tier C remains lead-only and Tier D is prohibited as
report evidence. Reviewed documents and events require a stable `reviewedAt`;
the CLI supplies the manual audit label when `reviewedByLabel` or
`createdByLabel` is omitted.

Validate the intake file without connecting to or writing the database:

```powershell
npm.cmd run rto-factor:event:import -- --input .\event.json
```

After an admin has checked the dry-run output and the factor schema is present,
enable only the draft workflow for that terminal and persist the immutable
records:

```powershell
$env:FACTOR_AGENT_ENABLED = "1"
$env:FACTOR_AGENT_MODE = "draft_only"
npm.cmd run rto-factor:event:import -- --input .\event.json --write --actor-label "Admin name"
```

Both environment gates are required for `--write`. Re-running unchanged input
is idempotent because source, document, and event records use stable checksums
and idempotency keys. If a source fact changes, submit a new record using the
appropriate `supersedesSourceId`, `supersedesDocumentId`, or
`supersedesEventId`; do not edit an evidence record in place.

The factor runner remains a separate action. Its default dry run reads the
eligible event, report revision, frozen cohort, and canonical
`rto_daily_scrape_reports.report_total` history, then prints the validation and
possible narrative without persisting either:

```powershell
npm.cmd run rto-factor:run -- --event-id EVENT_ID --report-id REPORT_ID --provider none
```

Use `--as-of YYYY-MM-DD` for a reproducible historical cutoff. The default
evidence gates require 28 pre-event days, 14 post-event days, at least five
unexposed controls, and 90% focal coverage. A result can therefore be
`too_early`, `blocked_data`, `blocked_evidence`, `confounded`, `no_effect`,
`mixed_evidence`, or `supported_association`; a weak or blocked result is not
turned into an insight.

After reviewing the dry run, persist its deterministic validation and, only for
`mixed_evidence` or `supported_association`, a review-only explanation draft:

```powershell
$env:FACTOR_AGENT_ENABLED = "1"
$env:FACTOR_AGENT_MODE = "draft_only"
npm.cmd run rto-factor:run -- --event-id EVENT_ID --report-id REPORT_ID --provider none --write
```

`--provider none` keeps narrative generation deterministic. After the local
Ollama check passes, `--provider ollama` may phrase the bounded evidence pack
using `OLLAMA_FACTOR_MODEL`; it cannot change the validation result, introduce
uncited numbers, or publish. The runner never auto-approves narrative text; only
an admin review can make an explanation visible in the report.

When `--provider` is omitted, the direct runner uses
`FACTOR_AGENT_PROVIDER`; the separate daily factor runner remains deterministic
unless its invocation explicitly passes `--provider ollama`.

Run the focused pure checks without touching the database:

```powershell
npm.cmd run check:rto-factor-agent
```

### Daily factor automation

The daily automation is intentionally separate from VAHAN scraping. Once a
100-RTO daily report is ready, it refreshes the allowlisted source-discovery
queue and runs every eligible, unprocessed event/report pair against the latest
report revision. It writes immutable validation records and, only when the
validator permits it, review-only explanation drafts. It never creates or
approves an event, changes a VAHAN total, starts the scraper, or publishes an
explanation.

Preview its current work without writing files or database records:

```powershell
npm.cmd run rto-factor:daily
```

To activate its write mode, set all three flags in the active local `.env`:

```text
FACTOR_AGENT_ENABLED=1
FACTOR_AGENT_MODE=draft_only
FACTOR_DAILY_AUTOMATION_ENABLED=1
```

Then register the separate hidden Windows task. It runs daily at 21:30 local
time by default, starts local PostgreSQL if needed, ignores overlapping starts,
and appends output to `logs/local-jobs/rto-factor-daily.log`:

```powershell
npm.cmd run tasks:rto-factor:register
```

Choose a different local run time when registering if the collection/report
cycle finishes later on this machine:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-local-db-tasks.ps1 -TaskSet Factor -FactorRunTime 23:00
```

The daily source review queue is saved under
`reports/rto-factor-source-candidates/`; its automation summary is saved under
`reports/rto-factor-daily/`. Both are local, ignored runtime artifacts. Review
new candidates and approve only genuine events through the existing event
intake and admin-review workflow.

Preview the planned combinations without launching the browser or writing files:

```powershell
node scripts/vahan-scraper.mjs --mode scrape --dry-run --years 2024 --months 1 --states Maharashtra
```

For cautious rollout, cap a run to the first few remaining combinations:

```powershell
node scripts/vahan-scraper.mjs --mode scrape --limit 5 --years 2024 --months 1 --states Maharashtra
```

## Full Historical Scrape

This mode collects general monthly fuel rows. Each output row includes state,
RTO scope, raw fuel type, and an `EV` / `NON_EV` segment.

```powershell
node scripts/vahan-scraper.mjs `
  --mode scrape `
  --years 2019-2026 `
  --months 1-12 `
  --states Maharashtra,Delhi,Karnataka
```

To scrape a specific RTO instead of all RTOs for a state, pass the visible VAHAN
RTO label:

```powershell
node scripts/vahan-scraper.mjs --mode scrape --years 2024 --months 1 --states Maharashtra --rtos "MH01 MUMBAI CENTRAL"
```

Output:

- `data/vahan/vahan_fuel_monthly.csv`
- `data/vahan/vahan_fuel_monthly_errors.jsonl`
- `data/vahan/vahan_fuel_monthly_summary.json`

The scraper rewrites the CSV after each successful row and resumes by default.
Use `--no-resume` to start a fresh run.

## Notes

- Keep `--delay-ms` conservative. The default is `1200`.
- If the dashboard requires CAPTCHA or private login, stop and do not automate
  around it.
- Validate a sample row manually against the dashboard before running a large
  scrape.
