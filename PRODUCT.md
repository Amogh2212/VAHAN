# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are analysts and stakeholders who need to investigate Indian vehicle-registration activity repeatedly and quickly. The product also supports researchers, students, and journalists who need a traceable number, its geographic and time context, and a clear indication of whether the underlying data is complete enough to use.

## Product Purpose

VAHAN Analyst turns public vehicle-registration data into a searchable analytical workspace. Users can ask a natural-language question, inspect the filters the product interpreted, review totals and trends, compare places, explore maps and RTOs, and move from an answer into a downloadable or narrative report.

Success means a user can reach a trustworthy answer quickly, understand exactly what was counted, recognize freshness or coverage limitations, and continue into a deeper geographic or reporting workflow without losing context.

## Positioning

The product combines natural-language vehicle-registration queries with saved VAHAN data, bounded live refresh, geographic exploration, RTO-level monitoring, and explicit evidence-quality states in one local-first analytical workflow.

## Operating Context

Users commonly move between the query dashboard, comparisons, the India map, daily RTO trends, RTO reports, RTO insights, and monthly reports. Queries may use state, RTO, vehicle, fuel, category, class, norm, and date filters. Results can be complete, refreshing, partial, stale, missing, or failed, and those states materially affect whether a number is safe to export or report.

## Capabilities and Constraints

- Preserve the existing vanilla HTML, CSS, and JavaScript architecture.
- Preserve current routes, DOM hooks used by JavaScript, query behaviour, export behaviour, and server APIs.
- Treat this branch as a one-page dashboard redesign pilot before extending the visual system to other routes.
- Keep VAHAN metrics and data-quality warnings factual. Do not invent registrations, coverage, causation, customers, or performance claims.
- Do not trigger live VAHAN collection, mutate the scheduler or queue, or change database state for visual verification.
- Existing detailed analytical surfaces must remain reachable even when their visual redesign is deferred.

## Brand Commitments

Use the VAHAN Analyst name and a calm, independent research voice. The product should feel like an Indian mobility-intelligence publication and analytical tool rather than an AI-generated SaaS template. Public-data provenance, freshness, methodology, and coverage must remain prominent.

## Evidence on Hand

- Real query, registration, map, RTO, and report functionality under `public/`, `lib/`, and `server.mjs`.
- Existing desktop and mobile UI captures under `ui-preview-screenshots/`.
- Generated daily and monthly report artifacts under `reports/`.
- Repository checks and browser scripts under `scripts/`.
- External visual references approved for the pilot: Our World in Data, Harvard India Policy Insights, and CEEW's Electric Mobility Dashboard.

No customer testimonials, official-government endorsement, commercial benchmark, or causal market claim is available and none should be fabricated.

## Product Principles

1. Put the analytical question and the evidence answering it ahead of interface decoration.
2. Make interpretation, freshness, coverage, and limitations visible at the point of use.
3. Let users move naturally from overview to geography, comparison, RTO detail, and report.
4. Prefer restrained, publication-grade hierarchy over repeated cards, badges, and visual effects.
5. Trial substantial reporting or interface changes on one real, reversible surface before expanding them.
