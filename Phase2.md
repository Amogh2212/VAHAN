# Phase 2: Backend Core & Data Storage

**Goal:** Build a backend that imports monthly VAHAN aggregate data, stores it in PostgreSQL, and answers structured dashboard queries.

## Tasks

### 1. Project Setup
- Use Node.js with Express.
- Install dependencies:
  - `express`
  - `pg` or `prisma` + `@prisma/client`
  - `dotenv`
  - `node-cron`
  - `zod` for request validation

### 2. Database Schema
Create a PostgreSQL table for monthly aggregate registration rows:

```sql
CREATE TABLE registration_stats (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    state VARCHAR(100) NOT NULL,
    rto VARCHAR(150) NOT NULL,
    fuel_segment VARCHAR(20) NOT NULL CHECK (fuel_segment IN ('EV', 'NON_EV')),
    fuel_type VARCHAR(100) NOT NULL,
    vehicle_count INTEGER NOT NULL,
    source_url TEXT NOT NULL,
    scraped_at TIMESTAMPTZ NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(year, month, state, rto, fuel_type)
);

CREATE INDEX idx_registration_stats_period ON registration_stats(year, month);
CREATE INDEX idx_registration_stats_location ON registration_stats(state, rto);
CREATE INDEX idx_registration_stats_fuel_segment ON registration_stats(fuel_segment);
```

Add an RTO alias table for natural-language location matching:

```sql
CREATE TABLE rto_aliases (
    id SERIAL PRIMARY KEY,
    alias VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    rto VARCHAR(150) NOT NULL,
    UNIQUE(alias, state, rto)
);
```

### 3. Import Pipeline
- Import rows from `data/vahan/vahan_fuel_monthly.csv`.
- Upsert by `year`, `month`, `state`, `rto`, and `fuel_type`.
- Store scrape/import metadata so the frontend can show freshness.
- Keep the scraper and importer separate: scraper extracts CSV, importer loads PostgreSQL.

### 4. Query API
Add structured and natural-language query endpoints:

```text
GET /api/registrations?state=&rto=&fuelSegment=&from=YYYY-MM&to=YYYY-MM
POST /api/query
GET /api/metadata/rtos?state=
GET /health
```

`POST /api/query` accepts:

```json
{
  "query": "give me data on EV in the rto of noida purchased between may 2024 - may 2025"
}
```

It returns:

```json
{
  "filters": {
    "fuelSegment": "EV",
    "state": "Uttar Pradesh",
    "rto": "resolved Noida RTO label",
    "from": "2024-05",
    "to": "2025-05"
  },
  "summary": {
    "total": 0,
    "monthlyAverage": 0
  },
  "trend": [],
  "rows": [],
  "freshness": {
    "latestMonth": "YYYY-MM",
    "source": "Official VAHAN public dashboard aggregate data"
  }
}
```

## Deliverable

- Backend API that can answer EV/non-EV monthly registration queries by state/RTO/date range from PostgreSQL.
