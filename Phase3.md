# Phase 3: Query-Driven Frontend Dashboard

**Goal:** Build a responsive dashboard where users can ask natural-language questions and receive structured VAHAN aggregate results.

## Tasks

### 1. Project Setup
- Initialize React with Vite.
- Add Tailwind CSS, Axios, Recharts, and React Query.
- Keep PWA support optional for the first usable dashboard, then enable it after the core query flow works.

### 2. Main Query Experience
- Add a prominent query input:

```text
Ask: EV registrations in Noida RTO between May 2024 and May 2025
```

- On submit, call `POST /api/query`.
- Show parsed filters back to the user:
  - fuel segment
  - state
  - RTO
  - date range
- If location is ambiguous, show selectable RTO matches.

### 3. Dashboard Components
- **Summary Cards:** total registrations, monthly average, peak month, latest available month.
- **Line Chart:** monthly trend for the selected date range.
- **Fuel Breakdown:** EV vs non-EV or raw fuel type split when requested.
- **Result Table:** month, state, RTO, fuel segment, fuel type, count.
- **Freshness Banner:** source and latest imported month.

### 4. Structured Filters
- Add fallback controls for users who do not want natural language:
  - state dropdown
  - RTO dropdown
  - EV/non-EV selector
  - from month
  - to month
- These controls call `GET /api/registrations`.

### 5. UX Rules
- Say `registrations`, not `purchases`, in final dashboard labels.
- Show `No data found` with suggested fixes when filters do not match.
- Do not claim daily or live data.

## Deliverable

- A dashboard where the user can ask a query like `EV in Noida RTO from May 2024 to May 2025` and see cards, charts, table rows, and source freshness.
