# Phase 6: Advanced Analytics & Polish

**Goal:** Improve the dashboard after the core query-to-result flow is stable.

## Optional Enhancements

### 1. Comparison Mode
- Compare two RTOs, states, fuel segments, or date ranges.
- Show absolute change and percentage change.

### 2. Interactive Map
- Add an India map showing EV or total registration intensity by state.
- Drill down from state to RTO where data is available.

### 3. Exportable Reports
- Add `Download CSV` and `Download PDF` for current dashboard results.
- Include filters, freshness, and source URL in exports.

### 4. Better Natural-Language Parsing
- Add synonym handling:
  - `electric`, `EV`, `battery vehicle` -> `EV`
  - `bought`, `purchased`, `registered` -> registration counts
- Add clear confirmation when the parser resolves a place name to an RTO.

### 5. User Accounts
- Let users save dashboards, alerts, and preferred RTOs.
- Add Google OAuth or email/password after the public dashboard is stable.

### 6. Performance Optimization
- Cache common queries with React Query and backend response caching.
- Precompute monthly summaries by state/RTO/fuel segment.

## Note

These features should come after the main experience works: user asks a question, backend resolves filters, dashboard shows structured monthly VAHAN aggregate results.
