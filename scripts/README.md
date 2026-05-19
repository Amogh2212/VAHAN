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

The dashboard uses this catalog after Gemini/rule parsing to convert city or
RTO text into the exact VAHAN dropdown label before filtering or scraping.

When `DATABASE_URL` is present in `.env`, successful scrape rows are upserted
into Neon and also written to the local CSV files. If `DATABASE_URL` is absent,
the scraper continues to write CSV only.

## Neon Import

Create the Neon schema from `db/schema.sql`, then import the existing local CSV:

```powershell
npm run db:schema
npm run import:neon
```

The import is idempotent. Rows are upserted by:

```text
year, month, state, rto, fuel_type
```

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
