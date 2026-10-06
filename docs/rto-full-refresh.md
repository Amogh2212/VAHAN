# Refresh today's RTO evidence

The normal recovery path retries failed jobs and retains accepted same-day observations. To fetch every configured job again, manually dispatch `rto-daily-neon-production.yml` with `initialize_cohort=false`, `retry_failed=false`, and `refresh_all=true`.

The equivalent collector option is `--refresh-all`. It requires today's IST date and the entire cycle, preserves history, and refuses to reset active workers. The shared VAHAN lock and workflow concurrency prevent overlapping collection.

A newer complete EV/ICE × 2W/3W/4W response set atomically replaces that RTO's accepted observation and published scope rows. Earlier source observations remain in the ledger, marked superseded and linked to their replacements. A partial refresh retains an existing complete snapshot; its new responses remain in history. Ordinary recovery retains its existing behavior.

The report shows the saved fetch time in IST, source freshness as unconfirmed, and any in-progress or failed refresh. Collection time does not prove an upstream refresh timestamp. Daily comparisons remain net changes between compatible consecutive dates; missing scope evidence and unchanged values without freshness proof remain unavailable. A full refresh request does not guarantee 100 complete RTOs or 100 usable Daily comparisons; inspect the final artifact's fixed-cohort coverage and Daily gate separately.

Verification: RTO Daily/report unit checks, `scripts/rto-source-db-check.mjs` on local PostgreSQL (complete promotion, partial retention, worker guard, history), report PostgreSQL integration checks, and browser checks for the fetch-time and failed-refresh labels.
