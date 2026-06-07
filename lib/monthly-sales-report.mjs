const ALL_RTO = "All Vahan4 Running Office";
const ALL_FILTER = "ALL";

const BATTERY_ELECTRIC_FUELS = new Set(["ELECTRIC(BOV)", "PURE EV", "ELECTRIC"]);
const HYBRID_FUELS = new Set([
  "DIESEL/HYBRID",
  "PETROL/HYBRID",
  "PETROL/HYBRID/CNG",
  "PETROL(E20)/HYBRID",
  "PETROL(E20)/HYBRID/CNG",
  "PLUG-IN HYBRID EV",
  "STRONG HYBRID EV",
]);

const FAMILY_MATCHERS = {
  EV: (row) => row.fuel_segment === "EV" || BATTERY_ELECTRIC_FUELS.has(normalizeLabel(row.fuel_type)),
  NON_EV: (row) => row.fuel_segment === "NON_EV" && !HYBRID_FUELS.has(normalizeLabel(row.fuel_type)),
  HYBRID: (row) => HYBRID_FUELS.has(normalizeLabel(row.fuel_type)) || normalizeLabel(row.fuel_type).includes("HYBRID"),
  PETROL: (row) => normalizeLabel(row.fuel_type).startsWith("PETROL"),
  DIESEL: (row) => normalizeLabel(row.fuel_type).includes("DIESEL"),
  CNG: (row) => normalizeLabel(row.fuel_type).includes("CNG"),
  LPG: (row) => normalizeLabel(row.fuel_type).includes("LPG"),
  HYDROGEN: (row) => normalizeLabel(row.fuel_type).includes("HYDROGEN"),
};

const SEGMENT_DEFINITIONS = [
  {
    id: "two_wheeler",
    title: "2W sales",
    vehicle_category_filter: contextValue(["TWO WHEELER(NT)", "TWO WHEELER(T)"]),
  },
  {
    id: "three_wheeler",
    title: "3W sales",
    vehicle_category_filter: contextValue(["THREE WHEELER(NT)", "THREE WHEELER(T)"]),
  },
  {
    id: "three_wheeler_passenger",
    title: "3W passenger sales",
    vehicle_class_filter: contextValue(["THREE WHEELER (PASSENGER)"]),
  },
  {
    id: "three_wheeler_goods",
    title: "3W goods sales",
    vehicle_class_filter: contextValue(["THREE WHEELER (GOODS)"]),
  },
  {
    id: "rickshaw",
    title: "Rickshaw passenger sales",
    vehicle_class_filter: contextValue(["E-RICKSHAW(P)"]),
  },
  {
    id: "cart",
    title: "Cart goods sales",
    vehicle_class_filter: contextValue(["E-RICKSHAW WITH CART (G)"]),
  },
  {
    id: "four_wheeler_private",
    title: "4W passenger car/cab sales",
    vehicle_class_filter: contextValue(["ADAPTED VEHICLE", "MOTOR CAR", "MOTOR CARAVAN", "OMNI BUS (PRIVATE USE)", "VINTAGE MOTOR VEHICLE"]),
  },
  {
    id: "bus",
    title: "Bus sales",
    vehicle_class_filter: contextValue(["BUS", "EDUCATIONAL INSTITUTION BUS", "OMNI BUS", "SCHOOL BUS"]),
  },
  {
    id: "goods_carrier",
    title: "Goods carrier sales",
    vehicle_class_filter: contextValue(["GOODS CARRIER"]),
  },
  {
    id: "light_motor_vehicle",
    title: "Light motor vehicle sales",
    vehicle_category_filter: contextValue(["LIGHT MOTOR VEHICLE"]),
  },
];

export function buildMonthlySalesReport({
  rows,
  makerRows = [],
  month = null,
  fuelScope = "all",
  fuel = null,
  sourceLabel = "VAHAN public dashboard aggregate data",
  generatedAt = new Date(),
} = {}) {
  const normalizedRows = (rows ?? []).filter((row) => Number.isFinite(Number(row.vehicle_count)));
  const baseRows = normalizedRows.filter(isBaseMarketRow);
  const reportMonth = validMonthKey(month) ? month : latestMonth(baseRows.length ? baseRows : normalizedRows);
  if (!reportMonth) {
    const error = new Error("No registration rows are available to build a monthly report.");
    error.statusCode = 404;
    throw error;
  }

  const fuelSelection = normalizeFuelSelection(fuelScope, fuel);
  const previousMonth = shiftMonth(reportMonth, -1);
  const months = monthWindow(reportMonth, 12);
  const currentRows = baseRows.filter((row) => rowMonth(row) === reportMonth && matchesFuelSelection(row, fuelSelection));
  const previousRows = baseRows.filter((row) => rowMonth(row) === previousMonth && matchesFuelSelection(row, fuelSelection));
  const allCurrentRows = baseRows.filter((row) => rowMonth(row) === reportMonth);
  const total = sumRows(currentRows);
  const previousTotal = sumRows(previousRows);
  const trend = months.map((item) => ({
    month: item,
    count: sumRows(baseRows.filter((row) => rowMonth(row) === item && matchesFuelSelection(row, fuelSelection))),
  }));
  const currentFuelMix = fuelMix(currentRows);
  const allFuelMix = fuelMix(allCurrentRows);
  const categorySales = SEGMENT_DEFINITIONS.map((segment) =>
    segmentSummary(normalizedRows, segment, fuelSelection, reportMonth, previousMonth, months),
  );
  const usableCategorySales = categorySales.filter((item) => item.status !== "missing");
  const shareTrend = fuelSelection.scope === "all"
    ? fuelMixShareTrend(baseRows, allFuelMix.slice(0, 5).map((item) => item.fuelType), months)
    : segmentShareTrend(categorySales);
  const oemSection = oemLeaderboard(makerRows, fuelSelection, reportMonth);
  const peak = trend.reduce((best, item) => item.count > (best?.count ?? -1) ? item : best, null);
  const low = trend.reduce((best, item) => item.count < (best?.count ?? Infinity) ? item : best, null);
  const scopeLabel = describeFuelSelection(fuelSelection);
  const states = uniqueSorted(baseRows.filter((row) => rowMonth(row) === reportMonth).map((row) => row.state));
  const latestLoadedMonth = latestMonth(baseRows.length ? baseRows : normalizedRows);

  return {
    title: `${scopeLabel} vehicle sales trend | ${displayMonth(reportMonth)}`,
    kind: "monthly-sales",
    period: {
      month: reportMonth,
      previousMonth,
      trendFrom: months[0],
      trendTo: months[months.length - 1],
    },
    fuelSelection,
    source: {
      label: sourceLabel,
      latestLoadedMonth,
      generatedAt: new Date(generatedAt).toISOString(),
    },
    coverage: {
      baseRows: baseRows.length,
      currentBaseRows: allCurrentRows.length,
      currentScopeRows: currentRows.length,
      states: states.length,
      stateNames: states,
      categorySectionsAvailable: usableCategorySales.length,
      categorySectionsTotal: categorySales.length,
      makerRows: oemSection.rowCount,
    },
    sections: [
      {
        id: "overview",
        title: `${scopeLabel} registrations, ${displayMonth(reportMonth)}`,
        chartType: "metric",
        metrics: {
          total,
          previousTotal,
          delta: total - previousTotal,
          percentChange: percentChange(total, previousTotal),
          marketShare: share(total, sumRows(allCurrentRows)),
          states: states.length,
        },
        narrative: overviewNarrative(scopeLabel, reportMonth, total, previousTotal, states.length),
      },
      {
        id: "fuel_mix",
        title: fuelSelection.scope === "all" ? "Fuel-wise sales mix" : `${scopeLabel} fuel labels`,
        chartType: "bar",
        chartData: currentFuelMix,
        allFuelMix,
        narrative: fuelMixNarrative(currentFuelMix, total, fuelSelection),
      },
      {
        id: "category_sales",
        title: "Category-wise sales",
        chartType: "bar",
        chartData: categorySales,
        narrative: categoryNarrative(usableCategorySales, scopeLabel),
        warnings: categorySales
          .filter((item) => item.status === "missing")
          .map((item) => `${item.title} has no saved segment-filter rows for ${displayMonth(reportMonth)}.`),
      },
      {
        id: "twelve_month_trend",
        title: `${scopeLabel} 12-month trend`,
        chartType: "line",
        chartData: trend,
        metrics: {
          total: sumRowsForTrend(trend),
          peakMonth: peak?.month ?? null,
          peakMonthCount: peak?.count ?? 0,
          lowMonth: low?.month ?? null,
          lowMonthCount: low?.count ?? 0,
        },
        narrative: trendNarrative(scopeLabel, trend, peak, low),
      },
      {
        id: "share_trend",
        title: fuelSelection.scope === "all" ? "Fuel share trend" : `${scopeLabel} penetration by segment`,
        chartType: fuelSelection.scope === "all" ? "multi-line" : "bar",
        chartData: shareTrend,
        narrative: shareTrendNarrative(shareTrend, fuelSelection),
      },
      {
        id: "oem_leaders",
        title: "OEM / maker leaders",
        chartType: "bar",
        chartData: oemSection.leaders,
        metrics: {
          rowCount: oemSection.rowCount,
          total: oemSection.total,
        },
        narrative: oemNarrative(oemSection, scopeLabel),
        warnings: oemSection.warnings,
      },
    ],
    dataNotes: dataNotes({ latestLoadedMonth, reportMonth, states, categorySales, oemSection }),
  };
}

export function renderMonthlySalesReportHtml(report, { includeShell = true } = {}) {
  const sections = report.sections.map(renderSection).join("\n");
  const notes = report.dataNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  const fuelScope = encodeURIComponent(report.fuelSelection.scope);
  const fuel = encodeURIComponent(report.fuelSelection.fuel ?? "");
  const month = encodeURIComponent(report.period.month);
  const pdfHref = `/api/reports/monthly-sales/pdf?month=${month}&fuelScope=${fuelScope}${fuel ? `&fuel=${fuel}` : ""}`;
  const body = `
    <main class="report-document">
      <header class="report-hero">
        <div>
          <p class="report-kicker">VAHAN monthly sales report</p>
          <h1>${escapeHtml(report.title)}</h1>
          <p>${escapeHtml(report.source.label)}. Generated ${escapeHtml(displayDateTime(report.source.generatedAt))}.</p>
        </div>
        <a class="report-pdf-link" href="${pdfHref}">Export PDF</a>
      </header>
      <section class="report-meta-grid">
        <article><span>Month</span><strong>${escapeHtml(displayMonth(report.period.month))}</strong></article>
        <article><span>Fuel scope</span><strong>${escapeHtml(describeFuelSelection(report.fuelSelection))}</strong></article>
        <article><span>States loaded</span><strong>${formatNumber(report.coverage.states)}</strong></article>
        <article><span>Latest data</span><strong>${escapeHtml(report.source.latestLoadedMonth ?? "NA")}</strong></article>
      </section>
      ${sections}
      <section class="report-section report-notes">
        <h2>Data Notes</h2>
        <ul>${notes}</ul>
      </section>
    </main>
  `;
  if (!includeShell) return body;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(report.title)}</title>
    <style>${reportPrintCss()}</style>
  </head>
  <body>${body}</body>
</html>`;
}

function renderSection(section) {
  const warnings = section.warnings?.length
    ? `<div class="report-warning">${section.warnings.map(escapeHtml).join("<br>")}</div>`
    : "";
  return `
    <section class="report-section">
      <div class="report-section-head">
        <h2>${escapeHtml(section.title)}</h2>
        <p>${escapeHtml(section.narrative ?? "")}</p>
      </div>
      ${renderChart(section)}
      ${warnings}
    </section>
  `;
}

function renderChart(section) {
  if (section.chartType === "metric") {
    const metrics = section.metrics ?? {};
    return `
      <div class="report-metric-grid">
        <article><span>Total</span><strong>${formatNumber(metrics.total)}</strong></article>
        <article><span>Previous month</span><strong>${formatNumber(metrics.previousTotal)}</strong></article>
        <article><span>Change</span><strong>${formatDelta(metrics.delta)}</strong></article>
        <article><span>Market share</span><strong>${formatPercent(metrics.marketShare)}</strong></article>
      </div>
    `;
  }
  const data = section.chartData ?? [];
  if (!data.length) return `<p class="report-empty">No data available for this section.</p>`;
  if (section.id === "share_trend" && Array.isArray(data[0]?.trend)) {
    return `
      <div class="report-table-wrap">
        <table>
          <thead><tr><th>Label</th><th>Current share</th><th>Current count</th></tr></thead>
          <tbody>${data.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${formatPercent(item.currentShare)}</td><td>${formatNumber(item.currentCount)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    `;
  }
  const max = Math.max(1, ...data.map((item) => Number(item.count ?? item.currentCount ?? 0)));
  return `
    <div class="report-bars">
      ${data.slice(0, 12).map((item) => {
        const label = item.fuelType ?? item.title ?? item.month ?? item.maker ?? item.label ?? "Item";
        const count = Number(item.count ?? item.currentCount ?? 0);
        return `
          <div class="report-bar">
            <span>${escapeHtml(label)}</span>
            <i><b style="width:${Math.max(2, (count / max) * 100)}%"></b></i>
            <strong>${formatNumber(count)}</strong>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function segmentSummary(rows, segment, fuelSelection, currentMonth, previousMonth, months) {
  const segmentRows = rows.filter((row) => isAggregateRtoRow(row) && matchesSegmentContext(row, segment));
  const currentRows = segmentRows.filter((row) => rowMonth(row) === currentMonth);
  const previousRows = segmentRows.filter((row) => rowMonth(row) === previousMonth);
  const currentScopeRows = currentRows.filter((row) => matchesFuelSelection(row, fuelSelection));
  const previousScopeRows = previousRows.filter((row) => matchesFuelSelection(row, fuelSelection));
  const currentCount = sumRows(currentScopeRows);
  const previousCount = sumRows(previousScopeRows);
  const currentAllCount = sumRows(currentRows);
  return {
    id: segment.id,
    title: segment.title,
    count: currentCount,
    currentCount,
    previousCount,
    delta: currentCount - previousCount,
    percentChange: percentChange(currentCount, previousCount),
    share: share(currentCount, currentAllCount),
    rowCount: currentRows.length,
    stateCount: uniqueSorted(currentRows.map((row) => row.state)).length,
    status: currentRows.length ? "available" : "missing",
    trend: months.map((month) => {
      const allRows = segmentRows.filter((row) => rowMonth(row) === month);
      const scopeRows = allRows.filter((row) => matchesFuelSelection(row, fuelSelection));
      return {
        month,
        count: sumRows(scopeRows),
        share: share(sumRows(scopeRows), sumRows(allRows)),
      };
    }),
  };
}

function fuelMix(rows) {
  const total = sumRows(rows);
  const byFuel = new Map();
  for (const row of rows) {
    byFuel.set(row.fuel_type, (byFuel.get(row.fuel_type) ?? 0) + Number(row.vehicle_count || 0));
  }
  return [...byFuel.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([fuelType, count]) => ({ fuelType, count, share: share(count, total) }));
}

function fuelMixShareTrend(rows, fuelTypes, months) {
  return fuelTypes.map((fuelType) => {
    const trend = months.map((month) => {
      const monthRows = rows.filter((row) => rowMonth(row) === month);
      const count = sumRows(monthRows.filter((row) => row.fuel_type === fuelType));
      return { month, count, share: share(count, sumRows(monthRows)) };
    });
    const current = trend[trend.length - 1] ?? {};
    return {
      label: fuelType,
      currentShare: current.share ?? null,
      currentCount: current.count ?? 0,
      trend,
    };
  });
}

function segmentShareTrend(categorySales) {
  return categorySales
    .filter((item) => item.status !== "missing")
    .map((item) => ({
      label: item.title,
      currentShare: item.share,
      currentCount: item.currentCount,
      trend: item.trend,
    }))
    .sort((a, b) => (b.currentShare ?? -1) - (a.currentShare ?? -1) || b.currentCount - a.currentCount)
    .slice(0, 8);
}

function oemLeaderboard(makerRows, fuelSelection, month) {
  const normalizedRows = (makerRows ?? [])
    .filter((row) => rowMonth(row) === month)
    .filter((row) => isAggregateRtoRow(row))
    .filter((row) => matchesMakerFuelSelection(row, fuelSelection));
  const byMaker = new Map();
  for (const row of normalizedRows) {
    if (!row.maker) continue;
    byMaker.set(row.maker, (byMaker.get(row.maker) ?? 0) + Number(row.vehicle_count || 0));
  }
  const total = [...byMaker.values()].reduce((sum, value) => sum + value, 0);
  const leaders = [...byMaker.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([maker, count]) => ({ maker, count, share: share(count, total) }));
  return {
    rowCount: normalizedRows.length,
    total,
    leaders,
    warnings: leaders.length
      ? []
      : ["No matching maker/OEM rows are saved yet for this month and fuel scope. The report leaves this section partial instead of inventing values."],
  };
}

function matchesFuelSelection(row, selection) {
  if (selection.scope === "all") return true;
  const normalizedFuel = normalizeLabel(selection.fuel);
  if (selection.scope === "exact") return normalizeLabel(row.fuel_type) === normalizedFuel;
  const matcher = FAMILY_MATCHERS[normalizedFuel];
  return matcher ? matcher(row) : normalizeLabel(row.fuel_type).includes(normalizedFuel);
}

function matchesMakerFuelSelection(row, selection) {
  if (selection.scope === "all") return true;
  const fuelFilter = normalizeLabel(row.fuel_filter);
  if (!fuelFilter || fuelFilter === ALL_FILTER) return false;
  if (selection.scope === "exact") return fuelFilter === normalizeLabel(selection.fuel);
  const matcher = FAMILY_MATCHERS[normalizeLabel(selection.fuel)];
  if (!matcher) return fuelFilter.includes(normalizeLabel(selection.fuel));
  return matcher({ fuel_type: fuelFilter, fuel_segment: BATTERY_ELECTRIC_FUELS.has(fuelFilter) ? "EV" : "NON_EV" });
}

function normalizeFuelSelection(scope, fuel) {
  const normalizedScope = ["all", "segment", "exact"].includes(String(scope ?? "").toLowerCase())
    ? String(scope).toLowerCase()
    : "all";
  const normalizedFuel = fuel ? normalizeReportFuel(fuel) : null;
  if (normalizedScope === "all") return { scope: "all", fuel: null };
  if (!normalizedFuel) return { scope: "all", fuel: null };
  return { scope: normalizedScope, fuel: normalizedFuel };
}

function normalizeReportFuel(value) {
  const normalized = normalizeLabel(value);
  if (normalized === "ELECTRIC") return "PURE EV";
  if (normalized === "CNG") return "CNG";
  if (normalized === "LPG") return "LPG";
  return normalized;
}

function describeFuelSelection(selection) {
  if (selection.scope === "all") return "All-fuel";
  if (selection.scope === "segment") return `${selection.fuel} segment`;
  return selection.fuel;
}

function matchesSegmentContext(row, segment) {
  return String(row.fuel_filter ?? ALL_FILTER) === ALL_FILTER &&
    String(row.vehicle_category_filter ?? ALL_FILTER) === (segment.vehicle_category_filter ?? ALL_FILTER) &&
    String(row.norms_filter ?? ALL_FILTER) === (segment.norms_filter ?? ALL_FILTER) &&
    String(row.vehicle_class_filter ?? ALL_FILTER) === (segment.vehicle_class_filter ?? ALL_FILTER);
}

function isBaseMarketRow(row) {
  return isAggregateRtoRow(row) &&
    String(row.fuel_filter ?? ALL_FILTER) === ALL_FILTER &&
    String(row.vehicle_category_filter ?? ALL_FILTER) === ALL_FILTER &&
    String(row.norms_filter ?? ALL_FILTER) === ALL_FILTER &&
    String(row.vehicle_class_filter ?? ALL_FILTER) === ALL_FILTER;
}

function isAggregateRtoRow(row) {
  return !row.rto || row.rto === ALL_RTO;
}

function contextValue(values) {
  return values.length ? values.map((value) => normalizeLabel(value)).sort().join("|") : ALL_FILTER;
}

function normalizeLabel(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

function rowMonth(row) {
  return `${row.year}-${String(row.month).padStart(2, "0")}`;
}

function latestMonth(rows) {
  return [...new Set((rows ?? []).map(rowMonth))]
    .filter(validMonthKey)
    .sort()
    .at(-1) ?? null;
}

function validMonthKey(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value ?? ""));
}

function shiftMonth(value, offset) {
  const [year, month] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthWindow(endMonth, count) {
  return Array.from({ length: count }, (_, index) => shiftMonth(endMonth, index - count + 1));
}

function sumRows(rows) {
  return rows.reduce((sum, row) => sum + Number(row.vehicle_count || 0), 0);
}

function sumRowsForTrend(trend) {
  return trend.reduce((sum, item) => sum + Number(item.count || 0), 0);
}

function share(part, total) {
  return total > 0 ? part / total : null;
}

function percentChange(current, previous) {
  if (!previous) return current ? null : 0;
  return (current - previous) / previous;
}

function uniqueSorted(values) {
  return [...new Set((values ?? []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function overviewNarrative(scopeLabel, month, total, previousTotal, states) {
  const change = total - previousTotal;
  const direction = change > 0 ? "increased" : change < 0 ? "declined" : "was flat";
  const changeText = previousTotal ? `${formatDelta(change)} (${formatPercent(percentChange(total, previousTotal))})` : "not comparable because previous-month data is unavailable";
  return `${scopeLabel} registrations in ${displayMonth(month)} ${direction} to ${formatNumber(total)} units; month-on-month change was ${changeText}. The current report uses aggregate rows from ${formatNumber(states)} loaded state(s).`;
}

function fuelMixNarrative(items, total, selection) {
  if (!items.length) return "No fuel rows matched this report scope for the selected month.";
  const leader = items[0];
  const label = selection.scope === "all" ? "fuel mix" : "matching fuel labels";
  return `${leader.fuelType} led the ${label} with ${formatNumber(leader.count)} registrations, representing ${formatPercent(leader.share)} of ${formatNumber(total)} matching registrations.`;
}

function categoryNarrative(items, scopeLabel) {
  if (!items.length) return `No configured segment rows are saved for ${scopeLabel}; category sections are marked partial.`;
  const leader = [...items].sort((a, b) => b.currentCount - a.currentCount)[0];
  return `${leader.title} is the largest available segment for ${scopeLabel}, with ${formatNumber(leader.currentCount)} registrations in the selected month.`;
}

function trendNarrative(scopeLabel, trend, peak, low) {
  if (!trend.some((item) => item.count > 0)) return `No 12-month ${scopeLabel} trend rows are available.`;
  return `${scopeLabel} monthly sales peaked in ${displayMonth(peak.month)} at ${formatNumber(peak.count)} registrations and were lowest in ${displayMonth(low.month)} at ${formatNumber(low.count)} registrations.`;
}

function shareTrendNarrative(items, selection) {
  if (!items.length) return "Share trend data is unavailable for the current scope.";
  const leader = items[0];
  if (selection.scope === "all") {
    return `${leader.label} has the highest current fuel share among the tracked fuel labels at ${formatPercent(leader.currentShare)}.`;
  }
  return `${leader.label} has the highest current ${describeFuelSelection(selection)} share among available vehicle segments at ${formatPercent(leader.currentShare)}.`;
}

function oemNarrative(section, scopeLabel) {
  if (!section.leaders.length) return `OEM leaderboards for ${scopeLabel} are partial because no matching maker rows are currently saved.`;
  const leader = section.leaders[0];
  return `${leader.maker} leads the saved OEM data for ${scopeLabel} with ${formatNumber(leader.count)} registrations and ${formatPercent(leader.share)} share among matching maker rows.`;
}

function dataNotes({ latestLoadedMonth, reportMonth, states, categorySales, oemSection }) {
  const missingSegments = categorySales.filter((item) => item.status === "missing").length;
  return [
    `Source: VAHAN aggregate registration rows saved in this system; latest loaded base month is ${latestLoadedMonth ?? "not available"}.`,
    `Report month: ${reportMonth}. State coverage in base rows: ${states.length ? states.join(", ") : "none"}.`,
    missingSegments ? `${missingSegments} configured segment section(s) have no saved side-filter rows for the report month.` : "Configured segment rows are available for all displayed segment sections.",
    oemSection.leaders.length ? "OEM rankings use saved maker rows for the same month and fuel scope." : "OEM rankings are partial until maker rows are scraped or imported for this month and fuel scope.",
    "Counts are registrations, not retail deliveries. The report never fills missing sections with estimated values.",
  ];
}

function displayMonth(value) {
  if (!validMonthKey(value)) return String(value ?? "");
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function displayDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? "") : date.toLocaleString("en-IN");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(Math.round(Number(value) || 0));
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "NA";
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(Number(value) * 100)}%`;
}

function formatDelta(value) {
  const number = Math.round(Number(value) || 0);
  const sign = number > 0 ? "+" : "";
  return `${sign}${formatNumber(number)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function reportPrintCss() {
  return `
    body { margin: 0; color: #172033; font-family: Inter, Arial, sans-serif; background: #f7f9fc; }
    .report-document { max-width: 1120px; margin: 0 auto; padding: 32px; }
    .report-hero { display: flex; justify-content: space-between; gap: 24px; align-items: start; padding: 28px; border-radius: 10px; background: #101828; color: white; }
    .report-hero h1 { margin: 4px 0 8px; font-size: 30px; line-height: 1.1; }
    .report-hero p { margin: 0; color: #cbd5e1; }
    .report-kicker { text-transform: uppercase; letter-spacing: .08em; font-size: 12px; font-weight: 800; color: #67e8f9 !important; }
    .report-pdf-link { padding: 10px 14px; border-radius: 8px; background: #14b8a6; color: #06221f; text-decoration: none; font-weight: 800; white-space: nowrap; }
    .report-meta-grid, .report-metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 18px 0; }
    .report-meta-grid article, .report-metric-grid article { padding: 14px; border: 1px solid #d8e0ea; border-radius: 8px; background: white; }
    .report-meta-grid span, .report-metric-grid span { display: block; color: #667085; font-size: 11px; text-transform: uppercase; font-weight: 800; }
    .report-meta-grid strong, .report-metric-grid strong { display: block; margin-top: 5px; color: #101828; font-size: 20px; }
    .report-section { margin: 18px 0; padding: 20px; border: 1px solid #d8e0ea; border-radius: 8px; background: white; break-inside: avoid; }
    .report-section-head h2 { margin: 0 0 5px; font-size: 20px; }
    .report-section-head p { margin: 0 0 16px; color: #526070; }
    .report-bars { display: grid; gap: 10px; }
    .report-bar { display: grid; grid-template-columns: minmax(160px, 240px) 1fr 110px; gap: 10px; align-items: center; font-size: 13px; }
    .report-bar i { height: 10px; border-radius: 999px; background: #e6edf5; overflow: hidden; }
    .report-bar b { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #14b8a6, #38bdf8); }
    .report-bar strong { text-align: right; }
    .report-warning { margin-top: 14px; padding: 10px 12px; border: 1px solid #facc15; border-radius: 8px; background: #fef9c3; color: #713f12; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #d8e0ea; padding: 8px; text-align: left; }
    th { background: #f1f5f9; }
    .report-empty { color: #667085; }
    .report-notes ul { margin: 0; padding-left: 18px; color: #526070; }
    @media print {
      body { background: white; }
      .report-document { padding: 18mm; }
      .report-pdf-link { display: none; }
    }
  `;
}
