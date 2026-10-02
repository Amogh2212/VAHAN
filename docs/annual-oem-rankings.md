# Calendar-year OEM rankings

The existing top-five makers section now displays saved annual registration evidence with EV/ICE and 2W/3W/4W selectors. The rest of the report retains its Daily, weekly or monthly meaning. Selectors reuse one saved-data response and do not request VAHAN data.

Evidence is collected separately using VAHAN's top5Makerchart, category totals and registration headline under matching filters: timePeriod=0 and fromYear=toYear. Only named makers are displayed; Others and residuals remain in the evidence. Missing or failed scopes are Unavailable. Zero requires explicit matching source totals. Historical selection stays within the selected date's calendar year.

## Production collection

RTO Annual OEM Production Collection runs after RTO Daily Neon Production Collection completes on main, regardless of success or failure. It uses the existing DATABASE_URL GitHub secret, applies only the additive annual tables, and validates the latest saved frozen 100-RTO cohort. It does not seed or change the Daily cohort. The shared database scrape lock prevents overlapping VAHAN collection; OEM waits up to 15 minutes for that lock. Each run collects 600 scopes with request pacing and three attempts per failed scope.

Manual workflow runs support resume_run_id for a same-day annual run. The ID appears in collection logs. Resume skips verified scopes and retries unavailable scopes. Historical days cannot be backfilled by fetching today's dashboard. Failure of any full-cohort scope makes the workflow fail while retaining available saved evidence. A completed Daily run before this workflow is merged requires a manual OEM run; workflow_run does not replay past completions.

## Local checks

- npm run check:oem-annual
- node scripts/rto-reports-browser-check.mjs (requires an .env file, which may be empty)
- node --env-file=.env.local-postgres scripts/rto-oem-annual-integration-check.mjs (isolated temporary schema in local PostgreSQL)
- node --env-file=.env.local-postgres scripts/rto-oem-annual-api-check.mjs (requires previously saved local pilot evidence)

Local collector and schema commands reject remote databases unless --production is explicitly supplied. CSV and PDF exports append a separate calendar-year section covering all six combinations. Export caching does not reuse stale annual evidence.

Fresh local evidence was checked for Jaipur's six segments and Dehradun EV/3W and ICE/3W. A full 100-RTO production OEM run remains an operational verification after merge.
