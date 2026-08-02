export const DAILY_EV_REPORT_KIND = "daily-ev-report-try";
export const DEFAULT_ANOMALY_REPORT_TOTAL_MAX = 1_000_000;
export const DEFAULT_MIN_STATE_COVERAGE_PCT = 50;
export const EXPECTED_DAILY_REPORT_COMBOS = Object.freeze([
  "EV|2W",
  "EV|3W",
  "EV|4W",
  "ICE|2W",
  "ICE|3W",
  "ICE|4W",
]);

const NUMBER_FORMAT = new Intl.NumberFormat("en-IN");
const PERCENT_FORMAT = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 1,
});

export function selectLatestEligibleRun(runs = []) {
  return runs
    .map(normalizeRun)
    .filter((run) => run.snapshotDate && ["success", "partial"].includes(run.status))
    .sort((a, b) =>
      b.snapshotDate.localeCompare(a.snapshotDate) ||
      String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")) ||
      Number(b.id ?? 0) - Number(a.id ?? 0),
    )[0] ?? null;
}

export function buildDailyEvReportSet({
  run,
  previousRun = null,
  configRows = [],
  currentRows = [],
  previousRows = [],
  minStateCoveragePct = DEFAULT_MIN_STATE_COVERAGE_PCT,
  anomalyReportTotalMax = DEFAULT_ANOMALY_REPORT_TOTAL_MAX,
  generatedAt = new Date(),
} = {}) {
  const normalizedRun = normalizeRun(run);
  if (!normalizedRun?.id || !normalizedRun.snapshotDate || !normalizedRun.targetMonth) {
    throw new Error("A completed or partial RTO daily run is required to build daily EV reports.");
  }

  const normalizedPreviousRun = previousRun ? normalizeRun(previousRun) : null;
  const configs = normalizeConfigRows(configRows);
  const rows = normalizeReportRows(currentRows);
  const previous = normalizeReportRows(previousRows);
  const completeKeys = completeRtoKeys(rows);
  const previousCompleteKeys = completeRtoKeys(previous);
  const enabledStateCounts = countEnabledRtosByState(configs);
  const allStates = [...enabledStateCounts.keys()].sort((a, b) => a.localeCompare(b));
  const totalEnabledRtos = sum([...enabledStateCounts.values()]);
  const reportContext = {
    run: normalizedRun,
    previousRun: normalizedPreviousRun,
    generatedAt: new Date(generatedAt).toISOString(),
    rows,
    previousRows: previous,
    completeKeys,
    previousCompleteKeys,
    enabledStateCounts,
    anomalyReportTotalMax,
  };

  const india = buildReportForScope({
    ...reportContext,
    scope: "india",
    label: "India",
    expectedRtos: totalEnabledRtos,
    minStateCoveragePct,
  });

  const states = [];
  const skipped = [];
  for (const state of allStates) {
    const expectedRtos = enabledStateCounts.get(state) ?? 0;
    const completedRtos = countKeysForState(completeKeys, state);
    const coveragePct = percent(completedRtos, expectedRtos);
    if (coveragePct < minStateCoveragePct) {
      skipped.push({
        scope: "state",
        state,
        reason: "coverage_below_threshold",
        expectedRtos,
        completedRtos,
        coveragePct,
        minStateCoveragePct,
      });
      continue;
    }
    states.push(buildReportForScope({
      ...reportContext,
      scope: "state",
      state,
      label: state,
      expectedRtos,
      minStateCoveragePct,
    }));
  }

  return {
    kind: DAILY_EV_REPORT_KIND,
    generatedAt: reportContext.generatedAt,
    run: normalizedRun,
    previousRun: normalizedPreviousRun,
    options: {
      minStateCoveragePct,
      anomalyReportTotalMax,
    },
    reports: {
      india,
      states,
    },
    skipped,
  };
}

export function renderDailyEvReportHtml(report) {
  const warnings = report.warnings.length
    ? `<section class="warning-block"><h2>Warnings</h2><ul>${report.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`
    : "";
  const anomalies = report.anomalies.length
    ? `<section><h2>Critical Anomalies</h2>${renderAnomalyTable(report.anomalies)}</section>`
    : "";
  const topTable = report.scope === "india"
    ? renderRankSection("Top States by EV MTD", report.topStates, "state")
    : renderRankSection("Top RTOs by EV MTD", report.topRtos, "rto");
  const movement = report.movement
    ? `<section><h2>Comparable Daily Movement</h2>
        <div class="metric-grid compact">
          <article><span>Previous date</span><strong>${escapeHtml(report.movement.previousSnapshotDate)}</strong></article>
          <article><span>Comparable RTOs</span><strong>${formatNumber(report.movement.comparableRtos)}</strong></article>
          <article><span>EV movement</span><strong>${formatDelta(report.movement.evDelta)}</strong></article>
        </div>
        ${renderMovementChart(report.movement)}
        <p>${escapeHtml(report.movement.narrative)}</p>
      </section>`
    : `<section><h2>Comparable Daily Movement</h2><p>No previous eligible run is available for this target month.</p></section>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(report.title)}</title>
    <style>${dailyReportCss()}</style>
  </head>
  <body>
    <main class="report">
      <header class="hero">
        <p>VAHAN daily EV trial report</p>
        <h1>${escapeHtml(report.title)}</h1>
        <span class="status ${escapeHtml(report.status)}">${escapeHtml(statusLabel(report.status))}</span>
      </header>

      <section class="metric-grid">
        <article><span>Report date</span><strong>${escapeHtml(report.period.snapshotDate)}</strong></article>
        <article><span>Target month</span><strong>${escapeHtml(report.period.targetMonth)}</strong></article>
        <article><span>RTO coverage</span><strong>${formatNumber(report.coverage.completedRtos)} / ${formatNumber(report.coverage.expectedRtos)}</strong><small>${formatPercent(report.coverage.coveragePct)}</small></article>
        <article><span>Anomaly rows</span><strong>${formatNumber(report.quality.anomalyRows)}</strong><small>${formatNumber(report.quality.anomalyRtos)} RTOs</small></article>
      </section>

      ${warnings}

      <section>
        <h2>EV vs ICE Month-to-Date</h2>
        <div class="chart-with-metrics">
          ${renderShareDonut(report.totals)}
          <div class="metric-grid compact">
            <article><span>EV MTD</span><strong>${formatNumber(report.totals.ev)}</strong></article>
            <article><span>ICE MTD</span><strong>${formatNumber(report.totals.ice)}</strong></article>
            <article><span>EV share</span><strong>${formatPercent(report.totals.evSharePct)}</strong></article>
          </div>
        </div>
      </section>

      <section>
        <h2>EV Category Split</h2>
        ${renderCategoryBars(report.categorySplit)}
      </section>

      ${topTable}
      ${movement}
      ${anomalies}

      <section class="notes">
        <h2>Source Notes</h2>
        <ul>${report.sourceNotes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
    </main>
  </body>
</html>`;
}

export function slugifyPathSegment(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "unknown";
}

export function reportRelativeParts(report) {
  if (report.scope === "india") return ["india"];
  return ["states", slugifyPathSegment(report.state)];
}

function buildReportForScope({
  scope,
  state = null,
  label,
  run,
  previousRun,
  generatedAt,
  rows,
  previousRows,
  completeKeys,
  previousCompleteKeys,
  enabledStateCounts,
  expectedRtos,
  minStateCoveragePct,
  anomalyReportTotalMax,
}) {
  const scopedKeys = filterKeysForState(completeKeys, state);
  const scopedRows = rows.filter((row) => scopedKeys.has(rtoKey(row)));
  const cleanRows = scopedRows.filter((row) => !criticalAnomaly(row, anomalyReportTotalMax));
  const anomalies = scopedRows
    .map((row) => criticalAnomaly(row, anomalyReportTotalMax))
    .filter(Boolean);
  const completedRtos = scopedKeys.size;
  const totals = aggregateTotals(cleanRows);
  const coveragePct = percent(completedRtos, expectedRtos);
  const anomalyRtos = uniqueCount(anomalies.map((row) => rtoKey(row)));
  const status = anomalies.length ? "needs_review" : coveragePct >= 100 ? "ready" : "partial";
  const warnings = buildWarnings({ scope, label, coveragePct, completedRtos, expectedRtos, anomalies });
  const movement = buildMovement({
    state,
    run,
    previousRun,
    rows,
    previousRows,
    completeKeys,
    previousCompleteKeys,
    anomalyReportTotalMax,
  });
  const title = scope === "india"
    ? `Daily EV Pulse | India | ${run.snapshotDate}`
    : `Daily EV Pulse | ${label} | ${run.snapshotDate}`;

  return {
    kind: DAILY_EV_REPORT_KIND,
    scope,
    state,
    title,
    status,
    generatedAt,
    period: {
      snapshotDate: run.snapshotDate,
      targetMonth: run.targetMonth,
      previousSnapshotDate: previousRun?.snapshotDate ?? null,
    },
    run: {
      id: run.id,
      status: run.status,
      totalRtos: run.totalRtos,
      succeededRtos: run.succeededRtos,
      failedRtos: run.failedRtos,
    },
    coverage: {
      expectedRtos,
      completedRtos,
      coveragePct,
      incompleteRtos: Math.max(0, expectedRtos - completedRtos),
      minStateCoveragePct: scope === "state" ? minStateCoveragePct : null,
    },
    quality: {
      anomalyRows: anomalies.length,
      anomalyRtos,
      anomalyReportTotalMax,
      cleanRows: cleanRows.length,
      sourceRows: scopedRows.length,
    },
    totals,
    categorySplit: categorySplit(totals),
    topStates: scope === "india" ? rankByState(cleanRows, enabledStateCounts).slice(0, 12) : [],
    topRtos: scope === "state" ? rankByRto(cleanRows).slice(0, 12) : [],
    movement,
    warnings,
    anomalies: anomalies.slice(0, 50),
    sourceNotes: sourceNotes(scope, label),
  };
}

function buildMovement({
  state,
  run,
  previousRun,
  rows,
  previousRows,
  completeKeys,
  previousCompleteKeys,
  anomalyReportTotalMax,
}) {
  if (!previousRun) return null;
  const currentKeys = filterKeysForState(completeKeys, state);
  const prevKeys = filterKeysForState(previousCompleteKeys, state);
  const commonKeys = new Set([...currentKeys].filter((key) => prevKeys.has(key)));
  const currentCleanRows = rows.filter((row) =>
    commonKeys.has(rtoKey(row)) &&
    row.status === "success" &&
    !criticalAnomaly(row, anomalyReportTotalMax));
  const previousCleanRows = previousRows.filter((row) =>
    commonKeys.has(rtoKey(row)) &&
    row.status === "success" &&
    !criticalAnomaly(row, anomalyReportTotalMax));
  const currentTotals = aggregateTotals(currentCleanRows);
  const previousTotals = aggregateTotals(previousCleanRows);
  const evDelta = currentTotals.ev - previousTotals.ev;
  return {
    previousSnapshotDate: previousRun.snapshotDate,
    comparableRtos: commonKeys.size,
    currentEv: currentTotals.ev,
    previousEv: previousTotals.ev,
    evDelta,
    narrative: `EV MTD changed by ${formatDelta(evDelta)} across ${formatNumber(commonKeys.size)} complete RTOs that were available in both ${previousRun.snapshotDate} and ${run.snapshotDate}.`,
  };
}

function normalizeRun(row = {}) {
  if (!row) return null;
  return {
    id: String(row.id ?? ""),
    snapshotDate: dateText(row.snapshotDate ?? row.snapshot_date),
    targetMonth: row.targetMonth ?? row.target_month ?? null,
    status: String(row.status ?? ""),
    totalRtos: numberValue(row.totalRtos ?? row.total_rtos),
    succeededRtos: numberValue(row.succeededRtos ?? row.succeeded_rtos),
    failedRtos: numberValue(row.failedRtos ?? row.failed_rtos),
    startedAt: dateTimeText(row.startedAt ?? row.started_at),
    completedAt: dateTimeText(row.completedAt ?? row.completed_at),
  };
}

function normalizeConfigRows(rows = []) {
  return rows.map((row) => ({
    state: String(row.state ?? "").trim(),
    rto: String(row.rto ?? "").trim(),
    enabled: row.enabled === undefined ? true : Boolean(row.enabled),
  })).filter((row) => row.state && row.rto && row.enabled);
}

function normalizeReportRows(rows = []) {
  return rows.map((row) => ({
    runId: String(row.runId ?? row.run_id ?? ""),
    state: String(row.state ?? "").trim(),
    rto: String(row.rto ?? "").trim(),
    fuelGroup: String(row.fuelGroup ?? row.fuel_group ?? "").trim(),
    vehicleCategory: String(row.vehicleCategory ?? row.vehicle_category ?? "").trim(),
    status: String(row.status ?? "").trim(),
    reportTotal: reportTotalValue(row.reportTotal ?? row.report_total),
    sourceRowCount: numberValue(row.sourceRowCount ?? row.source_row_count),
    filtersConfirmed: Boolean(row.filtersConfirmed ?? row.filters_confirmed),
    explicitZero: Boolean(row.explicitZero ?? row.explicit_zero),
    scrapedAt: dateTimeText(row.scrapedAt ?? row.scraped_at),
  })).filter((row) => row.state && row.rto && row.fuelGroup && row.vehicleCategory);
}

function completeRtoKeys(rows = []) {
  const combosByRto = new Map();
  for (const row of rows) {
    if (row.status !== "success") continue;
    const key = rtoKey(row);
    if (!combosByRto.has(key)) combosByRto.set(key, new Set());
    combosByRto.get(key).add(`${row.fuelGroup}|${row.vehicleCategory}`);
  }
  const complete = new Set();
  for (const [key, combos] of combosByRto.entries()) {
    if (EXPECTED_DAILY_REPORT_COMBOS.every((combo) => combos.has(combo))) complete.add(key);
  }
  return complete;
}

function aggregateTotals(rows = []) {
  const totals = {
    ev: 0,
    ice: 0,
    byCategory: {
      "2W": { ev: 0, ice: 0 },
      "3W": { ev: 0, ice: 0 },
      "4W": { ev: 0, ice: 0 },
    },
  };
  for (const row of rows) {
    const total = numberValue(row.reportTotal);
    if (row.fuelGroup === "EV") totals.ev += total;
    if (row.fuelGroup === "ICE") totals.ice += total;
    if (totals.byCategory[row.vehicleCategory]) {
      if (row.fuelGroup === "EV") totals.byCategory[row.vehicleCategory].ev += total;
      if (row.fuelGroup === "ICE") totals.byCategory[row.vehicleCategory].ice += total;
    }
  }
  return {
    ...totals,
    combined: totals.ev + totals.ice,
    evSharePct: percent(totals.ev, totals.ev + totals.ice),
  };
}

function categorySplit(totals) {
  return Object.entries(totals.byCategory).map(([category, values]) => ({
    category,
    ev: values.ev,
    ice: values.ice,
    evSharePct: percent(values.ev, values.ev + values.ice),
  }));
}

function rankByState(rows, enabledStateCounts) {
  const groups = new Map();
  for (const row of rows) {
    const group = groupFor(groups, row.state);
    addRowToRankGroup(group, row);
  }
  return [...groups.entries()].map(([state, group]) => ({
    state,
    expectedRtos: enabledStateCounts.get(state) ?? 0,
    completedRtos: group.rtos.size,
    coveragePct: percent(group.rtos.size, enabledStateCounts.get(state) ?? 0),
    ...rankTotals(group),
  })).sort(rankSort);
}

function rankByRto(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = groupFor(groups, row.rto);
    group.state = row.state;
    addRowToRankGroup(group, row);
  }
  return [...groups.entries()].map(([rto, group]) => ({
    rto,
    state: group.state,
    ...rankTotals(group),
  })).sort(rankSort);
}

function groupFor(groups, key) {
  if (!groups.has(key)) {
    groups.set(key, {
      ev: 0,
      ice: 0,
      rtos: new Set(),
    });
  }
  return groups.get(key);
}

function addRowToRankGroup(group, row) {
  if (row.fuelGroup === "EV") group.ev += numberValue(row.reportTotal);
  if (row.fuelGroup === "ICE") group.ice += numberValue(row.reportTotal);
  group.rtos.add(rtoKey(row));
}

function rankTotals(group) {
  return {
    ev: group.ev,
    ice: group.ice,
    combined: group.ev + group.ice,
    evSharePct: percent(group.ev, group.ev + group.ice),
  };
}

function rankSort(a, b) {
  return b.ev - a.ev || b.evSharePct - a.evSharePct || String(a.state ?? a.rto).localeCompare(String(b.state ?? b.rto));
}

function buildWarnings({ scope, label, coveragePct, completedRtos, expectedRtos, anomalies }) {
  const warnings = [];
  if (coveragePct < 100) {
    warnings.push(`${label} report has partial RTO coverage: ${formatNumber(completedRtos)} / ${formatNumber(expectedRtos)} complete RTOs (${formatPercent(coveragePct)}).`);
  }
  if (anomalies.length) {
    warnings.push(`${formatNumber(anomalies.length)} critical anomaly row(s) were excluded from headline totals for this ${scope} report.`);
  }
  return warnings;
}

function sourceNotes(scope, label) {
  const scopeText = scope === "india" ? "India" : label;
  return [
    `${scopeText} totals are month-to-date VAHAN scrape report totals from rto_daily_scrape_reports.report_total.`,
    "Only complete RTOs with all six EV/ICE x 2W/3W/4W report rows are included in headline totals.",
    "Critical anomaly rows are excluded from headline math but preserved in the warnings for review.",
    "This is a local try-run artifact, not an approved published report.",
  ];
}

function criticalAnomaly(row, maxTotal) {
  if (row.status !== "success") return null;
  if (row.reportTotal === null || row.reportTotal === undefined || !Number.isFinite(Number(row.reportTotal))) {
    return anomalyFromRow(row, "missing_report_total");
  }
  if (Number(row.reportTotal) > maxTotal) return anomalyFromRow(row, "report_total_above_sanity_limit");
  if (row.filtersConfirmed !== true) return anomalyFromRow(row, "filters_not_confirmed");
  return null;
}

function anomalyFromRow(row, reason) {
  return {
    reason,
    state: row.state,
    rto: row.rto,
    fuelGroup: row.fuelGroup,
    vehicleCategory: row.vehicleCategory,
    reportTotal: row.reportTotal,
    sourceRowCount: row.sourceRowCount,
    scrapedAt: row.scrapedAt,
  };
}

function countEnabledRtosByState(configs) {
  const counts = new Map();
  for (const row of configs) {
    counts.set(row.state, (counts.get(row.state) ?? 0) + 1);
  }
  return counts;
}

function filterKeysForState(keys, state) {
  if (!state) return new Set(keys);
  return new Set([...keys].filter((key) => keyState(key) === state));
}

function countKeysForState(keys, state) {
  return [...keys].filter((key) => keyState(key) === state).length;
}

function rtoKey(row) {
  return `${row.state}\t${row.rto}`;
}

function keyState(key) {
  return String(key).split("\t", 1)[0];
}

function uniqueCount(values) {
  return new Set(values).size;
}

function sum(values) {
  return values.reduce((total, value) => total + numberValue(value), 0);
}

function percent(part, total) {
  const numerator = numberValue(part);
  const denominator = numberValue(total);
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function reportTotalValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberValue(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function dateText(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dateTimeText(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function formatNumber(value) {
  return NUMBER_FORMAT.format(Math.round(numberValue(value)));
}

function formatDelta(value) {
  const number = Math.round(numberValue(value));
  return `${number > 0 ? "+" : ""}${formatNumber(number)}`;
}

function formatPercent(value) {
  return `${PERCENT_FORMAT.format(numberValue(value))}%`;
}

function statusLabel(status) {
  if (status === "needs_review") return "Needs review";
  if (status === "ready") return "Ready";
  return "Partial";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderCategoryBars(items) {
  const max = Math.max(1, ...items.flatMap((item) => [item.ev, item.ice]));
  return `
    <div class="bars category-bars">
      ${items.map((item) => `
        <div class="bar-group">
          <div class="bar-group-head">
            <strong>${escapeHtml(item.category)}</strong>
            <span>${formatPercent(item.evSharePct)} EV share</span>
          </div>
          <div class="bar-row">
            <span>EV</span>
            <i><b class="ev-fill" style="width:${barWidth(item.ev, max)}%"></b></i>
            <strong>${formatNumber(item.ev)}</strong>
          </div>
          <div class="bar-row">
            <span>ICE</span>
            <i><b class="ice-fill" style="width:${barWidth(item.ice, max)}%"></b></i>
            <strong>${formatNumber(item.ice)}</strong>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderShareDonut(totals) {
  const evShare = Math.max(0, Math.min(100, numberValue(totals.evSharePct)));
  const iceShare = Math.max(0, 100 - evShare);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const evDash = (evShare / 100) * circumference;
  const iceDash = (iceShare / 100) * circumference;
  return `
    <div class="donut-panel">
      <svg class="donut-chart" viewBox="0 0 120 120" role="img" aria-label="EV and ICE month-to-date share">
        <circle class="donut-track" cx="60" cy="60" r="${radius}" />
        <circle class="donut-segment ice" cx="60" cy="60" r="${radius}" stroke-dasharray="${iceDash} ${circumference - iceDash}" stroke-dashoffset="0" />
        <circle class="donut-segment ev" cx="60" cy="60" r="${radius}" stroke-dasharray="${evDash} ${circumference - evDash}" stroke-dashoffset="${-iceDash}" />
        <text x="60" y="55" text-anchor="middle" class="donut-value">${escapeHtml(formatPercent(evShare))}</text>
        <text x="60" y="72" text-anchor="middle" class="donut-label">EV share</text>
      </svg>
      <div class="chart-legend">
        <span><i class="legend-ev"></i>EV ${formatNumber(totals.ev)}</span>
        <span><i class="legend-ice"></i>ICE ${formatNumber(totals.ice)}</span>
      </div>
    </div>
  `;
}

function renderMovementChart(movement) {
  const max = Math.max(1, movement.currentEv, movement.previousEv);
  return `
    <div class="movement-chart" aria-label="Comparable EV movement">
      <div class="movement-row">
        <span>${escapeHtml(movement.previousSnapshotDate)}</span>
        <i><b class="previous-fill" style="width:${barWidth(movement.previousEv, max)}%"></b></i>
        <strong>${formatNumber(movement.previousEv)}</strong>
      </div>
      <div class="movement-row">
        <span>Current</span>
        <i><b class="ev-fill" style="width:${barWidth(movement.currentEv, max)}%"></b></i>
        <strong>${formatNumber(movement.currentEv)}</strong>
      </div>
    </div>
  `;
}

function renderRankSection(title, rows, labelKey) {
  if (!rows.length) return `<section><h2>${escapeHtml(title)}</h2><p>No ranked rows are available.</p></section>`;
  const chartRows = rows.slice(0, 10);
  return `
    <section>
      <h2>${escapeHtml(title)}</h2>
      ${renderRankChart(chartRows, labelKey)}
      <div class="table-wrap">
        <table>
          <thead><tr><th>${labelKey === "state" ? "State" : "RTO"}</th><th>EV MTD</th><th>ICE MTD</th><th>EV share</th>${labelKey === "state" ? "<th>Coverage</th>" : ""}</tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row[labelKey])}</td>
                <td>${formatNumber(row.ev)}</td>
                <td>${formatNumber(row.ice)}</td>
                <td>${formatPercent(row.evSharePct)}</td>
                ${labelKey === "state" ? `<td>${formatNumber(row.completedRtos)} / ${formatNumber(row.expectedRtos)}</td>` : ""}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRankChart(rows, labelKey) {
  const max = Math.max(1, ...rows.map((row) => row.ev));
  return `
    <div class="rank-chart" aria-label="${labelKey === "state" ? "Top states" : "Top RTOs"} by EV MTD">
      ${rows.map((row, index) => {
        const label = row[labelKey];
        return `
          <div class="rank-row">
            <span class="rank-index">${index + 1}</span>
            <span class="rank-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            <i><b style="width:${barWidth(row.ev, max)}%"></b></i>
            <strong>${formatNumber(row.ev)}</strong>
            <small>${formatPercent(row.evSharePct)}</small>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function barWidth(value, max) {
  return Math.max(2, (numberValue(value) / Math.max(1, numberValue(max))) * 100);
}

function renderAnomalyTable(rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Reason</th><th>State</th><th>RTO</th><th>Fuel</th><th>Category</th><th>Total</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.reason)}</td>
              <td>${escapeHtml(row.state)}</td>
              <td>${escapeHtml(row.rto)}</td>
              <td>${escapeHtml(row.fuelGroup)}</td>
              <td>${escapeHtml(row.vehicleCategory)}</td>
              <td>${row.reportTotal === null ? "NA" : formatNumber(row.reportTotal)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function dailyReportCss() {
  return `
    :root { color-scheme: light; font-family: Inter, Segoe UI, Arial, sans-serif; color: #1f2933; background: #f5f7fa; }
    body { margin: 0; background: #f5f7fa; }
    .report { width: min(1080px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 48px; }
    .hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 28px; background: #111827; color: white; border-radius: 8px; }
    .hero p { margin: 0 0 8px; text-transform: uppercase; letter-spacing: .08em; font-size: 12px; color: #a7f3d0; }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 46px); letter-spacing: 0; }
    h2 { margin: 0 0 16px; font-size: 22px; letter-spacing: 0; }
    section { margin-top: 18px; padding: 24px; background: white; border: 1px solid #d9e2ec; border-radius: 8px; box-shadow: 0 10px 30px rgba(15, 23, 42, .06); }
    .status { flex: 0 0 auto; border-radius: 999px; padding: 8px 12px; font-size: 13px; font-weight: 700; color: #111827; background: #e5e7eb; }
    .status.needs_review { background: #fee2e2; color: #991b1b; }
    .status.ready { background: #dcfce7; color: #166534; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
    .metric-grid.compact { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 0; }
    article { padding: 18px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; min-width: 0; }
    article span, article small { display: block; color: #64748b; font-size: 13px; }
    article strong { display: block; margin-top: 6px; font-size: 26px; letter-spacing: 0; overflow-wrap: anywhere; }
    .warning-block { border-color: #fecaca; background: #fff7f7; }
    .warning-block h2 { color: #991b1b; }
    .chart-with-metrics { display: grid; grid-template-columns: 260px 1fr; gap: 18px; align-items: center; }
    .donut-panel { display: grid; gap: 10px; justify-items: center; padding: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
    .donut-chart { width: min(220px, 100%); height: auto; }
    .donut-track { fill: none; stroke: #e2e8f0; stroke-width: 16; }
    .donut-segment { fill: none; stroke-width: 16; transform: rotate(-90deg); transform-origin: 60px 60px; }
    .donut-segment.ev { stroke: #0f766e; }
    .donut-segment.ice { stroke: #94a3b8; }
    .donut-value { font-weight: 800; font-size: 18px; fill: #0f172a; }
    .donut-label { font-size: 10px; fill: #64748b; text-transform: uppercase; letter-spacing: .08em; }
    .chart-legend { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; font-size: 13px; color: #475569; }
    .chart-legend span { display: inline-flex; align-items: center; gap: 6px; }
    .chart-legend i { width: 10px; height: 10px; border-radius: 2px; }
    .legend-ev { background: #0f766e; }
    .legend-ice { background: #94a3b8; }
    .bars { display: grid; gap: 12px; }
    .bar-group { display: grid; gap: 8px; padding: 14px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
    .bar-group-head { display: flex; justify-content: space-between; gap: 12px; color: #475569; }
    .bar-group-head strong { color: #0f172a; }
    .bar-row { display: grid; grid-template-columns: 54px 1fr 120px; gap: 12px; align-items: center; }
    .bar-row i { height: 12px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
    .bar-row b { display: block; height: 100%; background: #0f766e; border-radius: inherit; }
    .bar-row b.ice-fill { background: #94a3b8; }
    .bar-row b.ev-fill { background: #0f766e; }
    .bar-row strong { text-align: right; }
    .bar-row small { color: #64748b; }
    .rank-chart { display: grid; gap: 9px; margin-bottom: 18px; }
    .rank-row { display: grid; grid-template-columns: 34px minmax(120px, 220px) 1fr 110px 70px; gap: 10px; align-items: center; }
    .rank-index { width: 26px; height: 26px; display: inline-grid; place-items: center; border-radius: 999px; background: #ecfeff; color: #155e75; font-weight: 800; font-size: 12px; }
    .rank-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
    .rank-row i, .movement-row i { height: 14px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
    .rank-row b, .movement-row b { display: block; height: 100%; background: #0f766e; border-radius: inherit; }
    .rank-row strong, .movement-row strong { text-align: right; }
    .rank-row small { color: #64748b; }
    .movement-chart { display: grid; gap: 10px; margin: 18px 0; }
    .movement-row { display: grid; grid-template-columns: 120px 1fr 120px; gap: 12px; align-items: center; }
    .movement-row .previous-fill { background: #64748b; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    th { color: #475569; background: #f8fafc; }
    .notes li, .warning-block li { margin: 7px 0; }
    @media (max-width: 760px) {
      .hero { display: block; }
      .status { display: inline-block; margin-top: 14px; }
      .chart-with-metrics { grid-template-columns: 1fr; }
      .metric-grid, .metric-grid.compact { grid-template-columns: 1fr; }
      .bar-row { grid-template-columns: 42px 1fr 90px; }
      .rank-row { grid-template-columns: 30px 1fr; }
      .rank-row i, .rank-row strong, .rank-row small { grid-column: 2; text-align: left; }
      .movement-row { grid-template-columns: 90px 1fr; }
      .movement-row strong { grid-column: 2; text-align: left; }
    }
  `;
}
