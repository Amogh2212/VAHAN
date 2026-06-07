---
name: VAHAN Analyst Dashboard
intent: Data-first vehicle registration intelligence UI for analysts and stakeholders.
style: Calm, dense, professional, operational.
tokens:
  color:
    background: "#0b1017"
    surface: "#111822"
    surface_raised: "#151e2a"
    surface_subtle: "#0f1620"
    border: "#263342"
    border_strong: "#385067"
    text: "#f3f6f8"
    text_secondary: "#b8c3cf"
    text_muted: "#7f8d9b"
    accent: "#23b383"
    accent_alt: "#4f8cff"
    warning: "#d79b2b"
    danger: "#e45f5f"
    success: "#27b778"
  typography:
    family: "Inter, ui-sans-serif, system-ui, sans-serif"
    base_size: "14px"
    line_height: "1.5"
  radius:
    small: "6px"
    medium: "8px"
    large: "8px"
  spacing:
    scale: "4px base, with 8px, 12px, 16px, 20px, 24px, 32px steps"
---

# VAHAN Analyst Dashboard Design Direction

## Overview
This product should feel like an operational analytics workspace, not a marketing SaaS page. The first priority is fast comprehension of registration data: query input, filters, totals, trend, comparison, and map state should all scan cleanly under repeated use.

Use a compact dark interface with restrained contrast, clear hierarchy, and minimal decoration. Motion should confirm state changes, not become a visual feature.

## Colors
Use dark neutral surfaces with a green primary accent for VAHAN/data freshness, blue for informational controls, amber for warnings, red for failures, and green for successful states. Avoid pages dominated by one hue or by decorative gradients.

Use gradients only for primary action surfaces and chart fills. Do not use large atmospheric blobs, heavy glass effects, or high-glow shadows.

## Typography
Use Inter throughout. Keep dashboard text compact and readable:
- Page titles: 28-34px desktop, 22-26px mobile.
- Panel headings: 13-15px, uppercase only when it helps scanning.
- Data values: bold, tabular-looking, no negative letter spacing.
- Labels and helper text: small but high contrast enough to read.

## Layout
Prefer dense, predictable dashboard layout:
- Query and topbar areas should be compact command surfaces.
- Panels should align to an 8px radius and consistent internal padding.
- Metric cards should be easy to compare horizontally and should not shift on hover.
- Mobile layouts should stack controls cleanly with no clipped labels.

## Components
Buttons should have clear primary, secondary, disabled, hover, active, and focus states. Inputs should have visible borders and strong focus rings. Sidebar navigation should feel like a tool menu, not a large drawer feature tour.

Charts should emphasize legibility over spectacle. Use consistent tracks, values aligned right, and chart fills with enough contrast against the track.

## Do
- Keep the UI calm, professional, and data-first.
- Make empty, loading, warning, and disabled states explicit.
- Preserve existing routes and vanilla HTML/CSS/JS architecture.
- Use compact spacing and high information density.

## Don't
- Do not add landing-page hero sections.
- Do not add decorative orbs, bokeh, or large visual backgrounds.
- Do not use oversized cards inside other cards.
- Do not change backend data behavior for visual-only work.
