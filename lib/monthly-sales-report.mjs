const ALL_RTO = "All Vahan4 Running Office";
const ALL_FILTER = "ALL";
const ALL_STATES = "All Vahan4 Running States";

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
  EV: (row) => BATTERY_ELECTRIC_FUELS.has(normalizeLabel(row.fuel_type)),
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
    id: "four_wheeler_private",
    title: "4W sales",
    vehicle_category_filter: contextValue(["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"]),
  },
];

const OEM_CATEGORY_DEFINITIONS = [
  {
    ...SEGMENT_DEFINITIONS[0],
    title: "2W OEM registrations",
    brands: [
      { name: "Hero MotoCorp", aliases: ["HERO MOTOCORP", "HERO MOTOCORP LTD", "HERO MOTOCORP LIMITED"] },
      { name: "Honda Motorcycle", aliases: ["HONDA MOTORCYCLE", "HONDA MOTORCYCLE AND SCOOTER", "HONDA MOTORCYCLE AND SCOOTER INDIA", "HONDA MOTORCYCLE & SCOOTER INDIA"] },
      { name: "TVS Motor", aliases: ["TVS MOTOR", "TVS MOTOR COMPANY"] },
      { name: "Bajaj Auto", aliases: ["BAJAJ AUTO", "BAJAJ AUTO LTD", "BAJAJ AUTO LIMITED"] },
      { name: "Suzuki Motorcycle", aliases: ["SUZUKI MOTORCYCLE", "SUZUKI MOTORCYCLE INDIA"] },
    ],
  },
  {
    ...SEGMENT_DEFINITIONS[1],
    title: "3W OEM registrations",
    brands: [
      { name: "Bajaj Auto", aliases: ["BAJAJ AUTO", "BAJAJ AUTO LTD", "BAJAJ AUTO LIMITED"] },
      { name: "Mahindra Last Mile Mobility", aliases: ["MAHINDRA LAST MILE", "MAHINDRA LAST MILE MOBILITY", "MAHINDRA ELECTRIC", "MAHINDRA AND MAHINDRA"] },
      { name: "TVS Motor", aliases: ["TVS MOTOR", "TVS MOTOR COMPANY"] },
      { name: "Piaggio Vehicles", aliases: ["PIAGGIO VEHICLES", "PIAGGIO VEHICLES PVT", "PIAGGIO VEHICLES PRIVATE"] },
      { name: "Atul Auto", aliases: ["ATUL AUTO", "ATUL AUTO LTD", "ATUL AUTO LIMITED"] },
    ],
  },
  {
    ...SEGMENT_DEFINITIONS[2],
    title: "4W OEM registrations",
    brands: [
      { name: "Maruti Suzuki", aliases: ["MARUTI SUZUKI", "MARUTI SUZUKI INDIA"] },
      { name: "Tata Motors", aliases: ["TATA MOTORS", "TATA MOTORS LTD", "TATA MOTORS LIMITED"] },
      { name: "Mahindra & Mahindra", aliases: ["MAHINDRA AND MAHINDRA", "MAHINDRA & MAHINDRA", "MAHINDRA MAHINDRA"] },
      { name: "Hyundai Motor India", aliases: ["HYUNDAI MOTOR INDIA", "HYUNDAI MOTOR"] },
      { name: "JSW MG Motor India", aliases: ["JSW MG MOTOR", "JSW MG MOTOR INDIA", "MG MOTOR INDIA", "M G MOTOR INDIA"] },
    ],
  },
];

export function monthlySalesSegmentRefreshContexts() {
  return SEGMENT_DEFINITIONS.map((segment) => ({
    id: segment.id,
    title: segment.title,
    vehicleCategories: contextItems(segment.vehicle_category_filter),
    norms: contextItems(segment.norms_filter),
    vehicleClasses: contextItems(segment.vehicle_class_filter),
  }));
}

export function monthlySalesOemRefreshContexts() {
  return OEM_CATEGORY_DEFINITIONS.map((segment) => ({
    id: segment.id,
    title: segment.title,
    vehicleCategories: contextItems(segment.vehicle_category_filter),
    norms: contextItems(segment.norms_filter),
    vehicleClasses: contextItems(segment.vehicle_class_filter),
  }));
}

export function buildMonthlySalesReport({
  rows,
  makerRows = [],
  month = null,
  fuelScope = "all",
  fuel = null,
  locationScope = null,
  expectedStates = [],
  sourceLabel = "VAHAN public dashboard aggregate data",
  generatedAt = new Date(),
} = {}) {
  const reportScope = normalizeLocationScope(locationScope);
  const normalizedRows = (rows ?? []).filter((row) => Number.isFinite(Number(row.vehicle_count)));
  const baseRows = normalizedRows.filter((row) => isBaseMarketRow(row, reportScope));
  const expectedStateNames = uniqueSorted(expectedStates);
  const reportMonth = validMonthKey(month)
    ? month
    : latestCompleteCoverageMonth(baseRows.length ? baseRows : normalizedRows, expectedStateNames);
  if (!reportMonth) {
    const error = new Error("No registration rows are available to build a monthly report.");
    error.statusCode = 404;
    throw error;
  }

  const fuelSelection = normalizeFuelSelection(fuelScope, fuel);
  const previousMonth = shiftMonth(reportMonth, -1);
  const trendMonths = latestCompleteCoverageMonths(baseRows.length ? baseRows : normalizedRows, expectedStateNames, reportMonth, 12);
  const completeTrendMonths = new Set(trendMonths);
  const months = monthWindow(reportMonth, 12);
  const pendingTrendMonths = months.filter((item) => !completeTrendMonths.has(item));
  const reportBaseRows = reportMonthRows(baseRows, uniqueSorted([...months, previousMonth, reportMonth]));
  const monthBaseRows = preferredRowsForMonth(baseRows, reportMonth);
  const usesNationalAggregate = reportScope.type === "all" && monthBaseRows.some(isNationalAggregateRow);
  const currentRows = reportBaseRows.filter((row) => rowMonth(row) === reportMonth && matchesFuelSelection(row, fuelSelection));
  const previousRows = reportBaseRows.filter((row) => rowMonth(row) === previousMonth && matchesFuelSelection(row, fuelSelection));
  const allCurrentRows = reportBaseRows.filter((row) => rowMonth(row) === reportMonth);
  const total = sumRows(currentRows);
  const previousTotal = sumRows(previousRows);
  const trend = months.map((item) => {
    const monthRows = reportBaseRows.filter((row) => rowMonth(row) === item);
    const scopeRows = monthRows.filter((row) => matchesFuelSelection(row, fuelSelection));
    const completeCoverage = completeTrendMonths.has(item);
    return {
      month: item,
      count: completeCoverage ? sumRows(scopeRows) : null,
      completeCoverage,
      fuelMix: completeCoverage ? fuelMix(scopeRows, fuelSelection) : [],
    };
  });
  const currentFuelMix = fuelMix(currentRows, fuelSelection);
  const allFuelMix = fuelMix(allCurrentRows, { scope: "all" });
  const categorySales = SEGMENT_DEFINITIONS.map((segment) =>
    segmentSummary(normalizedRows, segment, fuelSelection, reportMonth, previousMonth, months, {
      preferNationalAggregate: usesNationalAggregate,
      locationScope: reportScope,
    }),
  );
  const usableCategorySales = categorySales.filter((item) => item.status !== "missing");
  const shareTrend = fuelSelection.scope === "all"
    ? fuelMixShareTrend(reportBaseRows, allFuelMix.slice(0, 5).map((item) => item.fuelType), months)
    : segmentShareTrend(categorySales);
  const oemSection = oemLeaderboard(makerRows, fuelSelection, reportMonth, reportScope);
  const completeTrend = trend.filter((item) => item.count !== null);
  const peak = completeTrend.reduce((best, item) => item.count > (best?.count ?? -1) ? item : best, null);
  const low = completeTrend.reduce((best, item) => item.count < (best?.count ?? Infinity) ? item : best, null);
  const scopeLabel = describeFuelSelection(fuelSelection);
  const states = uniqueSorted(monthBaseRows.map((row) => row.state));
  const missingStates = missingExpectedStates(expectedStateNames, states);
  const expectedStateCount = expectedStateNames.length || states.length;
  const loadedStateCount = usesNationalAggregate && expectedStateCount ? expectedStateCount : states.length;
  const completeStateCoverage = usesNationalAggregate || (expectedStateCount > 0 && states.length >= expectedStateCount && missingStates.length === 0);
  const latestLoadedMonth = latestMonth(baseRows.length ? baseRows : normalizedRows);

  return {
    title: `${scopeLabel} vehicle sales trend${reportScope.label ? ` for ${reportScope.label}` : ""} | ${displayMonth(reportMonth)}`,
    kind: "monthly-sales",
    period: {
      month: reportMonth,
      previousMonth,
      trendFrom: months[0],
      trendTo: months[months.length - 1],
    },
    fuelSelection,
    locationScope: reportScope,
    source: {
      label: sourceLabel,
      latestLoadedMonth,
      generatedAt: new Date(generatedAt).toISOString(),
    },
    coverage: {
      baseRows: baseRows.length,
      currentBaseRows: allCurrentRows.length,
      currentScopeRows: currentRows.length,
      states: loadedStateCount,
      stateNames: states,
      expectedStates: expectedStateCount,
      missingStates,
      completeStateCoverage,
      nationalAggregate: usesNationalAggregate,
      trendMonths: months,
      trendCompleteMonths: trendMonths,
      trendPendingMonths: pendingTrendMonths,
      categorySectionsAvailable: usableCategorySales.length,
      categorySectionsTotal: categorySales.length,
      makerRows: oemSection.rowCount,
      makerCategorySectionsAvailable: oemSection.availableGroups,
      makerCategorySectionsTotal: oemSection.groups.length,
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
          states: loadedStateCount,
          expectedStates: expectedStateCount,
        },
        narrative: overviewNarrative(scopeLabel, reportMonth, total, previousTotal, loadedStateCount, expectedStateCount, reportScope),
      },
      {
        id: "fuel_mix",
        title: fuelSelection.scope === "all" ? "EV vs ICE sales mix" : `${scopeLabel} fuel labels`,
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
        narrative: trendNarrative(scopeLabel, trend, peak, low, reportScope),
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
        title: "OEM / maker registrations by category",
        chartType: "grouped-table",
        chartData: oemSection.groups,
        metrics: {
          rowCount: oemSection.rowCount,
          total: oemSection.total,
          availableGroups: oemSection.availableGroups,
          totalGroups: oemSection.groups.length,
        },
        narrative: oemNarrative(oemSection, scopeLabel),
        warnings: oemSection.warnings,
      },
    ],
    dataNotes: dataNotes({ latestLoadedMonth, reportMonth, states, expectedStateCount, missingStates, categorySales, oemSection, usesNationalAggregate, trendMonths, locationScope: reportScope }),
  };
}

export function renderMonthlySalesReportHtml(report, { includeShell = true } = {}) {
  const sections = report.sections.map(renderSection).join("\n");
  const notes = report.dataNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  const fuelScope = encodeURIComponent(report.fuelSelection.scope);
  const fuel = encodeURIComponent(report.fuelSelection.fuel ?? "");
  const month = encodeURIComponent(report.period.month);
  const location = encodeURIComponent(report.locationScope?.query ?? "");
  const pdfHref = `/api/reports/monthly-sales/pdf?month=${month}&fuelScope=${fuelScope}${fuel ? `&fuel=${fuel}` : ""}${location ? `&location=${location}` : ""}`;
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
        <article><span>Location</span><strong>${escapeHtml(report.locationScope?.label ?? "All India")}</strong></article>
        <article><span>Fuel scope</span><strong>${escapeHtml(describeFuelSelection(report.fuelSelection))}</strong></article>
        <article><span>States loaded</span><strong>${formatCoverageCount(report.coverage.states, report.coverage.expectedStates)}</strong></article>
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
  if (section.id === "twelve_month_trend") return renderTrendChart(data);
  if (section.id === "oem_leaders") return renderOemGroups(data);
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
  const renderableData = data.filter((item) => item.status !== "missing");
  if (!renderableData.length) return `<p class="report-empty">No saved data is available for this section.</p>`;
  const max = Math.max(1, ...renderableData.map((item) => Number(item.count ?? item.currentCount ?? 0)));
  return `
    <div class="report-bars">
      ${renderableData.slice(0, 12).map((item) => {
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

function renderOemGroups(groups) {
  if (!groups.length) return `<p class="report-empty">No OEM category definitions are configured.</p>`;
  return `
    <div class="report-oem-groups">
      ${groups.map((group) => `
        <article class="report-oem-group">
          <h3>${escapeHtml(group.title)}</h3>
          ${group.status !== "available" ? `<p class="report-empty">${escapeHtml(group.warning ?? "No complete maker rows are available for this category.")}</p>` : ""}
          <table>
            <thead><tr><th>Brand</th><th>Registrations</th><th>Share</th><th>Matched VAHAN maker labels</th></tr></thead>
            <tbody>${(group.brands ?? []).map((brand) => `
              <tr>
                <td>${escapeHtml(brand.name)}</td>
                <td>${formatNumber(brand.count)}</td>
                <td>${formatPercent(brand.share)}</td>
                <td>${escapeHtml((brand.matchedMakers ?? []).join(", ") || "Not found")}</td>
              </tr>
            `).join("")}</tbody>
          </table>
        </article>
      `).join("")}
    </div>
  `;
}

function renderTrendChart(data) {
  const width = 900;
  const height = 330;
  const margin = { top: 22, right: 26, bottom: 48, left: 76 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const validItems = data.filter((item) => item.count !== null && item.count !== undefined);
  const max = niceChartMax(Math.max(1, ...validItems.map((item) => Number(item.count || 0))));
  const points = data.map((item, index) => ({
    x: Math.round(margin.left + (data.length === 1 ? chartWidth / 2 : (index / (data.length - 1)) * chartWidth)),
    y: item.count === null || item.count === undefined
      ? Math.round(margin.top + chartHeight)
      : Math.round(margin.top + chartHeight - (Number(item.count || 0) / max) * chartHeight),
    item,
    hasCount: item.count !== null && item.count !== undefined,
  }));
  const linePath = smoothPath(points.filter((point) => point.hasCount));
  const yTicks = Array.from({ length: 6 }, (_, index) => {
    const value = Math.round((max / 5) * index);
    const y = Math.round(margin.top + chartHeight - (value / max) * chartHeight);
    return { value, y };
  }).reverse();
  return `
    <div class="report-trend-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="12-month trend">
        ${yTicks.map((tick) => `
          <line class="report-trend-grid" x1="${margin.left}" x2="${margin.left + chartWidth}" y1="${tick.y}" y2="${tick.y}" />
          <text class="report-trend-y" x="${margin.left - 10}" y="${tick.y + 4}">${formatNumber(tick.value)}</text>
        `).join("")}
        <line class="report-trend-axis" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${margin.top + chartHeight}" />
        <line class="report-trend-axis" x1="${margin.left}" x2="${margin.left + chartWidth}" y1="${margin.top + chartHeight}" y2="${margin.top + chartHeight}" />
        ${linePath ? `<path class="report-trend-line" d="${linePath}" />` : ""}
        ${points.map((point) => {
          const tooltipWidth = 150;
          const tooltipHeight = 34;
          const tooltipX = Math.min(width - tooltipWidth - 8, Math.max(8, point.x - (tooltipWidth / 2)));
          const tooltipY = Math.max(8, point.y - tooltipHeight - 14);
          const valueLabel = point.hasCount ? formatNumber(point.item.count) : "Pending";
          const monthLabel = displayMonth(point.item.month);
          return `
          ${point.hasCount ? `
            <g class="report-trend-point-wrap" tabindex="0" aria-label="${escapeHtml(`${monthLabel}: ${valueLabel}`)}">
              <title>${escapeHtml(`${monthLabel}: ${valueLabel}`)}</title>
              <circle class="report-trend-hit" cx="${point.x}" cy="${point.y}" r="14" />
              <circle class="report-trend-point" cx="${point.x}" cy="${point.y}" r="4" />
              <g class="report-trend-tooltip" pointer-events="none">
                <rect x="${tooltipX}" y="${tooltipY}" width="${tooltipWidth}" height="${tooltipHeight}" rx="7" />
                <text x="${tooltipX + 10}" y="${tooltipY + 14}" class="report-trend-tooltip-month">${escapeHtml(displayShortMonth(point.item.month))}</text>
                <text x="${tooltipX + 10}" y="${tooltipY + 28}" class="report-trend-tooltip-value">${escapeHtml(valueLabel)}</text>
              </g>
            </g>
          ` : ""}
          <text class="report-trend-x" x="${point.x}" y="${margin.top + chartHeight + 28}">${escapeHtml(displayShortMonth(point.item.month))}</text>
        `;
        }).join("")}
      </svg>
      <table class="report-trend-table">
        <thead><tr><th>Series</th>${data.map((item) => `<th>${escapeHtml(displayShortMonth(item.month))}</th>`).join("")}</tr></thead>
        <tbody><tr><th>Total</th>${data.map((item) => `<td>${item.count === null || item.count === undefined ? "Pending" : formatNumber(item.count)}</td>`).join("")}</tr></tbody>
      </table>
    </div>
  `;
}

function segmentSummary(rows, segment, fuelSelection, currentMonth, previousMonth, months, { preferNationalAggregate = false, locationScope = null } = {}) {
  const reportScope = normalizeLocationScope(locationScope);
  const matchingRows = rows.filter((row) => matchesReportRtoScope(row, reportScope) && matchesSegmentContext(row, segment));
  const segmentRowsRaw = preferNationalAggregate
    ? matchingRows.filter(isNationalAggregateRow)
    : matchingRows;
  const segmentRows = reportMonthRows(segmentRowsRaw, uniqueSorted([...months, previousMonth, currentMonth]));
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
    status: currentRows.length && currentAllCount > 0 ? "available" : "missing",
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

function fuelMix(rows, selection = { scope: "all" }) {
  const total = sumRows(rows);
  const byFuel = new Map();
  for (const row of rows) {
    const fuelType = selection.scope === "all" ? evIceFuelGroup(row) : row.fuel_type;
    byFuel.set(fuelType, (byFuel.get(fuelType) ?? 0) + Number(row.vehicle_count || 0));
  }
  return [...byFuel.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([fuelType, count]) => ({ fuelType, count, share: share(count, total) }));
}

function evIceFuelGroup(row) {
  return BATTERY_ELECTRIC_FUELS.has(normalizeLabel(row.fuel_type)) ? "EV" : "ICE";
}

function fuelMixShareTrend(rows, fuelTypes, months) {
  return fuelTypes.map((fuelType) => {
    const trend = months.map((month) => {
      const monthRows = rows.filter((row) => rowMonth(row) === month);
      const count = sumRows(monthRows.filter((row) => evIceFuelGroup(row) === fuelType));
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

function oemLeaderboard(makerRows, fuelSelection, month, locationScope = null) {
  const reportScope = normalizeLocationScope(locationScope);
  const currentRows = (makerRows ?? [])
    .filter((row) => rowMonth(row) === month)
    .filter((row) => matchesReportRtoScope(row, reportScope))
    .filter((row) => matchesMakerFuelSelection(row, fuelSelection));
  const groups = OEM_CATEGORY_DEFINITIONS.map((category) => oemCategoryGroup(currentRows, category));
  const rowCount = groups.reduce((sum, group) => sum + group.rowCount, 0);
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  const availableGroups = groups.filter((group) => group.status === "available").length;
  return {
    rowCount,
    total,
    availableGroups,
    groups,
    warnings: groups.filter((group) => group.status !== "available").map((group) => group.warning).filter(Boolean),
  };
}

function oemCategoryGroup(rows, category) {
  const categoryRows = rows.filter((row) => matchesSegmentContext(row, category));
  const total = sumRows(categoryRows);
  const brands = category.brands.map((brand) => {
    const matchedRows = categoryRows.filter((row) => matchesOemBrand(row.maker, brand));
    const count = sumRows(matchedRows);
    return {
      name: brand.name,
      count,
      share: share(count, total),
      matchedMakers: uniqueSorted(matchedRows.map((row) => row.maker)),
    };
  });
  const missingBrands = brands.filter((brand) => !(brand.matchedMakers ?? []).length).map((brand) => brand.name);
  const status = !categoryRows.length ? "missing" : missingBrands.length ? "partial" : "available";
  const warning = !categoryRows.length
    ? `${category.title} has no saved maker/OEM rows for this month, fuel scope, and category filter.`
    : missingBrands.length
      ? `${category.title} maker/OEM rows are incomplete for this month, fuel scope, and category filter. Missing target brand labels: ${missingBrands.join(", ")}. Re-fetch this category to read all VAHAN maker pages.`
      : null;
  return {
    id: category.id,
    title: category.title,
    vehicle_category_filter: category.vehicle_category_filter ?? ALL_FILTER,
    norms_filter: category.norms_filter ?? ALL_FILTER,
    vehicle_class_filter: category.vehicle_class_filter ?? ALL_FILTER,
    filters: {
      vehicleCategories: contextItems(category.vehicle_category_filter),
      norms: contextItems(category.norms_filter),
      vehicleClasses: contextItems(category.vehicle_class_filter),
    },
    rowCount: categoryRows.length,
    total,
    status,
    brands,
    missingBrands,
    warning,
  };
}

function matchesOemBrand(maker, brand) {
  const makerText = normalizeMakerName(maker);
  if (!makerText) return false;
  return [brand.name, ...(brand.aliases ?? [])].some((alias) => {
    const aliasText = normalizeMakerName(alias);
    return makerText === aliasText || makerText.includes(aliasText) || aliasText.includes(makerText);
  });
}

function normalizeMakerName(value) {
  return normalizeLabel(value)
    .replace(/&/g, " AND ")
    .replace(/\b(?:LTD|LIMITED|PVT|PRIVATE|CO|COMPANY|INDIA|MOTORS?)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function isBaseMarketRow(row, locationScope = null) {
  return matchesReportRtoScope(row, normalizeLocationScope(locationScope)) &&
    String(row.fuel_filter ?? ALL_FILTER) === ALL_FILTER &&
    String(row.vehicle_category_filter ?? ALL_FILTER) === ALL_FILTER &&
    String(row.norms_filter ?? ALL_FILTER) === ALL_FILTER &&
    String(row.vehicle_class_filter ?? ALL_FILTER) === ALL_FILTER;
}

function isAggregateRtoRow(row) {
  return !row.rto || row.rto === ALL_RTO;
}

function matchesReportRtoScope(row, locationScope = null) {
  const reportScope = normalizeLocationScope(locationScope);
  if (reportScope.type === "rto") return Boolean(row.rto) && row.rto !== ALL_RTO;
  return isAggregateRtoRow(row);
}

function normalizeLocationScope(scope) {
  const type = ["state", "rto"].includes(String(scope?.type ?? "").toLowerCase())
    ? String(scope.type).toLowerCase()
    : "all";
  if (type === "all") {
    return { type: "all", label: "All India", state: null, rto: null, query: null };
  }
  const state = scope?.state ? String(scope.state).trim() : null;
  const rto = scope?.rto ? String(scope.rto).trim() : null;
  const label = String(scope?.label ?? (type === "rto" ? [rto, state].filter(Boolean).join(", ") : state) ?? "").trim();
  return {
    type,
    label: label || (type === "rto" ? rto : state) || "Selected location",
    state,
    rto,
    query: scope?.query ? String(scope.query).trim() : label || state || rto || null,
  };
}

function isNationalAggregateRow(row) {
  const state = normalizeComparableState(row.state);
  const allStates = normalizeComparableState(ALL_STATES);
  return Boolean(state) && (
    state === normalizeComparableState("INDIA TOTAL") ||
    state === allStates ||
    state.startsWith(`${allStates} `)
  );
}

function preferredRowsForMonth(rows, month) {
  const monthRows = (rows ?? []).filter((row) => rowMonth(row) === month);
  const nationalRows = monthRows.filter(isNationalAggregateRow);
  if (nationalRows.length) return preferredNationalAggregateRows(nationalRows);
  return monthRows.filter((row) => !isNationalAggregateRow(row));
}

function preferredNationalAggregateRows(rows) {
  const byState = new Map();
  for (const row of rows) {
    const key = normalizeComparableState(row.state);
    if (!byState.has(key)) byState.set(key, []);
    byState.get(key).push(row);
  }
  return [...byState.values()]
    .sort((left, right) =>
      latestScrapedAt(right) - latestScrapedAt(left) ||
      Number(right.some((row) => normalizeComparableState(row.state) === normalizeComparableState("INDIA TOTAL"))) -
        Number(left.some((row) => normalizeComparableState(row.state) === normalizeComparableState("INDIA TOTAL"))),
    )[0] ?? [];
}

function latestScrapedAt(rows) {
  return Math.max(0, ...rows.map((row) => Date.parse(row.scraped_at ?? row.scrapedAt ?? "") || 0));
}

function reportMonthRows(rows, months) {
  return months.flatMap((month) => preferredRowsForMonth(rows, month));
}

function contextValue(values) {
  return values.length ? values.map((value) => normalizeLabel(value)).sort().join("|") : ALL_FILTER;
}

function contextItems(value) {
  const text = String(value ?? ALL_FILTER);
  return text === ALL_FILTER ? [] : text.split("|").map((item) => item.trim()).filter(Boolean);
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

function latestCompleteCoverageMonth(rows, expectedStates = []) {
  const latest = latestMonth(rows);
  if (!expectedStates.length) return latest;
  return latestCompleteCoverageMonths(rows, expectedStates, latest, 1).at(-1) ?? latest;
}

function latestCompleteCoverageMonths(rows, expectedStates = [], throughMonth = null, count = 12) {
  const latest = latestMonth(rows);
  const endMonth = validMonthKey(throughMonth) ? throughMonth : latest;
  if (!endMonth) return [];
  if (!expectedStates.length) {
    return [...new Set((rows ?? []).map(rowMonth))]
      .filter((month) => validMonthKey(month) && month <= endMonth)
      .sort()
      .slice(-count);
  }
  const expected = new Set(expectedStates.map(normalizeComparableState));
  const statesByMonth = new Map();
  for (const row of rows ?? []) {
    const month = rowMonth(row);
    if (!validMonthKey(month)) continue;
    if (month > endMonth) continue;
    if (!statesByMonth.has(month)) statesByMonth.set(month, new Set());
    statesByMonth.get(month).add(normalizeComparableState(row.state));
  }
  return [...statesByMonth.entries()]
    .filter(([, states]) =>
      [...states].some((state) => state.startsWith(normalizeComparableState(ALL_STATES))) ||
      [...expected].every((state) => states.has(state)),
    )
    .map(([month]) => month)
    .sort()
    .slice(-count);
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

function normalizeComparableState(value) {
  return normalizeLabel(value).replace(/&/g, "AND");
}

function missingExpectedStates(expectedStates, loadedStates) {
  if (!expectedStates.length) return [];
  if (loadedStates.some((state) => normalizeComparableState(state).startsWith(normalizeComparableState(ALL_STATES)))) return [];
  const loaded = new Set(loadedStates.map(normalizeComparableState));
  return expectedStates.filter((state) => !loaded.has(normalizeComparableState(state)));
}

function overviewNarrative(scopeLabel, month, total, previousTotal, states, expectedStates = states, locationScope = null) {
  const reportScope = normalizeLocationScope(locationScope);
  const change = total - previousTotal;
  const direction = change > 0 ? "increased" : change < 0 ? "declined" : "was flat";
  const changeText = previousTotal ? `${formatDelta(change)} (${formatPercent(percentChange(total, previousTotal))})` : "not comparable because previous-month data is unavailable";
  const coverageText = reportScope.type === "rto"
    ? `the ${reportScope.label} RTO scope`
    : reportScope.type === "state"
      ? `${reportScope.label} aggregate rows`
      : expectedStates > states
        ? `${formatNumber(states)} of ${formatNumber(expectedStates)} expected state(s)`
        : `${formatNumber(states)} loaded state(s)`;
  return `${scopeLabel} registrations in ${displayMonth(month)} ${direction} to ${formatNumber(total)} units; month-on-month change was ${changeText}. The current report uses ${coverageText}.`;
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

function trendNarrative(scopeLabel, trend, peak, low, locationScope = null) {
  const reportScope = normalizeLocationScope(locationScope);
  const completeCount = trend.filter((item) => item.completeCoverage).length;
  if (!completeCount || !peak || !low) return `No complete 12-month ${scopeLabel} trend rows are available yet. Refresh VAHAN states to fill the missing months.`;
  const coverageText = completeCount === trend.length
    ? `All 12 months have complete ${reportScope.type === "all" ? "all-India" : reportScope.label} coverage.`
    : `${completeCount} of ${trend.length} months have complete ${reportScope.type === "all" ? "all-India" : reportScope.label} coverage; incomplete months are shown as pending instead of using partial totals.`;
  return `${scopeLabel} monthly sales peaked in ${displayMonth(peak.month)} at ${formatNumber(peak.count)} registrations and were lowest in ${displayMonth(low.month)} at ${formatNumber(low.count)} registrations. ${coverageText}`;
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
  const partialGroups = section.groups.filter((group) => group.status === "partial");
  if (!section.availableGroups && partialGroups.length) {
    return `OEM category registrations for ${scopeLabel} are partial because saved maker rows do not yet include every target brand label. Re-fetch the incomplete categories to read all VAHAN maker pages.`;
  }
  if (!section.availableGroups) return `OEM category registrations for ${scopeLabel} are partial because no matching maker rows are currently saved with category filters.`;
  const leaders = section.groups
    .filter((group) => group.status !== "missing")
    .map((group) => ({ group, brand: [...group.brands].sort((a, b) => b.count - a.count)[0] }))
    .filter((item) => item.brand);
  const leaderText = leaders
    .map((item) => `${item.group.title}: ${item.brand.name} (${formatNumber(item.brand.count)})`)
    .join("; ");
  return `OEM category registrations for ${scopeLabel} use saved maker rows with the matching category filters. ${leaderText}`;
}

function dataNotes({ latestLoadedMonth, reportMonth, states, expectedStateCount, missingStates, categorySales, oemSection, usesNationalAggregate, trendMonths = [], locationScope = null }) {
  const reportScope = normalizeLocationScope(locationScope);
  const missingSegments = categorySales.filter((item) => item.status === "missing").length;
  const missingStateNote = missingStates.length
    ? `Missing base state coverage: ${missingStates.slice(0, 12).join(", ")}${missingStates.length > 12 ? ` +${missingStates.length - 12} more` : ""}.`
    : usesNationalAggregate
      ? "Base totals use VAHAN's all-state aggregate row."
      : "Base state coverage is complete for the expected all-India state set.";
  const stateCoverageText = usesNationalAggregate
    ? `national aggregate (${states[0] ?? ALL_STATES})`
    : `${expectedStateCount ? `${states.length}/${expectedStateCount}` : states.length} (${states.length ? states.join(", ") : "none"})`;
  return [
    `Source: VAHAN aggregate registration rows saved in this system; latest loaded base month is ${latestLoadedMonth ?? "not available"}.`,
    `Location scope: ${reportScope.label}.`,
    `Report month: ${reportMonth}. State coverage in base rows: ${stateCoverageText}.`,
    trendMonths.length === 12
      ? `Trend window has complete all-India base coverage for all 12 months: ${trendMonths[0]} to ${trendMonths.at(-1)}.`
      : `Trend window displays all 12 selected months; ${trendMonths.length}/12 have complete all-India base coverage, and the rest are marked pending until VAHAN refresh fills them.`,
    missingStateNote,
    missingSegments ? `${missingSegments} configured segment section(s) have no saved side-filter rows for the report month.` : "Configured segment rows are available for all displayed segment sections.",
    oemSection.availableGroups === oemSection.groups.length ? "OEM category registrations use saved maker rows for the same month, fuel scope, and category filters." : "OEM category registrations are partial until maker rows are scraped or imported for every category filter.",
    "Counts are registrations, not retail deliveries. The report never fills missing sections with estimated values.",
  ];
}

function displayMonth(value) {
  if (!validMonthKey(value)) return String(value ?? "");
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function displayShortMonth(value) {
  if (!validMonthKey(value)) return String(value ?? "");
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short", year: "2-digit" })
    .format(new Date(Date.UTC(year, month - 1, 1)))
    .replace(" ", "-");
}

function displayDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? "") : date.toLocaleString("en-IN");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(Math.round(Number(value) || 0));
}

function formatCoverageCount(loaded, expected) {
  return expected && expected > loaded ? `${formatNumber(loaded)} / ${formatNumber(expected)}` : formatNumber(loaded);
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

function niceChartMax(value) {
  const number = Math.max(1, Number(value) || 1);
  const magnitude = 10 ** Math.floor(Math.log10(number));
  const scaled = number / magnitude;
  const nice = scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * magnitude;
}

function smoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    const midX = (previous.x + current.x) / 2;
    commands.push(`Q ${previous.x} ${previous.y} ${midX} ${(previous.y + current.y) / 2}`);
    commands.push(`Q ${current.x} ${current.y} ${current.x} ${current.y}`);
  }
  return commands.join(" ");
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
    .report-oem-groups { display: grid; gap: 14px; }
    .report-oem-group h3 { margin: 0 0 10px; font-size: 15px; }
    .report-bar { display: grid; grid-template-columns: minmax(160px, 240px) 1fr 110px; gap: 10px; align-items: center; font-size: 13px; }
    .report-bar i { height: 10px; border-radius: 999px; background: #e6edf5; overflow: hidden; }
    .report-bar b { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #14b8a6, #38bdf8); }
    .report-bar strong { text-align: right; }
    .report-trend-chart { display: grid; gap: 10px; }
    .report-trend-chart svg { width: 100%; height: auto; border: 1px solid #d8e0ea; border-radius: 8px; background: #fbfdff; }
    .report-trend-grid { stroke: #dbe4ef; stroke-width: 1; }
    .report-trend-axis { stroke: #98a2b3; stroke-width: 1.2; }
    .report-trend-line { fill: none; stroke: #78b95f; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
    .report-trend-point { fill: white; stroke: #78b95f; stroke-width: 3; }
    .report-trend-point-wrap { cursor: pointer; outline: none; }
    .report-trend-hit { fill: transparent; stroke: transparent; }
    .report-trend-tooltip { opacity: 0; transform: translateY(4px); transition: opacity .12s ease, transform .12s ease; }
    .report-trend-tooltip rect { fill: #101828; stroke: #243247; stroke-width: 1; filter: drop-shadow(0 4px 8px rgba(16, 24, 40, .16)); }
    .report-trend-tooltip text { fill: white; font-weight: 800; }
    .report-trend-tooltip-month { font-size: 10px; opacity: .72; }
    .report-trend-tooltip-value { font-size: 13px; }
    .report-trend-point-wrap:hover .report-trend-point,
    .report-trend-point-wrap:focus .report-trend-point { fill: #78b95f; stroke: #2f6f2a; }
    .report-trend-point-wrap:hover .report-trend-tooltip,
    .report-trend-point-wrap:focus .report-trend-tooltip { opacity: 1; transform: translateY(0); }
    .report-trend-y, .report-trend-x { fill: #526070; font-size: 12px; font-weight: 800; }
    .report-trend-y { text-anchor: end; }
    .report-trend-x { text-anchor: middle; }
    .report-trend-table { table-layout: fixed; }
    .report-trend-table th, .report-trend-table td { font-size: 10px; text-align: center; white-space: nowrap; }
    .report-trend-table th:first-child { text-align: left; width: 64px; }
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
