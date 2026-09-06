# Phase 1: Data Source & Scraper Validation

**Goal:** Confirm and document the official VAHAN public dashboard as the working source for aggregate monthly registration data.

## Source Position

Use the official VAHAN public dashboard report page as the primary reference source for aggregate registration counts:

```text
https://analytics.parivahan.gov.in/analytics/publicdashboard/vahan?lang=en
```

This is not a documented public API. It is a public dashboard/report source, so the product must describe the data as **official VAHAN public dashboard aggregate data**, not live API data.

## Supported Data Shape

The current scraper extracts monthly aggregate rows with:

- `year`
- `month`
- `state`
- `rto`
- `fuel_segment` (`EV` or `NON_EV`)
- `fuel_type`
- `vehicle_count`
- `scraped_at`
- `source_url`

Example user wording:

```text
give me data on EV in the RTO of Noida purchased between May 2024 and May 2025
```

Product interpretation:

```text
EV registration counts for the matching Noida RTO scope between May 2024 and May 2025.
```

## Tasks

### 1. Validate VAHAN Dashboard Filters
- Confirm the scraper can select `Actual Value`, `State`, optional `RTO`, `Y-Axis = Fuel`, `X-Axis = Month Wise`, `Calendar Year`, and `Year`.
- Confirm sample rows for at least one state and month against the visible dashboard table.
- Keep scraping limited to public aggregate data only.

### 2. Confirm Location Handling
- Treat RTO as the location grain for now.
- Build/maintain an RTO alias map so user terms like `Noida` resolve to the correct VAHAN RTO label.
- Do not claim city/district granularity unless a verified city/district field is later added.

### 3. Define Freshness And Limits
- Store source URL and scrape timestamp with every import.
- Show a freshness label in the app, for example `Data updated through May 2025`.
- Use monthly data only; do not claim live or daily coverage.

## Deliverable

- A validated scraper output file at `data/vahan/vahan_fuel_monthly.csv`.
- A documented source decision: official VAHAN public dashboard aggregate monthly data, with RTO-level filtering where available.
