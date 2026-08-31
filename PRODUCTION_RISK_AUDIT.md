# Production Risk Audit

This project is safest to deploy as a long-running Node 22 service backed by
Neon Postgres. Run the checks below before deploying from a Git branch.

## Required Gates

```powershell
npm ci
npm run check:syntax
npm run check:audit
npm run check:local
npm run check:production
```

On Linux hosts that run live VAHAN scraping, install Chromium for Playwright:

```bash
npx playwright install --with-deps chromium
```

## Deployment Requirements

- Commit every imported runtime file, especially `lib/auth.mjs`.
- Use `.env.example` as the production environment template.
- Set `NODE_ENV=production`, `DATABASE_URL`, `APP_BASE_URL`, and
  `GOOGLE_REDIRECT_URI` for the deployed hostname.
- Keep `REQUIRE_DATABASE_FOR_READINESS=1` so `/ready` fails when Neon is absent
  or unavailable.
- Set `PUBLIC_DASHBOARD_DISABLE_LIVE_REFRESH=1` only when the host must pause
  Playwright scraper jobs.
- Set `TELEGRAM_ENABLE_POLLING=0` on web hosts unless that process should own
  Telegram polling.

## Runtime Checks

- `/health` is a liveness check and can fall back to CSV data.
- `/ready` is the deployment readiness check and should be used by the host or
  load balancer.
- Public expensive POST routes are rate-limited by
  `EXPENSIVE_RATE_LIMIT_WINDOW_MS` and `EXPENSIVE_RATE_LIMIT_MAX`.
- JSON request bodies are capped by `MAX_JSON_BODY_BYTES`.
- Completed refresh jobs are pruned by `REFRESH_JOB_TTL_MS` and
  `MAP_REFRESH_JOB_TTL_MS`.

## Known Manual Review Items

- Review missing or partial local-regression scenarios before promising full
  data coverage.
- Confirm Neon schema has been applied with `npm run db:schema`.
- Confirm daily tracked queries have required GitHub Actions secrets.
- Keep generated scraper failure artifacts out of deploy commits unless they are
  intentionally needed for debugging.
