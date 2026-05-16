# Vahan Analytics Platform – Technology Stack (Updated)

This document describes the recommended stack for a **Progressive Web App (PWA)** that analyses aggregated Vahan registration data.  
PostgreSQL replaces MongoDB for structured, relational storage.

## Stack Overview

| Layer            | Technology                                      | Why |
|------------------|-------------------------------------------------|-----|
| Frontend         | React (Vite) + Tailwind CSS + Recharts          | Fast development, responsive dashboards, interactive charts. |
| Backend          | Node.js with Express                            | Unified JavaScript, easy integration with cron, email, push. |
| Database         | **PostgreSQL** (Neon) | Structured time‑series data, powerful SQL aggregations, familiar syntax. |
| ORM / Query Tool | Prisma (recommended) or Knex                    | Prisma gives type‑safe queries; Knex is a lightweight SQL builder. |
| Task Scheduler   | node-cron                                       | Simple cron jobs inside the Express process. |
| Notifications    | Email: Nodemailer + Gmail SMTP / SendGrid<br>Push: Web Push API (PWA) | Daily summaries via email and browser push. |
| Deployment       | Frontend: Vercel<br>Backend: Render / Railway<br>Database: Supabase (free tier) | All free tiers, GitHub‑connected CI/CD. |
| PWA Features     | Service Worker + manifest + Web Push            | Installable, offline support, home‑screen icon, cross‑platform push. |

## PWA First

The app is built as a PWA so users can:
- Receive push notifications on mobile & desktop **without an app store**.
- Install the dashboard on their home screen.
- Access the platform across all devices with a single codebase.