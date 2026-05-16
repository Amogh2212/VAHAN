# Phase 5: Testing, Deployment & Monitoring

**Goal:** Launch the scraper-backed dashboard reliably and make data quality visible.

## Tasks

### 1. Scraper And Import Testing
- Run the scraper sample and verify `data/vahan/vahan_fuel_monthly.csv`.
- Confirm known VAHAN table values match imported database rows.
- Test multiple states, years, months, and at least one specific RTO.
- Verify retry/error logs when VAHAN resets or blocks a request.

### 2. Query Testing
- Test natural-language queries:
  - `EV in Noida RTO between May 2024 and May 2025`
  - `non EV registrations in Maharashtra in 2024`
  - `electric vehicles in Delhi from Jan 2024 to Dec 2024`
- Test structured API filters for the same scenarios.
- Test ambiguous and missing locations.

### 3. Frontend Testing
- Verify cards, charts, table, parsed filters, and freshness banner.
- Test mobile, tablet, and desktop layouts.
- Confirm no screen says `live`, `daily`, or `purchase` when the data is registration-based monthly aggregate data.

### 4. Deployment
- Deploy frontend on Vercel.
- Deploy backend on Render or Railway.
- Use PostgreSQL on Supabase or Neon.
- Set environment variables for database URL, scrape/import schedule, and frontend API URL.

### 5. Monitoring
- Add `/health` with:

```json
{
  "status": "ok",
  "latestImportedMonth": "YYYY-MM",
  "lastImportRun": "timestamp"
}
```

- Monitor scraper/import failures and stale data.
- Show stale-data warnings in the frontend when latest imported data is older than expected.

## Deliverable

- A deployed dashboard with verified scraper imports, reliable query APIs, and visible freshness/status metadata.
