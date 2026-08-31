# VAHAN Dashboard Project Handoff

## 1. Project Identity

- Name: VAHAN Dashboard
- Goal: Answer natural-language registration queries from VAHAN monthly aggregate data, with automatic scrape-on-miss behavior
- Owner: Amogh / current project team
- Date: 2026-05-16
- Tools: Node.js, Playwright/browser automation, CSV storage, backend API, frontend dashboard

## 2. Aim & Success Criteria

The system should let a user ask queries such as:

```text
give me data on EV in the rto of haridwar purchased in jan 2024
```

Success means:

- The query is parsed into structured filters.
- Required VAHAN data is checked locally first.
- Missing data is scraped automatically when possible.
- Results are returned as numeric dashboard output, not LLM-generated guesses.
- The UI shows summary cards, trend, fuel breakdown, rows, and freshness/source info.

Product rules:

- Use `registrations`, not `purchases`, in final labels.
- Source is official VAHAN public dashboard aggregate data.
- Current grain is monthly, not daily/live.
- Current location grain is RTO, not verified city/district.

## 3. What Is Done

### Data source and scraper

- The working source is the Parivahan Public Dashboard:

```text
https://analytics.parivahan.gov.in/analytics/publicdashboard/vahan?lang=en
```

- The scraper reads monthly fuel-wise aggregate registration data.
- Current filters used by the scraper:
  - Type: `Actual Value`
  - State
  - Optional RTO
  - Y-Axis: `Fuel`
  - X-Axis: `Month Wise`
  - Year Type: `Calendar Year`
  - Year

- Current output file:

```text
data/vahan/vahan_fuel_monthly.csv
```

- Current output columns:

```text
year,month,state,rto,fuel_segment,fuel_type,vehicle_count,scraped_at,source_url
```

- Implemented scraper features:
  - `scripts/vahan-scraper.mjs`
  - `--states`, `--rtos`, `--years`, `--months`
  - `--dry-run`, `--limit`, `--no-resume`
  - writes CSV, error log, and summary JSON
  - handles PrimeFaces hidden selects and checkboxes
  - parses two-row month headers correctly
  - adds `EV` / `NON_EV` segment classification

### Backend

- File: `server.mjs`
- Serves the dashboard UI from `public/`
- Reads `data/vahan/vahan_fuel_monthly.csv`
- Exposes:
  - `POST /api/query`
  - `GET /api/registrations`
  - `GET /api/metadata/rtos`
  - `GET /health`
- Converts user queries into structured filters
- Rule parser detects:
  - EV / non-EV / fuel keywords
  - month-year ranges like `May 2024 to May 2025`
  - year ranges like `2024-2025`
  - known state/RTO aliases such as Noida and Haridwar
- Gemini fallback is wired through `GEMINI_API_KEY`
- Gemini is intended only for filter decoding, not numeric answers
- Numeric answers always come from scraped CSV data

### Auto-scrape on miss

The intended flow is:

1. User submits query.
2. Backend decodes filters.
3. Backend checks loaded CSV.
4. If the required state/RTO/date range is missing and enough filters exist, backend runs the scraper.
5. Backend clears the CSV cache.
6. Backend reloads rows and answers.

This was verified with:

```text
how many ev cars were registered in haridwar between 2024-2025
```

Result:

- State: `Uttarakhand`
- RTO search: `haridwar`
- Range: `2024-01` to `2025-12`
- Total EV registrations: `7,708`
- Peak month: `2024-05`
- Peak month count: `479`
- Auto scraper triggered: `true`

### Frontend

- Files:

```text
public/index.html
public/app.js
public/styles.css
```

- Implemented:
  - query input
  - `POST /api/query`
  - total registrations
  - monthly average
  - peak month
  - row count
  - parsed filters
  - monthly trend bars
  - fuel breakdown
  - result rows
  - freshness/source label
  - working message during query processing
  - auto-scrape message when triggered

### Phase documents

Updated phase docs:

```text
Phase1.md
Phase2.md
Phase3.md
Phase4.md
Phase5.md
Phase6.md
```

The phase plan now matches the current direction:

- Monthly VAHAN aggregate dashboard source
- RTO/fuel/month data
- Query-driven frontend
- Backend query API
- Future PostgreSQL storage
- Freshness/source metadata

## 4. What Worked

- The original analytics URL returned 403 on this machine, so the alternate VAHAN report page became the working source.
- The scraper sample for Maharashtra Jan 2024 worked after fixing the month-count parsing bug.
- The Noida query worked after manual scrape:
  - State: `Uttar Pradesh`
  - RTO: `Noida - UP16( 13-NOV-2017 )`
  - Range: May 2024 to May 2025
  - Total EV registrations: `23,430`
  - Peak month: `2024-10`
  - Peak month count: `2,771`
- The Haridwar auto-scrape path worked and returned data automatically when the query missed cached rows.
- The frontend successfully displays backend query results and processing state.

## 5. What Did Not Work

- The original analytics dashboard is blocked with 403, even in headed Chrome/Edge.
  - Do not use it for scraping.
  - Use the `vahan4dashboard` report page instead.
- Early parser output read `1`, `2`, `3`, `4` instead of actual counts.
  - Cause: the parser read the serial-number column instead of the month columns.
  - Fix: use the `Month Wise` header offset.
- The earlier maker/company flow was the wrong product direction.
  - Current goal is general RTO/fuel/month aggregate data.
- Single-month queries had a bug.
  - Example: `jan 2024` could fall back to the full year.
  - `parseDateRange()` was added to treat a single month-year as a one-month range.
  - This still needs verification with `node --check server.mjs` and `node --check public\app.js`.
- The parser is not universal.
  - It works best for known aliases, clear EV/non-EV language, month/year or year-range dates, and currently mapped locations.

## 6. What Is Left

Prioritized next work:

1. Verify the single-month parser fix.
   - Run `node --check server.mjs`
   - Run `node --check public\app.js`
   - Test `give me data on EV in the rto of haridwar purchased in jan 2024`
   - Confirm the range is `2024-01` to `2024-01`
2. Improve RTO discovery.
   - Resolve exact RTO labels from the VAHAN UI instead of relying on hardcoded aliases.
3. Add Gemini properly.
   - Use it only to return structured JSON filters.
   - Validate the JSON before querying or scraping.
4. Move from CSV to PostgreSQL.
   - Add `registration_stats`
   - Add `rto_aliases`
   - Implement upsert imports
   - Back query APIs with SQL
5. Add vehicle class support.
   - Current `EV cars` still means EV registrations, not strictly motor cars.

Other known limitations:

- CSV is temporary storage.
- Auto-scrape can be slow, especially for broader date ranges.
- Dynamic RTO resolution is still basic for places beyond the currently mapped aliases.

## 7. Rules & Constraints

- The backend must never let an LLM invent registration numbers.
- Gemini may assist with interpretation, but final answers must come from VAHAN-scraped data or the local database.
- Use `registrations` in user-facing output, not `purchases`.
- The current source of truth is monthly VAHAN aggregate data.
- The current storage layer is CSV unless and until PostgreSQL is added.
- Preserve the existing working `vahan4dashboard` source unless there is a proven replacement.
- Do not broaden the meaning of `EV cars` without adding vehicle-class support.
- Keep query parsing conservative and validate all inferred filters.

## 8. First Instruction To The Next AI

Run the parser sanity check first:

```powershell
node --check server.mjs
node --check public\app.js
```

Then test this exact query:

```text
give me data on EV in the rto of haridwar purchased in jan 2024
```

Confirm whether it resolves to `2024-01` through `2024-01`. If it does not, fix that before touching any other feature.

