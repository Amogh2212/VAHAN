---
name: VAHAN Analyst
description: A public-data editorial atlas for Indian vehicle-registration evidence.
colors:
  statistical-navy: "#0d3443"
  statistical-navy-deep: "#082733"
  signal-marigold: "#f0b429"
  signal-marigold-hover: "#ffc94f"
  evidence-teal: "#087a72"
  evidence-teal-deep: "#075e58"
  evidence-teal-soft: "#d9eeea"
  cool-paper: "#eef1ed"
  white-sheet: "#ffffff"
  copy: "#1d2d33"
  muted-copy: "#607077"
  rule: "#c8d1cd"
  rule-strong: "#9fada8"
  warning-ink: "#7d5100"
  warning-paper: "#fff4d6"
  danger-ink: "#a33a32"
  danger-paper: "#fdecea"
typography:
  display:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", Arial, sans-serif'
    fontSize: "38px"
    fontWeight: 720
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", Arial, sans-serif'
    fontSize: "25px"
    fontWeight: 720
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  title:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", Arial, sans-serif'
    fontSize: "17px"
    fontWeight: 720
    lineHeight: 1.5
    letterSpacing: "-0.012em"
  body:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", Arial, sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", Arial, sans-serif'
    fontSize: "11px"
    fontWeight: 800
    lineHeight: 1.5
    letterSpacing: "0.075em"
rounded:
  track: "1px"
  tight: "3px"
  surface: "4px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "22px"
  xl: "30px"
components:
  primary-action:
    backgroundColor: "{colors.signal-marigold}"
    textColor: "{colors.statistical-navy-deep}"
    rounded: "{rounded.tight}"
    padding: "0 22px"
    height: "54px"
  primary-action-hover:
    backgroundColor: "{colors.signal-marigold-hover}"
    textColor: "{colors.statistical-navy-deep}"
  secondary-action:
    backgroundColor: "transparent"
    textColor: "{colors.white-sheet}"
    rounded: "{rounded.tight}"
    padding: "0 16px"
    height: "40px"
  query-field:
    backgroundColor: "{colors.white-sheet}"
    textColor: "{colors.copy}"
    rounded: "{rounded.tight}"
    padding: "0 17px"
    height: "54px"
  evidence-panel:
    backgroundColor: "{colors.white-sheet}"
    textColor: "{colors.copy}"
    rounded: "{rounded.surface}"
    padding: "22px"
  navigation-active:
    backgroundColor: "{colors.signal-marigold}"
    textColor: "{colors.statistical-navy-deep}"
    rounded: "{rounded.tight}"
    padding: "0 10px"
    height: "42px"
  status-success:
    backgroundColor: "{colors.evidence-teal-soft}"
    textColor: "{colors.evidence-teal-deep}"
    rounded: "{rounded.tight}"
    padding: "3px 7px"
  warning-banner:
    backgroundColor: "{colors.warning-paper}"
    textColor: "{colors.warning-ink}"
    rounded: "{rounded.tight}"
    padding: "12px 16px"
---

# Design System: VAHAN Analyst

## Overview

**Creative North Star: "The Public-Data Atlas"**

VAHAN Analyst should feel like an independent mobility-research desk: cool paper beneath deep statistical navy, signal marigold reserved for decisive actions, and evidence teal attached to provenance and measured data. The visual voice is calm, exact, and publication-grade. Numbers and their qualifications carry more visual weight than interface decoration.

Operate and Read coexist in this world. Controls are compact and familiar; answers unfold as ruled evidence sheets with their interpretation and reliability close by. Motion only confirms focus, disclosure, and navigation state, and reduced-motion preferences remove it. The system rejects decorative gradients, glass, glows, and walls of interchangeable cards.

**Key Characteristics:**

- Cool paper and white evidence sheets framed by deep statistical navy.
- Fine rules, flat surfaces, taut corners, and very limited elevation.
- Tabular figures and explicit labels that keep evidence scannable.
- Marigold for action, teal for evidence, and semantic colors for exceptions.
- Responsive composition that preserves content order and access to provenance.

## Colors

The palette behaves like a printed statistical brief: a dark editorial frame, a pale reading field, and two scarce functional accents.

### Primary

- **Deep Statistical Navy** (`#0d3443`): anchors branded work surfaces and high-contrast analytical framing.
- **Index Navy** (`#082733`): provides the deepest navigation ground and primary ink for large figures.

### Secondary

- **Signal Marigold** (`#f0b429`): marks the primary action and current navigation location; its brighter hover state is Signal Marigold Hover (`#ffc94f`).

### Tertiary

- **Evidence Teal** (`#087a72`): identifies evidence labels, data marks, and provenance-oriented emphasis.
- **Evidence Teal Deep** (`#075e58`) and **Evidence Teal Soft** (`#d9eeea`): pair for positive, confirmed status treatments.

### Neutral

- **Cool Paper** (`#eef1ed`): the application reading field.
- **White Sheet** (`#ffffff`): fields and evidence panels.
- **Editorial Copy** (`#1d2d33`) and **Muted Copy** (`#607077`): primary explanation and supporting context.
- **Rule** (`#c8d1cd`) and **Strong Rule** (`#9fada8`): dividers, panel borders, and structural grouping.

### State colors

- **Warning Ink** (`#7d5100`) on **Warning Paper** (`#fff4d6`): bounded-data, freshness, and review-required messages.
- **Danger Ink** (`#a33a32`) on **Danger Paper** (`#fdecea`): failed or unsafe states.

**The Signal Economy Rule.** Marigold denotes a decisive action or current location; it is never background decoration.

**The Evidence Color Rule.** Teal describes provenance, completeness, or plotted evidence and never implies confidence that the data state has not earned.

## Typography

**Display Font:** Segoe UI Variable Text (with Segoe UI, Arial, and sans-serif fallbacks)

**Body Font:** Segoe UI Variable Text (with Segoe UI, Arial, and sans-serif fallbacks)

**Label/Mono Font:** No separate mono face; numeric evidence uses tabular figures in the system sans.

**Character:** A neutral civic sans keeps the interface familiar and lets differences in size, weight, and spacing carry the hierarchy. Sentence case dominates; uppercase is reserved for short evidence and section labels.

### Hierarchy

- **Display** (720, `38px`, `1.08`): one concise surface thesis, reducing to `30px` and then `27px` on narrow screens.
- **Headline** (720, `25px`, `1.5`): the title of an answer or major reading section.
- **Title** (720, `17px`, `1.5`): panel-level headings that remain descriptive rather than promotional.
- **Body** (400, `15px`, `1.5`): explanations and reading guidance, generally constrained to about 72 characters per line.
- **Label** (800, `11px`, `0.075em` letter spacing): short section and evidence labels; uppercase only where it improves scanning.

**The Figures Speak First Rule.** Registration values use strong weight, tabular numerals, and plain ink; never apply gradients, outlines, or novelty display type to data.

## Layout

The spacing rhythm is compact but breathable, using the implemented `4px`, `8px`, `14px`, `22px`, and `30px` steps. Evidence aligns to clear columns on wide screens and becomes a single reading stream on small screens. Summary figures compare across a ruled strip, while panels use consistent internal padding (`22px`) and structural gaps (`14px`).

Atlas-style analytical surfaces may use the dashboard's persistent `244px` route index on wide screens and its compact drawer below `960px`. That pattern is available, not mandatory: each surface brief decides whether a permanent index supports the task. At `720px`, queries, evidence panels, and reliability context stack without changing their semantic order; `420px` tightens typography and controls without hiding evidence.

**The One Reading Order Rule.** Responsive layouts may reflow, but the question, interpretation, trend, detail, and reliability context retain a coherent document order.

## Elevation & Depth

The system is flat by default. White sheets separate from Cool Paper through a one-pixel rule rather than a shadow, and navigation separates through tonal contrast. Elevation is reserved for temporary overlays: export menus use a restrained ambient shadow (`0 16px 36px rgba(8, 39, 51, 0.18)`) and the mobile drawer uses a stronger overlay shadow (`0 24px 54px rgba(8, 39, 51, 0.34)`).

**The Flat Evidence Rule.** Persistent analytical surfaces never float for decoration; borders and tonal fields establish hierarchy at rest.

## Shapes

Corners are taut and minimally softened. Interactive controls, active navigation, tags, and notices use the tight radius (`3px`); major surfaces and drawers use the surface radius (`4px`); chart tracks and fills use the near-square track radius (`1px`). Fine one-pixel borders and dividers do most of the grouping.

**The Taut Corner Rule.** Radius clarifies containment but must not turn analytical elements into pills, bubbles, or friendly SaaS cards.

## Components

Components feel restrained and decisive: strong hierarchy, obvious states, and no decorative lift.

### Buttons

- **Shape:** compact rectangular controls with a tight radius (`3px`).
- **Primary:** Signal Marigold with Index Navy text, a `54px` query-action height, and `0 22px` padding.
- **Hover / Focus:** brighten to Signal Marigold Hover without translating; all keyboard focus uses a visible `3px` marigold outline with a `3px` offset.
- **Secondary:** transparent over Statistical Navy with a visible cool border and white text; it deepens tonally on hover without a shadow.

### Inputs / Fields

- **Style:** White Sheet, Editorial Copy, a tight radius (`3px`), a `54px` height, and `0 17px` padding.
- **Focus:** the transparent border becomes Signal Marigold; no glow is added.
- **Disabled / Loading:** shift to a quiet gray-green field while preserving legible text and state explanation.

### Navigation

Wide atlas navigation uses a deep navy index with compact `42px` links. Default links are cool blue-white, hover uses a darker tonal field, and the current destination switches to Signal Marigold with Index Navy text. On narrow screens the same navigation becomes a keyboard-operable drawer; click-away and Escape close it.

### Cards / Containers

- **Corner Style:** minimally softened (`4px`).
- **Background:** White Sheet on Cool Paper, or Statistical Navy for a high-contrast work surface.
- **Shadow Strategy:** none at rest; follow the Flat Evidence Rule.
- **Border:** one-pixel Rule, with Strong Rule reserved for major boundaries.
- **Internal Padding:** normally `22px`, increasing to `30px` only for a primary work surface.

### Status tags and notices

Status tags are compact bordered rectangles rather than pills. Teal confirms completed evidence; warning and danger pairs describe review-required and failed states. Notices sit in the document flow so they cannot obscure actions or data.

### Evidence figures and charts

Headline figures use tabular numerals and plain Index Navy ink. Charts use Evidence Teal for the measured series, Signal Marigold only for a comparison or annotation, pale rule-colored grids, and text summaries for assistive technology. Evidence rows read like a table even when rendered as responsive cards.

## Do's and Don'ts

### Do:

- **Do** keep interpretation, freshness, coverage, and save state beside the figures they qualify.
- **Do** use Cool Paper, White Sheet, and one-pixel rules to build hierarchy before adding elevation.
- **Do** reserve Signal Marigold for primary actions and the current navigation location.
- **Do** preserve clear keyboard focus, document order, and reduced-motion behavior at every breakpoint.
- **Do** let each surface brief choose its composition while reusing the atlas palette, typography, shape, and evidence language.

### Don't:

- **Don't** use gradients, glass, atmospheric glows, decorative blobs, or hover lift in persistent analytical surfaces.
- **Don't** turn every metric or paragraph into a rounded card or badge.
- **Don't** use Teal or Marigold as decoration detached from evidence, action, or state.
- **Don't** hide partial, stale, missing, or failed states behind reassuring color or ambiguous copy.
- **Don't** copy the homepage's `244px` index into every route; surface purpose determines navigation composition.
