# VAHAN fixed-baseline OEM storage split

Registration reports and annual OEM data stay in the primary database. Only
`rto_oem_tracking_*` tables move. The primary still owns cohort lookups and
the shared scraper lock. The app and OEM collector use `OEM_DATABASE_URL`
when set and retain the old routing otherwise.

## Stage and verify

1. Provision a free PostgreSQL project in the same region. Keep the main
   `DATABASE_URL` and `DATABASE_URL_UNPOOLED` unchanged.
2. Pause **only** the saved OEM tracking workflow and make sure its last run and
   any manual OEM write jobs have finished. Otherwise the source can change
   after the copy snapshot. Keep it paused until the cutover or rollback.
3. From an authorized runner, set `OEM_COPY_SOURCE_URL` and
   `OEM_COPY_TARGET_URL` to the direct TLS connection strings and set matching
   `OEM_COPY_SOURCE_HOST` and `OEM_COPY_TARGET_HOST` hostname guards. Use
   secure environment variables. Never put the URLs in source control, chat,
   shell history, artifacts, or logs. Run
   `node scripts/copy-rto-oem-tracking.mjs --copy-to-empty`.
   The script snapshots the source read-only, refuses a nonempty target,
   initializes only the OEM schema, verifies all copied rows by sorted
   SHA-256 checksums, and commits only after all seven tables match.
4. Verify the destination's size and that the copied active baseline, sample
   verified OEM counts, and recent OEM exports match. Check the latest
   previously published Daily, Weekly, and Monthly exports against pre-cutover
   results; missing/partial registrations must remain missing/partial.

## Cut over and reclaim separately

Set `OEM_DATABASE_URL` on the deployed app and in GitHub Actions for the OEM
tracking workflow only once the copy is verified and the routing code is
deployed. GitHub's OEM schema and collector tools use direct connections;
if needed, supply `OEM_DATABASE_URL_UNPOOLED` explicitly. Check the OEM
read endpoint and report detail and CSV, then resume the OEM workflow and
confirm a successful write to the new database, not the old one.

Before any irreversible cleanup, retain a verified restorable backup and
obtain explicit approval for removing the obsolete source OEM tables.
Do not drop primary registration facts, report tables, annual OEM tables, or
the old shared lock/cohort path. Re-check Neon storage and validate a new
Daily write before declaring capacity restored. As long as the source remains
intact and OEM has not accepted new writes, removing `OEM_DATABASE_URL`
restores the original route. If new writes exist, preserve and reconcile
them before switching back; do not silently resume on stale data.

## Local rehearsal

Run `node scripts/rto-oem-tracking-split-check.mjs` on a machine with the
project dependencies to exercise source/target isolation, checksum matching,
bigint preservation, sequencing and repeat-copy guards. Run
`npm run check:rto-reports` for the report contracts.
