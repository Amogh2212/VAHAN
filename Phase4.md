# Phase 4: Alerts & Saved Insights

**Goal:** Let users subscribe to useful monthly VAHAN aggregate insights by state, RTO, and fuel segment.

## Tasks

### 1. Email Alerts
- Install `nodemailer` or use SendGrid.
- Store subscribers in PostgreSQL with preferences:
  - email
  - state
  - optional RTO
  - fuel segment (`EV`, `NON_EV`, or all)
  - status
- Send monthly or latest-import summaries, not daily alerts.

### 2. Push Notifications
- Add PWA push support after the dashboard query flow is stable.
- Store push subscriptions in PostgreSQL.
- Send short insight notifications such as:

```text
EV registrations in Noida RTO increased 12% in the latest imported month.
```

### 3. Saved Queries
- Let users save query presets like:

```text
EV in Noida RTO from May 2024 to May 2025
```

- Saved queries should reopen the dashboard with the same parsed filters.

## Deliverable

- A subscription system that sends monthly aggregate VAHAN insights based on user-selected state/RTO/fuel preferences.
