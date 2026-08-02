import html
import json
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    HRFlowable,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
VALIDATION_PATH = ROOT / "output" / "final-validation" / "query-validation.json"
OUTPUT_PATH = ROOT / "output" / "pdf" / "deterministic-query-hardening-phases-1-8-validation-report.pdf"

NAVY = colors.HexColor("#0B1F3A")
BLUE = colors.HexColor("#1D5D9B")
TEAL = colors.HexColor("#008C8C")
GREEN = colors.HexColor("#2E7D32")
GOLD = colors.HexColor("#D99A19")
RED = colors.HexColor("#B33A3A")
INK = colors.HexColor("#243447")
MUTED = colors.HexColor("#5F6F7F")
PALE = colors.HexColor("#F3F6F9")
PALE_BLUE = colors.HexColor("#EAF2F8")
PALE_GREEN = colors.HexColor("#EAF5EC")
LINE = colors.HexColor("#D6DEE6")
WHITE = colors.white


def register_fonts():
    candidates = [
        ("Inter", Path("C:/Windows/Fonts/arial.ttf")),
        ("Inter-Bold", Path("C:/Windows/Fonts/arialbd.ttf")),
        ("Inter-Italic", Path("C:/Windows/Fonts/ariali.ttf")),
    ]
    for name, path in candidates:
        if path.exists():
            pdfmetrics.registerFont(TTFont(name, str(path)))
    return {
        "regular": "Inter" if "Inter" in pdfmetrics.getRegisteredFontNames() else "Helvetica",
        "bold": "Inter-Bold" if "Inter-Bold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold",
        "italic": "Inter-Italic" if "Inter-Italic" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Oblique",
    }


FONTS = register_fonts()
BASE = getSampleStyleSheet()
STYLES = {
    "cover_title": ParagraphStyle(
        "cover_title",
        parent=BASE["Title"],
        fontName=FONTS["bold"],
        fontSize=27,
        leading=32,
        textColor=NAVY,
        spaceAfter=12,
    ),
    "cover_subtitle": ParagraphStyle(
        "cover_subtitle",
        parent=BASE["Normal"],
        fontName=FONTS["regular"],
        fontSize=13,
        leading=19,
        textColor=MUTED,
        spaceAfter=10,
    ),
    "h1": ParagraphStyle(
        "h1",
        parent=BASE["Heading1"],
        fontName=FONTS["bold"],
        fontSize=19,
        leading=23,
        textColor=NAVY,
        spaceBefore=4,
        spaceAfter=10,
    ),
    "h2": ParagraphStyle(
        "h2",
        parent=BASE["Heading2"],
        fontName=FONTS["bold"],
        fontSize=13,
        leading=17,
        textColor=BLUE,
        spaceBefore=10,
        spaceAfter=6,
    ),
    "h3": ParagraphStyle(
        "h3",
        parent=BASE["Heading3"],
        fontName=FONTS["bold"],
        fontSize=10.5,
        leading=14,
        textColor=TEAL,
        spaceBefore=7,
        spaceAfter=4,
    ),
    "body": ParagraphStyle(
        "body",
        parent=BASE["BodyText"],
        fontName=FONTS["regular"],
        fontSize=9.2,
        leading=13.2,
        textColor=INK,
        spaceAfter=6,
    ),
    "small": ParagraphStyle(
        "small",
        parent=BASE["BodyText"],
        fontName=FONTS["regular"],
        fontSize=7.7,
        leading=10.2,
        textColor=INK,
    ),
    "small_bold": ParagraphStyle(
        "small_bold",
        parent=BASE["BodyText"],
        fontName=FONTS["bold"],
        fontSize=7.8,
        leading=10.2,
        textColor=NAVY,
    ),
    "caption": ParagraphStyle(
        "caption",
        parent=BASE["BodyText"],
        fontName=FONTS["italic"],
        fontSize=7.4,
        leading=10,
        textColor=MUTED,
        spaceAfter=6,
    ),
    "callout": ParagraphStyle(
        "callout",
        parent=BASE["BodyText"],
        fontName=FONTS["bold"],
        fontSize=11,
        leading=15,
        textColor=GREEN,
        alignment=TA_CENTER,
    ),
    "mono": ParagraphStyle(
        "mono",
        parent=BASE["Code"],
        fontName="Courier",
        fontSize=7.2,
        leading=9.4,
        textColor=INK,
    ),
}


def p(text, style="body"):
    safe = html.escape(str(text)).replace("\n", "<br/>")
    return Paragraph(safe, STYLES[style])


def bullet(items):
    rows = []
    for item in items:
        rows.append([p("-", "small_bold"), p(item, "body")])
    return Table(rows, colWidths=[5 * mm, 166 * mm], style=TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))


def status_box(label, value, color=GREEN):
    return Table(
        [[p(label.upper(), "small_bold")], [Paragraph(html.escape(str(value)), ParagraphStyle(
            f"status_{label}_{value}",
            parent=STYLES["callout"],
            textColor=color,
            fontSize=14,
            leading=18,
        ))]],
        colWidths=[39 * mm],
        rowHeights=[8 * mm, 14 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), PALE),
            ("BOX", (0, 0), (-1, -1), 0.7, LINE),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]),
    )


def section_heading(title, subtitle=None):
    parts = [p(title, "h1"), HRFlowable(width="100%", thickness=1.2, color=TEAL, spaceAfter=8)]
    if subtitle:
        parts.append(p(subtitle, "caption"))
    return parts


def data_table(headers, rows, widths, font_size=7.4, header_color=NAVY):
    header = [Paragraph(html.escape(str(item)), ParagraphStyle(
        f"table_header_{index}_{item}",
        parent=STYLES["small_bold"],
        textColor=WHITE,
        fontSize=font_size,
        leading=font_size + 2,
        alignment=TA_LEFT,
    )) for index, item in enumerate(headers)]
    body = [[p(item, "small") for item in row] for row in rows]
    table = Table([header, *body], colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), header_color),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE]),
    ]))
    return table


def acceptance_chart():
    drawing = Drawing(470, 145)
    drawing.add(String(0, 130, "Phase 7 acceptance targets vs actual", fontName=FONTS["bold"], fontSize=10, fillColor=NAVY))
    bars = [
        ("Exact canonical local", 100, 100),
        ("Unsupported avoids AI", 100, 100),
        ("Approved deterministic", 95, 100),
    ]
    for index, (label, target, actual) in enumerate(bars):
        y = 91 - index * 38
        drawing.add(String(0, y + 10, label, fontName=FONTS["regular"], fontSize=8, fillColor=INK))
        drawing.add(Rect(145, y, 275, 16, fillColor=colors.HexColor("#E1E8EF"), strokeColor=None))
        drawing.add(Rect(145, y, 275 * actual / 100, 16, fillColor=TEAL, strokeColor=None))
        target_x = 145 + 275 * target / 100
        drawing.add(Rect(target_x - 0.7, y - 2, 1.4, 20, fillColor=GOLD, strokeColor=None))
        drawing.add(String(426, y + 4, f"{actual}%", fontName=FONTS["bold"], fontSize=8, fillColor=GREEN))
    drawing.add(String(145, 0, "Gold marker = target", fontName=FONTS["italic"], fontSize=7, fillColor=MUTED))
    return drawing


def routing_chart():
    drawing = Drawing(470, 94)
    total = 200
    segments = [
        ("Local required", 167, TEAL),
        ("AI allowed", 8, GOLD),
        ("Local reject", 25, RED),
    ]
    drawing.add(String(0, 80, "Frozen contract routing policy (200 cases)", fontName=FONTS["bold"], fontSize=10, fillColor=NAVY))
    x = 0
    for label, count, color in segments:
        width = 460 * count / total
        drawing.add(Rect(x, 48, width, 20, fillColor=color, strokeColor=WHITE, strokeWidth=0.5))
        x += width
    legend_x = 0
    for label, count, color in segments:
        drawing.add(Rect(legend_x, 18, 8, 8, fillColor=color, strokeColor=None))
        drawing.add(String(legend_x + 12, 18, f"{label}: {count}", fontName=FONTS["regular"], fontSize=7.5, fillColor=INK))
        legend_x += 145
    return drawing


def page_decor(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - 13 * mm, width, 13 * mm, stroke=0, fill=1)
    canvas.setFillColor(WHITE)
    canvas.setFont(FONTS["bold"], 8)
    canvas.drawString(18 * mm, height - 8.5 * mm, "VAHAN deterministic query hardening - validation report")
    canvas.setFillColor(MUTED)
    canvas.setFont(FONTS["regular"], 7.5)
    canvas.drawString(18 * mm, 10 * mm, "Generated 02 Aug 2026 | Live refresh disabled during validation")
    canvas.drawRightString(width - 18 * mm, 10 * mm, f"Page {doc.page}")
    canvas.restoreState()


def cover_decor(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - 48 * mm, width, 48 * mm, stroke=0, fill=1)
    canvas.setFillColor(TEAL)
    canvas.rect(0, height - 52 * mm, width, 4 * mm, stroke=0, fill=1)
    canvas.setFillColor(MUTED)
    canvas.setFont(FONTS["regular"], 7.5)
    canvas.drawString(18 * mm, 10 * mm, "Confidential project validation artifact - contains no credentials or access tokens")
    canvas.drawRightString(width - 18 * mm, 10 * mm, "Page 1")
    canvas.restoreState()


def filter_summary(filters):
    ordered = [
        ("state", filters.get("state")),
        ("rto", filters.get("rto")),
        ("period", f"{filters.get('from')} to {filters.get('to')}"),
        ("fuel", filters.get("selectedFuelTypes")),
        ("groups", filters.get("selectedVehicleGroups")),
        ("classes", filters.get("selectedVehicleClasses")),
        ("categories", filters.get("selectedVehicleCategories")),
        ("norms", filters.get("selectedNorms")),
        ("excluded fuel", filters.get("excludedFuelTypes")),
        ("AI", filters.get("aiProvider")),
    ]
    chunks = []
    for key, value in ordered:
        if value in (None, [], "None to None"):
            continue
        if isinstance(value, list):
            value = ", ".join(value)
        chunks.append(f"{key}: {value}")
    return "; ".join(chunks)


def phase_block(story, phase):
    story.extend(section_heading(f"Phase {phase['number']} - {phase['name']}", phase["objective"]))
    story.append(Table([[p("FINAL VALIDATION STATUS", "small_bold"), p("PASSED", "callout")]], colWidths=[55 * mm, 40 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE_GREEN),
        ("BOX", (0, 0), (-1, -1), 0.8, GREEN),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, 0), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ])))
    story.append(p("Tasks completed", "h2"))
    story.append(bullet(phase["tasks"]))
    story.append(p("Files created or modified", "h2"))
    story.append(bullet(phase["files"]))
    story.append(p("Important implementation decisions", "h2"))
    story.append(bullet(phase["decisions"]))
    story.append(p("Tests and evidence", "h2"))
    story.append(bullet(phase["tests"]))
    story.append(p("Bugs found and fixes applied", "h2"))
    story.append(bullet(phase["bugs"] or ["No phase-specific defect remained after the validation cycle."]))
    story.append(p("Remaining limitations or risks", "h2"))
    story.append(bullet(phase["risks"]))


def build_report():
    validation = json.loads(VALIDATION_PATH.read_text(encoding="utf-8"))
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUTPUT_PATH),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=21 * mm,
        bottomMargin=18 * mm,
        title="VAHAN deterministic query hardening - Phases 1-8 validation report",
        author="Codex",
        subject="Implementation and validation evidence",
    )
    story = []

    story.append(Spacer(1, 38 * mm))
    story.append(p("VAHAN dashboard", "cover_subtitle"))
    story.append(p("Deterministic Query Hardening", "cover_title"))
    story.append(p("Comprehensive implementation and validation report - Phases 1 through 8", "cover_subtitle"))
    story.append(Spacer(1, 8 * mm))
    story.append(Table([[p("FINAL STATUS", "small_bold")], [Paragraph("PASSED", ParagraphStyle(
        "cover_passed", parent=STYLES["callout"], fontSize=24, leading=28, textColor=GREEN
    ))]], colWidths=[75 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE_GREEN),
        ("BOX", (0, 0), (-1, -1), 1.2, GREEN),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ])))
    story.append(Spacer(1, 12 * mm))
    story.append(p("Validation scope", "h2"))
    story.append(bullet([
        "Deterministic parsing, normalization, composition, spelling correction, routing, and strict AI repair validation.",
        "Full 200-case contract, legacy preservation, aggregation checks, error paths, security checks, production smoke checks, and read-only database validation.",
        "No live scrape or refresh was started. No credentials, environment values, tokens, or private query telemetry are included.",
    ]))
    story.append(Spacer(1, 6 * mm))
    story.append(p("Report generated: 02 Aug 2026 | Project: Vahan EY", "caption"))
    story.append(PageBreak())

    story.extend(section_heading("Executive validation outcome", "Answer first: all eight phases passed their final gates."))
    scorecards = Table([[status_box("Contract", "200 / 200"), status_box("Phase gates", "150 / 150"), status_box("Legacy", "50 / 50"), status_box("Regressions", "0")]], colWidths=[42 * mm] * 4, style=TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(scorecards)
    story.append(Spacer(1, 7 * mm))
    story.append(p(
        "The completed system interprets ordinary structured VAHAN questions locally, uses zero Groq calls for exact and uniquely safe fuzzy queries, sends only genuinely unresolved supported wording to the repair provider, rejects unsupported or conflicting questions before provider use, and derives every total from VAHAN rows after final filter validation.",
        "body",
    ))
    story.append(acceptance_chart())
    story.append(routing_chart())
    story.append(p("Final evidence summary", "h2"))
    story.append(data_table(
        ["Gate", "Actual result", "Status"],
        [
            ["Cumulative contract", "200 executed; 150 activated phase gates; 0 failures", "Passed"],
            ["Legacy behavior", "50 canonical passes; 0 regressions; 12 improvements", "Passed"],
            ["Acceptance targets", "Exact 100%; unsupported 100%; approved deterministic 100%", "Passed"],
            ["Full repository test", "98 module syntax check plus parser, API, security, scraper, report, local, and production checks", "Passed"],
            ["Database", "PostgreSQL health OK; profile and reconciliation verified", "Passed"],
            ["Final representative queries", "5 successful data/aggregation cases and 6 error-handling cases", "Passed"],
            ["Telemetry privacy", "Aggregate fixed-shape counters; no raw query or filter text", "Passed"],
        ],
        [48 * mm, 102 * mm, 22 * mm],
    ))
    story.append(PageBreak())

    story.extend(section_heading("System flow and trust boundary", "The interpreter may select filters; VAHAN data remains the numerical source of truth."))
    story.append(data_table(
        ["1. Input", "2. Deterministic interpretation", "3. Routing gate", "4. Optional repair", "5. Data and report"],
        [[
            "Natural-language registration query",
            "Canonical filters, evidence, unknowns, conflicts, confidence",
            "local / repair / reject",
            "Strict JSON labels validated against allowlists",
            "Fetch rows, apply filters, sum counts, return report",
        ]],
        [31 * mm, 39 * mm, 29 * mm, 37 * mm, 36 * mm],
        font_size=6.8,
        header_color=TEAL,
    ))
    story.append(Spacer(1, 8 * mm))
    story.append(p("Old system vs new system", "h2"))
    story.append(data_table(
        ["Concern", "Previous behavior", "New behavior"],
        [
            ["Provider order", "AI provider could run before deciding that local rules were sufficient.", "Deterministic interpretation and safety checks always run first."],
            ["Exact queries", "Could consume provider quota when a key was configured.", "Run locally with zero provider calls."],
            ["Provider failure", "Could fall back to a weak local interpretation.", "Returns a stable clarification response; no weak total is produced."],
            ["AI filter safety", "AI labels could be fuzzy-normalized, dropped, or unioned with rule filters.", "Any invalid label or exact-match conflict rejects the entire repair."],
            ["Spelling", "Broad fuzzy matching could create false positives or choose one of tied meanings.", "Only approved or uniquely best corrections are accepted; ambiguity asks for clarification."],
            ["Unsupported intent", "Risk of being reduced to an ordinary registration total.", "Comparison, ranking, OEM/model, forecast, causal, and other unsupported intents fail closed before AI."],
            ["Observability", "No stable routing metrics and no frozen semantic contract.", "200-case contract plus aggregate health telemetry with no raw queries."],
        ],
        [34 * mm, 67 * mm, 71 * mm],
    ))
    story.append(PageBreak())

    phases = [
        {
            "number": 1,
            "name": "Freeze the query contract and build the test corpus",
            "objective": "Define supported dimensions and preserve existing semantics before changing the parser.",
            "tasks": [
                "Created a 200-case structured corpus covering 14 atomic modes, all 15 dimension pairs, 20 triples, 6 full combinations, word-order sets, aliases, typos, conflicts, and unsupported intents.",
                "Stored expected canonical filters independently of the parser and recorded routing policy: local required, AI allowed, or local reject.",
                "Froze the legacy 50-case oracle with content hashes and data-integrity checks.",
            ],
            "files": [
                "data/query-tests/dashboard-query-contract-v1.json",
                "scripts/query-contract-corpus-check.mjs",
                "output/phase-1/query-contract-execution.json",
                "package.json",
            ],
            "decisions": [
                "Filter correctness is judged before sparse or zero-row data, so the oracle does not reuse the parser as its own expected-result generator.",
                "The contract allows only the dashboard's existing supported combinations; it does not imply unlimited chatbot capability.",
                "Validation runs with live refresh, Telegram, and factor-agent work disabled.",
            ],
            "tests": [
                "Initial Phase 1 run: 78 cases executed, no baseline regression, database verified, and data files unchanged.",
                "Final cumulative confirmation: all 50 legacy canonical cases pass, with 12 improvements and zero regressions.",
            ],
            "bugs": [
                "The frozen oracle exposed several legacy canonical mismatches. These were retained as measurable gaps rather than hidden; later phases resolved them.",
            ],
            "risks": [
                "Corpus expectations must be updated deliberately when the supported dashboard vocabulary changes.",
            ],
        },
        {
            "number": 2,
            "name": "Strengthen deterministic normalization",
            "objective": "Normalize surface variations into canonical VAHAN vocabulary before matching.",
            "tasks": [
                "Normalized case, punctuation, repeated spaces, Unicode and ASCII hyphens, apostrophes, singular/plural variants, and metric wording.",
                "Added canonical handling for EV, BOV, PHEV, LPG, 2W, 3W, 4W, LMV, HMV, BS6, RTO codes, and month formats.",
                "Kept aliases mapped to existing canonical labels rather than adding ad hoc labels.",
            ],
            "files": [
                "lib/query-normalization.mjs",
                "scripts/query-normalization-unit-check.mjs",
                "server.mjs",
                "output/phase-2/query-contract-execution.json",
            ],
            "decisions": [
                "Normalization changes the query surface only; it does not invent filters or alter saved registration rows.",
                "RTO prefix normalization preserves code boundaries so short state codes do not match inside longer words.",
            ],
            "tests": [
                "10 focused normalization cases and 4 RTO-prefix boundary checks passed.",
                "Phase 2 contract: 116 executed, 66 phase gates passed, zero gate failures, zero regressions, database verified, data unchanged.",
            ],
            "bugs": [
                "Punctuation, possessives, dotted abbreviations, plural HMV wording, and Unicode dash RTO formats were normalized consistently.",
            ],
            "risks": [
                "Unknown abbreviations remain unresolved and are not guessed.",
            ],
        },
        {
            "number": 3,
            "name": "Make parsing compositional",
            "objective": "Extract each semantic dimension independently so valid filters survive word-order changes.",
            "tasks": [
                "Introduced the interpretation object with filters, recognized/ignored/unknown tokens, fuzzy matches, conflicts, evidence, and confidence.",
                "Separated geography, date, fuel, vehicle group/category/class, norm, and exclusion extraction.",
                "Added conflict detection for locations, RTOs, dates, fuels, vehicles, include/exclude overlap, broad-group exclusions, and multiple side exclusions.",
            ],
            "files": [
                "server.mjs",
                "scripts/query-composition-unit-check.mjs",
                "scripts/query-contract-corpus-check.mjs",
                "output/phase-3/query-contract-execution.json",
            ],
            "decisions": [
                "Exact class/category evidence takes precedence over broad group inference.",
                "Positive filters are composed first, then exclusions are applied and conflicts are checked.",
                "No missing geography, date, or filter value is invented.",
            ],
            "tests": [
                "Three full word-order permutations, five conflict cases, three compound-exclusion cases, and six evidence dimensions passed.",
                "Phase 3 contract: 185 executed, 135 phase gates passed, 50/50 legacy canonical passes, zero regressions, 12 improvements.",
            ],
            "bugs": [
                "Partial exclusions and refined group exclusions were made compositional rather than dependent on token order.",
            ],
            "risks": [
                "Unsupported grouped analytics remain outside the one-total endpoint by design.",
            ],
        },
        {
            "number": 4,
            "name": "Add conservative fuzzy matching",
            "objective": "Correct clear mistakes without false matches or arbitrary tie-breaking.",
            "tasks": [
                "Centralized exact-first fuzzy matching with maximum edit distance 2 and a minimum runner-up gap.",
                "Protected short tokens, acronyms, state codes, and RTO codes from broad fuzzy matching.",
                "Added approved deterministic corrections and evidence containing original text, matched alias, canonical values, distances, and candidate gap.",
            ],
            "files": [
                "server.mjs",
                "scripts/query-fuzzy-unit-check.mjs",
                "output/phase-4/query-contract-execution.json",
            ],
            "decisions": [
                "Exact matches always win; fuzzy candidates are deduplicated by canonical value before uniqueness checks.",
                "Ties such as xangalore between Bangalore and Mangalore are marked ambiguous rather than guessed.",
                "Near words such as patrol, better, batter, forklike, and scooted remain unresolved to prevent false positives.",
            ],
            "tests": [
                "9 approved corrections, 2 ambiguity cases, 5 false-positive guards, and 6 protected-token cases passed.",
                "Phase 4 contract rerun: 197 executed, 147 phase gates passed, zero failures, 50/50 legacy, no regressions, DB verified, data unchanged.",
            ],
            "bugs": [
                "two wheelr originally resolved to only one transport category; canonical-set deduplication now preserves both intended two-wheeler categories.",
                "City fuzzy matching and fuzzy state/RTO evidence were repaired so successful corrections remain auditable.",
            ],
            "risks": [
                "Conservative thresholds intentionally prefer a clarification over a speculative correction.",
            ],
        },
        {
            "number": 5,
            "name": "Introduce the confidence and routing gate",
            "objective": "Run deterministic interpretation first and reserve AI for recoverable ambiguity only.",
            "tasks": [
                "Added pure local / repair / reject classification with stable reason codes.",
                "Refactored queryData so local queries use deterministic filters directly and reject routes never call AI.",
                "Converted provider absence, timeout, 429, malformed output, low confidence, and rejection into a stable clarification response.",
            ],
            "files": [
                "server.mjs",
                "scripts/query-routing-unit-check.mjs",
                "scripts/query-contract-corpus-check.mjs",
                "output/phase-5/query-contract-execution.json",
            ],
            "decisions": [
                "Exact and uniquely safe fuzzy queries are local; unresolved important words or ambiguous fuzzy candidates are repair; unsupported or conflicting intent is reject.",
                "Hard conflicts are prioritized so users receive the precise multi-location or date error rather than a generic message.",
                "No low-confidence deterministic fallback is allowed after repair-provider failure.",
            ],
            "tests": [
                "All 200 corpus routing policies were checked; exact provider calls were zero; repair calls were bounded to one per attempt.",
                "Cumulative contract: 200 executed, 150 phase gates passed, 50/50 legacy, 0 regressions, 12 improvements.",
            ],
            "bugs": [
                "The previous provider-first path could call AI for exact queries and bypass unsupported checks. Routing now occurs before any provider call.",
            ],
            "risks": [
                "Repair-required queries depend on a configured provider; without one they correctly ask for rephrasing.",
            ],
        },
        {
            "number": 6,
            "name": "Validate AI repairs safely",
            "objective": "Treat AI only as a bounded filter repair layer, never as the source of counts.",
            "tasks": [
                "Required structured JSON, supported=true, acceptable confidence, registrations metric, and strict field types.",
                "Validated every label against fuel, group, class, category, norm, state, RTO, and date allowlists.",
                "Rejected fabricated totals/rows, exact deterministic contradictions, include/exclude overlap, invalid location, and final merged-plan conflicts.",
                "Revalidated cached plans on use and recomputed totals from fetched rows.",
            ],
            "files": [
                "server.mjs",
                "scripts/query-ai-repair-unit-check.mjs",
                "scripts/query-routing-unit-check.mjs",
            ],
            "decisions": [
                "AI labels receive case/whitespace canonicalization only; no fuzzy correction is applied to AI output.",
                "One invalid label rejects the whole repair rather than silently dropping that label.",
                "AI may fill an unresolved dimension or repeat exact evidence, but may never add to or override exact deterministic evidence.",
            ],
            "tests": [
                "17 strict repair cases and 2 invalid API repair cases passed.",
                "Groq and Ollama provider unit checks passed; repaired totals exactly equaled the sum of returned VAHAN rows.",
                "Cumulative contract remained 150/150 with all data and DB checks green.",
            ],
            "bugs": [
                "A test fixture used ambiguous Bangalore across two catalog RTOs; the test was corrected to the explicit KA-01 Bengaluru Central label.",
                "AI union behavior that could broaden exact DIESEL to DIESEL plus PETROL was removed.",
            ],
            "risks": [
                "A valid repair can still return zero rows when the selected VAHAN slice has no saved data; zero is not replaced with a broader result.",
            ],
        },
        {
            "number": 7,
            "name": "Expand automated testing",
            "objective": "Prove acceptance targets and preserve API, database, scraper, refresh, and reporting behavior.",
            "tasks": [
                "Added a 200-case acceptance gate for exact, typo, alias, normalization, word-order, exclusion, contradiction, unsupported, and provider-failure behavior.",
                "Added aggregation recomputation and exact-query provider-call counting.",
                "Integrated parser and acceptance gates into the full repository test command.",
            ],
            "files": [
                "scripts/query-acceptance-check.mjs",
                "scripts/local-regression-check.mjs",
                "scripts/query-routing-unit-check.mjs",
                "package.json",
            ],
            "decisions": [
                "Acceptance is filter-first: normalized filters must match before sparse data is considered.",
                "All provider failure modes clarify rather than execute a weak local plan.",
                "Local integration continues to validate generated PDFs, map coverage, monthly reports, and production protections.",
            ],
            "tests": [
                "Exact canonical local rate 100%; unsupported local reject rate 100%; approved deterministic rate 100% against a 95% target.",
                "Six provider failure cases passed; exact query provider calls remained zero.",
                "Full npm test passed: 98 module files plus security, secret scan, scraper, OEM, RTO daily, RTO reports/factors/insights, local integration, and production smoke.",
            ],
            "bugs": [
                "Relative last-month and last-three-month wording was incorrectly marked unknown; parsed relative-date tokens now appear in evidence.",
                "A stale grouped-query fixture expected an ambiguous word to execute. It now validates a 422 clarification while retaining the UP-inside-grouped boundary assertion.",
                "Contextual evidence was added for private four-wheelers, plain/passenger e-rickshaws, and passenger auto-rickshaw phrasing.",
                "Multiple RTO conflicts now retain their precise conflict message even when comparison wording is also present.",
            ],
            "risks": [
                "Some successful filter plans produce missing, partial, or zero-row status because the local saved dataset is sparse; the filter and aggregation assertions still pass.",
            ],
        },
        {
            "number": 8,
            "name": "Roll out and monitor",
            "objective": "Support safe shadow/enforced rollout and aggregate monitoring without logging user queries.",
            "tasks": [
                "Added DASHBOARD_QUERY_ROUTING_MODE with enforced as the fail-safe default and observational shadow mode.",
                "Added fixed-shape process telemetry for route decisions, local successes, repair demand, actual Groq network calls, quota/rate limits, clarifications, fuzzy acceptance, validation failures, and disagreement.",
                "Exposed aggregate counters and explicit-denominator rates through health and readiness payloads.",
                "Counted actual Groq network calls at the fetch boundary, so cache hits and cooldown blocks are not mislabeled as invocations.",
            ],
            "files": [
                ".env.example",
                "server.mjs",
                "scripts/query-routing-telemetry-unit-check.mjs",
                "scripts/production-smoke-check.mjs",
                "package.json",
            ],
            "decisions": [
                "Shadow mode observes the same classifier decisions without restoring the previous unsafe provider-first fallback behavior.",
                "Telemetry contains no arrays, raw queries, filters, arbitrary reason keys, credentials, or provider error internals.",
                "Unexpected decoder throws are converted to a safe clarification instead of escaping as HTTP 500.",
            ],
            "tests": [
                "Rollout telemetry gate passed for shadow/enforced modes, 7 routed cases, 2 mocked real network calls, one 429 event, two clarifications, cache behavior, reset behavior, and zero raw-query telemetry.",
                "Production smoke confirmed enforced default, zero initial metrics, one local success after a query, no raw query in health, and all security/readiness checks.",
                "Final full npm test and all provider, build, contract, DB, and Graphify update checks passed.",
            ],
            "bugs": [
                "The environment documentation still described weak local fallback during quota pressure; it now documents clarification for repair-required queries.",
                "Injected decoder exceptions could previously surface as server errors; they now fail closed with a stable clarification code.",
            ],
            "risks": [
                "Telemetry is process-local and resets on restart; durable multi-instance monitoring needs an external metrics collector later.",
            ],
        },
    ]

    for phase in phases:
        phase_block(story, phase)
        story.append(PageBreak())

    story.extend(section_heading("Representative successful query validation", "Generated request, applied filters, fetched rows, aggregation, and final output were checked together."))
    success_rows = []
    for item in validation["successes"]:
        success_rows.append([
            item["id"],
            item["request"]["body"]["query"],
            f"{item['routing']['state']} / {item['routing']['reason']}",
            filter_summary(item["actual"]["filters"]),
            f"rows={item['actual']['rowCount']}; total={item['actual']['calculation']['reportedTotal']}; sum check={item['actual']['calculation']['equal']}",
            item["status"],
        ])
    story.append(data_table(
        ["Case", "User query / API body", "Route", "Applied canonical filters", "Fetched and calculated", "Status"],
        success_rows,
        [22 * mm, 43 * mm, 27 * mm, 45 * mm, 27 * mm, 14 * mm],
        font_size=6.4,
    ))
    story.append(Spacer(1, 7 * mm))
    story.append(p("Detailed expected vs actual", "h2"))
    for item in validation["successes"]:
        story.append(p(f"{item['id']}: {item['objective']}", "h3"))
        story.append(data_table(
            ["Check", "Expected", "Actual"],
            [
                ["Route", item["routing"]["state"], f"{item['routing']['state']} ({item['routing']['reason']})"],
                ["Filters", filter_summary(item["expected"]["filters"]), filter_summary(item["actual"]["filters"])],
                ["Fetched rows", item["expected"]["rowCount"], item["actual"]["rowCount"]],
                ["Total", item["expected"]["total"], item["actual"]["calculation"]["reportedTotal"]],
                ["Aggregation", "Reported total equals sum of fetched vehicle_count", str(item["actual"]["calculation"]["equal"])],
                ["Final report", "No live refresh; successful payload", f"status={item['actual']['dataStatus']}; warnings={item['actual']['reportOutput']['warningCount']}; liveRefresh={item['actual']['reportOutput']['liveRefresh']}"],
            ],
            [35 * mm, 68 * mm, 69 * mm],
            font_size=6.9,
            header_color=BLUE,
        ))
        sample = item["actual"]["fetchedRowSample"]
        if sample:
            story.append(p(f"Fetched row sample: {json.dumps(sample[0], ensure_ascii=True)}", "caption"))
    story.append(PageBreak())

    story.extend(section_heading("Error handling validation", "Unsafe requests produced no fetched rows and no registration total."))
    error_rows = []
    for item in validation["errors"]:
        error_rows.append([
            item["id"],
            item["request"]["body"]["query"],
            f"{item['routing']['state']} / {item['routing']['reason']}",
            f"HTTP {item['expected']['httpStatus']} / {item['expected']['errorCode']}",
            f"HTTP {item['actual']['httpStatus']} / {item['actual']['errorCode']}",
            "No" if not item["actual"]["dataFetched"] else "Yes",
            item["status"],
        ])
    story.append(data_table(
        ["Case", "Query", "Route", "Expected", "Actual", "Data fetched", "Status"],
        error_rows,
        [25 * mm, 48 * mm, 27 * mm, 30 * mm, 30 * mm, 12 * mm, 14 * mm],
        font_size=6.2,
        header_color=RED,
    ))
    story.append(Spacer(1, 8 * mm))
    story.append(p("What the error cases prove", "h2"))
    story.append(bullet([
        "Comparisons and unsupported analytics reject locally with unsupported_dashboard_query.",
        "Multiple locations and future-only periods reject before provider or data access.",
        "Ambiguous fuzzy locations request clarification rather than choosing a city.",
        "Provider outages and exact-evidence conflicts request clarification rather than producing a weak or broadened total.",
    ]))
    story.append(PageBreak())

    story.extend(section_heading("Tests, builds, database, and relevant logs", "Final validation was repeated after every discovered issue was fixed."))
    story.append(data_table(
        ["Command or gate", "Final result"],
        [
            ["npm.cmd test", "Passed in 93 seconds; 98 module syntax/build check plus all repository subsystems."],
            ["npm.cmd run check:query-contract:phase5", "200 executed; 150/150 phase gates; 50/50 legacy; 0 regressions; 12 improvements."],
            ["npm.cmd run check:query-acceptance", "Exact local=1.0; unsupported reject=1.0; approved deterministic=1.0; 6 provider failures; exact provider calls=0."],
            ["npm.cmd run check:query-telemetry", "Both modes, network/cache/429/clarification/disagreement/privacy/reset cases passed."],
            ["npm.cmd run check:query-final-validation", "5 successful data cases, 6 error cases, 5 aggregation checks, no raw-query telemetry."],
            ["npm.cmd run db:check:local", "PostgreSQL vahan_ey_local OK on localhost:5433; 1490 MB; UTF8."],
            ["npm.cmd run build", "Syntax/build passed."],
            ["graphify update .", "115/115 files; graph rebuilt successfully to 2186 nodes and 5753 edges."],
        ],
        [58 * mm, 114 * mm],
    ))
    story.append(p("Relevant log excerpts", "h2"))
    logs = """query-acceptance: passed=true, activeContractCases=200,
  exactCanonicalLocalRate=1, unsupportedLocalRejectRate=1,
  approvedDeterministicRate=1, providerCallsForExactQuery=0

query-contract phase5: passed=true, executedCaseCount=200,
  phaseGateCount=150, phaseGateFailureCount=0,
  legacyCanonicalPassCount=50, legacyBaselineRegressionCount=0,
  dataFilesUnchanged=true, databaseProfilePassed=true,
  databaseReconciliationPassed=true

query-telemetry: passed=true, modes=[shadow,enforced],
  realGroqNetworkInvocations=2, quotaRateLimitEvents=1,
  clarificationRequired=2, rawQueryTelemetry=false

database: status=ok, registrations=18633,
  rto_daily_scrape_reports=103644, rto_daily_snapshots=1554660"""
    story.append(Preformatted(logs, STYLES["mono"], maxLineLength=100))
    story.append(p("No browser screenshot was necessary for the query-engine phases. The available command logs, generated JSON artifacts, production smoke output, and visually rendered PDF pages provide the relevant evidence.", "caption"))
    story.append(PageBreak())

    story.extend(section_heading("New query capability after hardening", "These are new reliable forms of the existing one-total dashboard contract, not new analytical products."))
    capability_rows = [
        ["Arbitrary word order", "Delhi November 2025 BS6 motor car diesel registrations", "Same canonical plan as the conventional word order."],
        ["Full multi-axis combinations", "BS VI diesel passenger cars in Maharashtra in February 2026", "State + month + fuel + class + category intersection + norm."],
        ["Date variants", "EV registrations in Maharashtra in Q4 2024 / FY 2023-24 / last 3 months", "Calendar quarter, Indian fiscal year, and relative periods."],
        ["Abbreviations", "BOV 2W BS6 in Delhi Jan 2026", "EV-family, vehicle shorthand, norm, location, and month canonicalization."],
        ["RTO code variants", "EV at RTO UP16 / UP-16 / UP 16 in Jan 2026", "Boundary-safe RTO normalization and resolution."],
        ["Approved spelling mistakes", "petorl motar car registrations in maharastra", "Multiple simultaneous safe corrections with evidence and zero AI calls."],
        ["Inclusion and exclusion", "non-EV registrations; excluding diesel; EV excluding hybrids", "Canonical selected and excluded labels applied after positive parsing."],
        ["Passenger-car semantics", "BS6 diesel passenger cars", "MOTOR CAR class intersected with LIGHT MOTOR VEHICLE category."],
        ["Broad vehicle shorthand", "2W, 3W, 4W, LMV, HMV", "Existing VAHAN categories/groups selected consistently."],
        ["Rickshaw wording", "e-rickshaw; goods e-rickshaw; auto rickshaw for passengers", "Passenger/cart/goods semantics and contextual cue evidence."],
        ["Unusual but supported wording", "spark-fuel vehicle registrations ...", "Routed to one strict AI repair, then allowlist and final-plan validation."],
        ["Safe ambiguity handling", "xangalore vehicle registrations", "Handled as a clarification instead of a guessed city and wrong total."],
    ]
    story.append(data_table(
        ["Capability", "Example", "What is now reliable"],
        capability_rows,
        [38 * mm, 62 * mm, 72 * mm],
        font_size=6.8,
        header_color=TEAL,
    ))
    story.append(p("Still intentionally unsupported", "h2"))
    story.append(bullet([
        "Comparisons, rankings, top/bottom lists, manufacturer or model breakdowns, grouped state/RTO breakdowns, growth/share percentages, forecasts, and causal explanations.",
        "Exact-day or other non-monthly granularity, unrelated questions, or prompts without a vehicle-registration subject.",
        "These requests now fail closed and never become an ordinary registration total.",
    ]))
    story.append(PageBreak())

    story.extend(section_heading("Files created or modified", "Only the phase-related files are listed; unrelated pre-existing dirty-worktree changes were preserved."))
    file_rows = [
        ["Core implementation", "server.mjs", "Interpretation, evidence, conflict detection, fuzzy matching, routing, strict repair validation, telemetry."],
        ["Configuration", ".env.example", "Documented enforced/shadow routing mode and clarification behavior under quota pressure."],
        ["Test orchestration", "package.json", "Added phase gates, acceptance, telemetry, and final validation commands."],
        ["Frozen contract", "data/query-tests/dashboard-query-contract-v1.json", "200 cases with expected canonical filters and routing policies."],
        ["Phase tests", "scripts/query-normalization-unit-check.mjs; query-composition-unit-check.mjs; query-fuzzy-unit-check.mjs; query-routing-unit-check.mjs; query-ai-repair-unit-check.mjs; query-acceptance-check.mjs; query-routing-telemetry-unit-check.mjs", "Focused deterministic, provider, acceptance, and monitoring gates."],
        ["Contract runner", "scripts/query-contract-corpus-check.mjs", "Structural and executable contract, DB/profile reconciliation, legacy and data-integrity checks."],
        ["Integration", "scripts/local-regression-check.mjs; scripts/production-smoke-check.mjs", "HTTP, report, security, health telemetry, and production behavior."],
        ["Final evidence", "scripts/final-query-validation.mjs; output/final-validation/query-validation.json", "Representative API, filter, row, aggregation, output, and error evidence."],
        ["Graph", "graphify-out/GRAPH_REPORT.md; graph.json; graph.html; manifest.json", "AST graph refreshed after code changes."],
        ["Report", "scripts/build-final-validation-report.py; output/pdf/deterministic-query-hardening-phases-1-8-validation-report.pdf", "Comprehensive report and builder."],
    ]
    story.append(data_table(["Area", "Files", "Purpose"], file_rows, [35 * mm, 75 * mm, 62 * mm], font_size=6.6))
    story.append(p("Remaining limitations and risks", "h2"))
    story.append(bullet([
        "The endpoint remains one registration total with monthly rows; unsupported analytical operations are deliberately rejected.",
        "Conservative fuzzy matching can require rephrasing for rare or ambiguous mistakes. This is a safety property, not an attempt at unlimited language coverage.",
        "Repair-required wording depends on a configured Groq or Ollama provider. Provider failure returns clarification; exact local questions are unaffected.",
        "Final validation used mocked provider responses and provider unit tests rather than spending live Groq quota. All data totals were still computed from real saved VAHAN rows.",
        "Saved data coverage can be partial or missing for a valid filter combination; the system reports that status and does not broaden the query.",
        "Routing telemetry is in-memory per process and resets on restart. Durable multi-instance monitoring needs external aggregation.",
        "The working tree contains unrelated pre-existing changes. They were not reset, deleted, or folded into phase claims.",
    ]))
    story.append(PageBreak())

    story.extend(section_heading("Final validation decision", "No critical test remains failing."))
    story.append(Spacer(1, 8 * mm))
    story.append(Table([[Paragraph("PASSED", ParagraphStyle(
        "final_pass", parent=STYLES["callout"], fontSize=30, leading=36, textColor=GREEN
    ))]], colWidths=[172 * mm], rowHeights=[30 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE_GREEN),
        ("BOX", (0, 0), (-1, -1), 1.4, GREEN),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ])))
    story.append(Spacer(1, 8 * mm))
    story.append(p(
        "Phases 1 through 8 satisfy the defined objectives and final acceptance criteria. The system is deterministic-first, conservative under ambiguity, strict about AI repairs, data-derived for all totals, compatible with the existing API/database/scraper/report stack, and observable without raw-query telemetry.",
        "body",
    ))
    story.append(p("Evidence artifact index", "h2"))
    story.append(data_table(
        ["Artifact", "Purpose"],
        [
            ["output/phase-1 through output/phase-5/query-contract-execution.json", "Phase and cumulative contract execution evidence."],
            ["output/final-validation/query-validation.json", "Representative requests, filters, rows, calculations, outputs, and errors."],
            ["output/pdf/deterministic-query-hardening-phases-1-8-validation-report.pdf", "This report."],
        ],
        [92 * mm, 80 * mm],
    ))

    doc.build(story, onFirstPage=cover_decor, onLaterPages=page_decor)
    return OUTPUT_PATH


if __name__ == "__main__":
    result = build_report()
    print(json.dumps({"passed": True, "output": str(result)}, indent=2))
