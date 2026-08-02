const form = document.querySelector("#monthlyReportForm");
const reportMonth = document.querySelector("#reportMonth");
const reportLocation = document.querySelector("#reportLocation");
const fuelScope = document.querySelector("#fuelScope");
const reportFuel = document.querySelector("#reportFuel");
const loadReportBtn = document.querySelector("#loadReportBtn");
const output = document.querySelector("#monthlyReport");
const pdfLink = document.querySelector("#downloadReportPdf");
const appFrame = document.querySelector(".app-frame");
const sidebarTrigger = document.querySelector("#sidebarTrigger");
const featureSidebar = document.querySelector("#featureSidebar");
const authGate = document.querySelector("#authGate");
const monthlyReportWorkspace = document.querySelector("#monthlyReportWorkspace");
const accountStatus = document.querySelector("#accountStatus");
const logoutBtn = document.querySelector("#logoutBtn");

const fmt = new Intl.NumberFormat("en-IN");
const monthFmt = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });
const shortMonthFmt = new Intl.DateTimeFormat("en", { month: "short", year: "2-digit" });
let currentReport = null;
let refreshPollTimer = null;
let trendDrilldown = null;
let currentUser = null;
let csrfToken = null;
const autoTrendRefreshAttempts = new Set();
const autoOemRefreshAttempts = new Set();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function displayMonth(value) {
  const [year, month] = String(value).split("-").map(Number);
  if (!year || !month) return value ?? "";
  return monthFmt.format(new Date(year, month - 1, 1));
}

function displayShortMonth(value) {
  const [year, month] = String(value).split("-").map(Number);
  if (!year || !month) return value ?? "";
  return shortMonthFmt.format(new Date(year, month - 1, 1)).replace(" ", "-");
}

function displayMonthList(values = []) {
  return values.filter(Boolean).map(displayShortMonth).join(", ");
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "NA";
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(Number(value) * 100)}%`;
}

function formatDelta(value) {
  const number = Math.round(Number(value) || 0);
  return `${number > 0 ? "+" : ""}${fmt.format(number)}`;
}

function formatCoverageCount(loaded, expected) {
  return expected && expected > loaded ? `${fmt.format(loaded)} / ${fmt.format(expected)}` : fmt.format(loaded ?? 0);
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

function compactRefreshMessage(refresh) {
  if (!refresh) return "";
  const progress = refresh.progress;
  if (!progress) return refresh.status ? `Refresh ${refresh.status}.` : "";
  if (progress.states?.some((item) => item.state === "INDIA TOTAL")) {
    const current = progress.currentState ? " Fetching national aggregate." : "";
    return `Fetching all-India VAHAN aggregate for ${displayMonthList(refresh.requiredMonths) || "the selected month"}.${current}`;
  }
  const total = progress.totalStates ?? 0;
  const done = (progress.completedStates ?? 0) + (progress.failedStates ?? 0);
  const current = progress.currentState ? ` Current: ${progress.currentState}.` : "";
  return `Fetching state coverage: ${fmt.format(done)} / ${fmt.format(total)} complete.${current}`;
}

function refreshActionLabel(report = currentReport) {
  return report?.locationScope?.type === "all"
    ? "Refresh all-India aggregate from VAHAN"
    : "Refresh selected location from VAHAN";
}

function queryParams() {
  const params = new URLSearchParams();
  if (reportMonth.value) params.set("month", reportMonth.value);
  if (reportLocation.value.trim()) params.set("location", reportLocation.value.trim());
  params.set("fuelScope", fuelScope.value || "all");
  if (fuelScope.value !== "all" && reportFuel.value.trim()) {
    params.set("fuel", reportFuel.value.trim());
  }
  return params;
}

async function apiJson(url, options = {}) {
  const method = String(options.method ?? "GET").toUpperCase();
  const csrfHeaders = !["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken
    ? { "x-csrf-token": csrfToken }
    : {};
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "content-type": "application/json",
      ...csrfHeaders,
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return body;
}

function setAuthState(user) {
  currentUser = user;
  if (!user) csrfToken = null;
  const authenticated = Boolean(user);
  if (authGate) authGate.hidden = authenticated;
  if (monthlyReportWorkspace) monthlyReportWorkspace.hidden = !authenticated;
  if (logoutBtn) logoutBtn.hidden = !authenticated;
  if (accountStatus) accountStatus.textContent = authenticated ? user.email : "Signed out";
}

function signedOutState(
  title = "Sign in to build a monthly bulletin.",
  message = "Your account keeps generated reports and saved scopes private.",
) {
  return `
    <div class="atlas-prerequisite">
      <span class="panel-kicker">Sign-in required</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
      <a class="secondary-action" href="/auth/google?returnTo=/reports/monthly-sales.html">Sign in with Google</a>
    </div>
  `;
}

async function loadCurrentUser() {
  const body = await apiJson("/api/me");
  csrfToken = body.csrfToken ?? null;
  setAuthState(body.user);
  if (!body.authenticated) {
    output.innerHTML = signedOutState();
  }
  return body.user;
}

function renderMetricGrid(metrics = {}) {
  return `
    <div class="monthly-report-metrics">
      <article><span>Total</span><strong>${fmt.format(metrics.total ?? 0)}</strong></article>
      <article><span>Previous month</span><strong>${fmt.format(metrics.previousTotal ?? 0)}</strong></article>
      <article><span>Change</span><strong>${formatDelta(metrics.delta ?? 0)}</strong></article>
      <article><span>Market share</span><strong>${formatPercent(metrics.marketShare)}</strong></article>
    </div>
  `;
}

function renderBars(items = [], labelKey = "label") {
  const renderableItems = items.filter((item) => item.status !== "missing");
  if (!renderableItems.length) return `<p class="result-empty">No saved data is available for this section.</p>`;
  const sortedItems = [...renderableItems].sort((a, b) => Number(b.count ?? b.currentCount ?? 0) - Number(a.count ?? a.currentCount ?? 0));
  const max = Math.max(1, ...sortedItems.map((item) => Number(item.count ?? item.currentCount ?? 0)));
  const visibleLimit = 10;
  const hiddenCount = Math.max(0, sortedItems.length - visibleLimit);
  return `
    <div class="monthly-report-bars">
      ${sortedItems.map((item, index) => {
        const label = item[labelKey] ?? item.fuelType ?? item.title ?? item.month ?? item.maker ?? "Item";
        const count = Number(item.count ?? item.currentCount ?? 0);
        return `
          <div class="monthly-report-bar${index >= visibleLimit ? " show-more-hidden" : ""}">
            <span>${escapeHtml(labelKey === "month" ? displayMonth(label) : label)}</span>
            <i><b style="width:${Math.max(2, (count / max) * 100)}%"></b></i>
            <strong>${fmt.format(count)}</strong>
          </div>
        `;
      }).join("")}
      ${hiddenCount ? `<button type="button" class="secondary-action chart-show-more" data-chart-show-more data-hidden-count="${hiddenCount}">Show ${fmt.format(hiddenCount)} more</button>` : ""}
    </div>
  `;
}

function renderShareRows(items = []) {
  if (!items.length) return `<p class="result-empty">No share data available.</p>`;
  return `
    <div class="monthly-report-table-wrap">
      <table class="monthly-report-table">
        <thead><tr><th>Label</th><th>Current share</th><th>Current count</th></tr></thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${escapeHtml(item.label)}</td>
              <td>${formatPercent(item.currentShare)}</td>
              <td>${fmt.format(item.currentCount ?? 0)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderOemGroups(groups = []) {
  if (!groups.length) return `<p class="result-empty">No OEM category definitions are configured.</p>`;
  return `
    <div class="monthly-report-oem-groups">
      ${groups.map((group) => `
        <section class="monthly-report-oem-group">
          <div class="monthly-report-oem-head">
            <h3>${escapeHtml(group.title)}</h3>
            <span>${fmt.format(group.total ?? 0)} registrations</span>
          </div>
          ${group.status !== "available" ? `<p class="result-empty">${escapeHtml(group.warning ?? "No complete maker rows are available for this category.")}</p>` : ""}
          <div class="monthly-report-table-wrap">
            <table class="monthly-report-table">
              <thead><tr><th>Brand</th><th>Registrations</th><th>Share</th><th>Matched VAHAN maker labels</th></tr></thead>
              <tbody>
                ${(group.brands ?? []).map((brand) => `
                  <tr>
                    <td>${escapeHtml(brand.name)}</td>
                    <td>${fmt.format(brand.count ?? 0)}</td>
                    <td>${formatPercent(brand.share)}</td>
                    <td>${escapeHtml((brand.matchedMakers ?? []).join(", ") || "Not found")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>
      `).join("")}
    </div>
  `;
}

function selectedTrendItem(items = []) {
  if (!trendDrilldown?.month) return null;
  return items.find((item) => item.month === trendDrilldown.month && item.count !== null && item.count !== undefined) ?? null;
}

function renderFuelPie(items = []) {
  const sortedItems = [...items]
    .filter((item) => Number(item.count || 0) > 0)
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  const total = sortedItems.reduce((sum, item) => sum + Number(item.count || 0), 0);
  if (!total) return `<p class="result-empty">No fuel distribution data available for this month.</p>`;
  const visibleLimit = 7;
  const visibleItems = sortedItems.slice(0, visibleLimit);
  const otherCount = sortedItems.slice(visibleLimit).reduce((sum, item) => sum + Number(item.count || 0), 0);
  const chartItems = otherCount
    ? [...visibleItems, { fuelType: "Other", count: otherCount, share: otherCount / total }]
    : visibleItems;
  const colors = ["#35c28f", "#45a9f2", "#f4c542", "#f97373", "#a78bfa", "#fb923c", "#22d3ee", "#94a3b8"];
  let offset = 0;
  const slices = chartItems.map((item, index) => {
    const value = Number(item.count || 0);
    const dash = (value / total) * 100;
    const label = item.fuelType ?? "Fuel";
    const share = value / total;
    const slice = `
      <g class="trend-pie-slice" tabindex="0" aria-label="${escapeHtml(`${label}: ${fmt.format(value)} (${formatPercent(share)})`)}">
        <title>${escapeHtml(`${label}: ${fmt.format(value)} (${formatPercent(share)})`)}</title>
        <circle r="15.9155" cx="26" cy="26" fill="transparent" stroke="${colors[index % colors.length]}" stroke-width="8" stroke-dasharray="${dash} ${100 - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 26 26)" />
        <g class="trend-pie-tooltip" pointer-events="none">
          <rect x="4" y="3" width="44" height="12" rx="2" />
          <text x="6" y="8">${escapeHtml(label.length > 16 ? `${label.slice(0, 15)}...` : label)}</text>
          <text x="6" y="13">${escapeHtml(`${fmt.format(value)} | ${formatPercent(share)}`)}</text>
        </g>
      </g>`;
    offset += dash;
    return slice;
  }).join("");
  return `
    <div class="trend-drilldown-pie">
      <svg viewBox="0 0 52 52" role="img" aria-label="Fuel distribution pie chart">
        ${slices}
        <circle class="trend-pie-hole" r="10.5" cx="26" cy="26" />
      </svg>
      <div class="trend-drilldown-legend">
        ${chartItems.map((item, index) => {
          const value = Number(item.count || 0);
          return `
          <div>
            <i style="background:${colors[index % colors.length]}"></i>
            <span>${escapeHtml(item.fuelType)}</span>
            <strong>${formatPercent(value / total)}</strong>
          </div>
        `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderFuelVerticalBars(items = []) {
  const sortedItems = [...items].sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  if (!sortedItems.length) return `<p class="result-empty">No fuel distribution data available for this month.</p>`;
  const max = Math.max(1, ...sortedItems.map((item) => Number(item.count || 0)));
  const visibleLimit = 10;
  const hiddenCount = Math.max(0, sortedItems.length - visibleLimit);
  return `
    <div class="trend-vertical-bars">
      ${sortedItems.map((item, index) => {
        const count = Number(item.count || 0);
        return `
          <div class="trend-vertical-bar${index >= visibleLimit ? " show-more-hidden" : ""}">
            <strong>${fmt.format(count)}</strong>
            <i><b style="height:${Math.max(3, (count / max) * 100)}%"></b></i>
            <span title="${escapeHtml(item.fuelType)}">${escapeHtml(item.fuelType)}</span>
          </div>
        `;
      }).join("")}
      ${hiddenCount ? `<button type="button" class="secondary-action chart-show-more trend-show-more" data-chart-show-more data-hidden-count="${hiddenCount}">Show ${fmt.format(hiddenCount)} more</button>` : ""}
    </div>
  `;
}

function renderTrendFuelDrilldown(item) {
  const view = trendDrilldown?.view === "pie" ? "pie" : "bar";
  const fuelMix = item.fuelMix ?? [];
  return `
    <div class="trend-drilldown" data-month="${escapeHtml(item.month)}">
      <div class="trend-drilldown-head">
        <div>
          <p class="eyebrow">Fuel distribution</p>
          <h3>${escapeHtml(displayMonth(item.month))}</h3>
          <span>${fmt.format(item.count ?? 0)} registrations</span>
        </div>
        <div class="trend-drilldown-actions">
          <div class="chart-toggle" role="group" aria-label="Fuel distribution chart type">
            <button type="button" class="${view === "bar" ? "active" : ""}" data-trend-view="bar">Bar</button>
            <button type="button" class="${view === "pie" ? "active" : ""}" data-trend-view="pie">Pie</button>
          </div>
          <button type="button" class="secondary-action compact-action" data-trend-back>Back</button>
        </div>
      </div>
      <div class="trend-drilldown-chart">
        ${view === "pie" ? renderFuelPie(fuelMix) : renderFuelVerticalBars(fuelMix)}
      </div>
    </div>
  `;
}

function renderTrendLineChart(items = []) {
  if (!items.length) return `<p class="result-empty">No trend data available.</p>`;
  const drilldownItem = selectedTrendItem(items);
  if (drilldownItem) return renderTrendFuelDrilldown(drilldownItem);
  const width = 920;
  const height = 360;
  const margin = { top: 24, right: 34, bottom: 52, left: 84 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const validItems = items.filter((item) => item.count !== null && item.count !== undefined);
  const max = niceChartMax(Math.max(1, ...validItems.map((item) => Number(item.count || 0))));
  const points = items.map((item, index) => {
    const x = margin.left + (items.length === 1 ? chartWidth / 2 : (index / (items.length - 1)) * chartWidth);
    const hasCount = item.count !== null && item.count !== undefined;
    const y = hasCount ? margin.top + chartHeight - (Number(item.count || 0) / max) * chartHeight : margin.top + chartHeight;
    return { x: Math.round(x), y: Math.round(y), item, hasCount };
  });
  const countPoints = points.filter((point) => point.hasCount);
  const linePath = smoothPath(countPoints);
  const areaPath = countPoints.length
    ? `${linePath} L ${countPoints.at(-1).x} ${margin.top + chartHeight} L ${countPoints[0].x} ${margin.top + chartHeight} Z`
    : "";
  const yTicks = Array.from({ length: 6 }, (_, index) => {
    const value = Math.round((max / 5) * index);
    const y = margin.top + chartHeight - (value / max) * chartHeight;
    return { value, y: Math.round(y) };
  }).reverse();

  return `
    <div class="monthly-report-trend">
      <div class="monthly-report-line-wrap" aria-label="12-month trend chart">
        <svg class="monthly-report-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Total registrations over 12 months">
          <defs>
            <linearGradient id="monthlyTrendLine" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stop-color="#35c28f" />
              <stop offset="100%" stop-color="#45a9f2" />
            </linearGradient>
            <linearGradient id="monthlyTrendArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="#45a9f2" stop-opacity="0.22" />
              <stop offset="100%" stop-color="#35c28f" stop-opacity="0.02" />
            </linearGradient>
          </defs>
          <rect class="trend-chart-bg" x="${margin.left}" y="${margin.top}" width="${chartWidth}" height="${chartHeight}" />
          ${yTicks.map((tick) => `
            <line class="trend-grid-line" x1="${margin.left}" x2="${margin.left + chartWidth}" y1="${tick.y}" y2="${tick.y}" />
            <text class="trend-y-label" x="${margin.left - 12}" y="${tick.y + 4}">${fmt.format(tick.value)}</text>
          `).join("")}
          <line class="trend-axis" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${margin.top + chartHeight}" />
          <line class="trend-axis" x1="${margin.left}" x2="${margin.left + chartWidth}" y1="${margin.top + chartHeight}" y2="${margin.top + chartHeight}" />
          ${areaPath ? `<path class="trend-area-path" d="${areaPath}" />` : ""}
          ${linePath ? `<path class="trend-line-path" d="${linePath}" />` : ""}
          ${points.map((point) => {
            const tooltipWidth = 156;
            const tooltipHeight = 38;
            const tooltipX = Math.min(width - tooltipWidth - 10, Math.max(10, point.x - (tooltipWidth / 2)));
            const tooltipY = Math.max(10, point.y - tooltipHeight - 14);
            const monthLabel = displayMonth(point.item.month);
            const valueLabel = point.hasCount ? fmt.format(point.item.count) : "Pending";
            return `
            <g class="trend-point-group"${point.hasCount ? ` tabindex="0" role="button" data-trend-month="${escapeHtml(point.item.month)}" aria-label="${escapeHtml(`${monthLabel}: ${valueLabel}. Click to view fuel distribution.`)}"` : ""}>
              ${point.hasCount ? `<title>${escapeHtml(`${monthLabel}: ${valueLabel}`)}</title>
              <circle class="trend-point-hit" cx="${point.x}" cy="${point.y}" r="16" />
              <circle class="trend-point-halo" cx="${point.x}" cy="${point.y}" r="7" />
              <circle class="trend-point" cx="${point.x}" cy="${point.y}" r="4" />
              <g class="trend-point-tooltip" pointer-events="none">
                <rect x="${tooltipX}" y="${tooltipY}" width="${tooltipWidth}" height="${tooltipHeight}" rx="8" />
                <text class="trend-point-tooltip-month" x="${tooltipX + 11}" y="${tooltipY + 15}">${escapeHtml(displayShortMonth(point.item.month))}</text>
                <text class="trend-point-tooltip-value" x="${tooltipX + 11}" y="${tooltipY + 31}">${escapeHtml(valueLabel)}</text>
              </g>` : ""}
              <text class="trend-x-label" x="${point.x}" y="${margin.top + chartHeight + 28}">${escapeHtml(displayShortMonth(point.item.month))}</text>
            </g>
          `;
          }).join("")}
        </svg>
      </div>
      <div class="monthly-report-trend-table-wrap">
        <table class="monthly-report-trend-table">
          <thead>
            <tr><th>Series</th>${items.map((item) => `<th>${escapeHtml(displayShortMonth(item.month))}</th>`).join("")}</tr>
          </thead>
          <tbody>
            <tr><th>Total</th>${items.map((item) => `<td>${item.count === null || item.count === undefined ? "Pending" : fmt.format(item.count)}</td>`).join("")}</tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderSection(section) {
  let body = "";
  if (section.id === "overview") {
    body = renderMetricGrid(section.metrics);
  } else if (section.id === "twelve_month_trend") {
    body = `<div class="monthly-report-trend-container">${renderTrendLineChart(section.chartData)}</div>`;
  } else if (section.id === "share_trend") {
    body = renderShareRows(section.chartData);
  } else if (section.id === "oem_leaders" || section.chartType === "grouped-table") {
    body = renderOemGroups(section.chartData);
  } else {
    body = renderBars(section.chartData, section.id === "fuel_mix" ? "fuelType" : "title");
  }

  const warnings = section.warnings?.length
    ? `<div class="monthly-report-section-warning">${section.warnings.map(escapeHtml).join("<br>")}</div>`
    : "";

  return `
    <article class="panel monthly-report-section" id="section-${escapeHtml(section.id)}">
      <div class="panel-head">
        <div>
          <p class="eyebrow">${escapeHtml(section.chartType ?? "section")}</p>
          <h2>${escapeHtml(section.title)}</h2>
        </div>
      </div>
      <p class="monthly-report-narrative">${escapeHtml(section.narrative ?? "")}</p>
      ${body}
      ${warnings}
    </article>
  `;
}

function trendSectionItems() {
  return currentReport?.sections?.find((section) => section.id === "twelve_month_trend")?.chartData ?? [];
}

function updateTrendSection() {
  const container = document.querySelector("#section-twelve_month_trend .monthly-report-trend-container");
  if (!container) return;
  container.innerHTML = renderTrendLineChart(trendSectionItems());
}

function missingOemGroups(report = currentReport) {
  const section = report?.sections?.find((item) => item.id === "oem_leaders");
  return (section?.chartData ?? []).filter((group) => group.status !== "available");
}

function autoRefreshKey(report = currentReport) {
  return [
    report?.period?.month ?? "",
    report?.locationScope?.query ?? report?.locationScope?.label ?? "all",
    report?.fuelSelection?.scope ?? "all",
    report?.fuelSelection?.fuel ?? "",
  ].join("|");
}

function renderCoverageAction(report) {
  const missingCount = report.coverage.missingStates?.length ?? 0;
  const pendingTrendMonths = report.coverage.trendPendingMonths ?? [];
  const missingOem = missingOemGroups(report);
  const partial = !report.coverage.completeStateCoverage;
  const hasPendingTrend = pendingTrendMonths.length > 0;
  const hasMissingOem = missingOem.length > 0;
  return `
    <section class="panel monthly-report-section" id="reportRefreshPanel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Coverage</p>
          <h2>${hasPendingTrend ? "Fetch pending 12-month trend" : hasMissingOem ? "Fetch incomplete OEM category rows" : partial ? "Refresh missing coverage" : "Refresh VAHAN counts"}</h2>
        </div>
      </div>
      <p class="monthly-report-narrative">${hasPendingTrend
        ? `The all-fuel 12-month trend has ${fmt.format(pendingTrendMonths.length)} pending month(s): ${pendingTrendMonths.map(displayShortMonth).join(", ")}. Click the button to fetch all-states aggregate rows from VAHAN.`
        : hasMissingOem
        ? `OEM maker rows are incomplete for ${missingOem.map((group) => group.title).join(", ")}. Click the button to fetch maker data with the matching category filters.`
        : partial
        ? `This report month has ${formatCoverageCount(report.coverage.states, report.coverage.expectedStates)} expected states loaded${missingCount ? `, with ${fmt.format(missingCount)} still missing` : ""}.`
        : "Saved rows can drift from the live VAHAN table. Re-sync this month from the matching VAHAN location scope."}</p>
      ${currentUser?.role === "admin"
        ? `<button type="button" class="secondary-action" id="refreshReportCoverage">${hasPendingTrend ? "Fetch pending trend months" : hasMissingOem ? "Fetch OEM category rows" : refreshActionLabel(report)}</button>`
        : `<p class="result-empty">An administrator can refresh live VAHAN coverage. This report remains read-only for your account.</p>`}
      <p class="result-empty" id="reportRefreshStatus"></p>
    </section>
  `;
}

function renderReport(report) {
  currentReport = report;
  reportMonth.value = report.period.month;
  reportLocation.value = report.locationScope?.query ?? "";
  const params = queryParams();
  pdfLink.href = `/api/reports/monthly-sales/pdf?${params.toString()}`;
  pdfLink.removeAttribute("aria-disabled");

  output.innerHTML = `
    <section class="monthly-report-hero panel">
      <div>
        <p class="eyebrow">Generated report</p>
        <h1>${escapeHtml(report.title)}</h1>
        <p>${escapeHtml(report.source.label)}. Latest loaded month: ${escapeHtml(report.source.latestLoadedMonth ?? "not available")}.</p>
      </div>
      <div class="monthly-report-coverage">
        <span>${escapeHtml(report.locationScope?.label ?? "All India")}</span>
        <span>${formatCoverageCount(report.coverage.states, report.coverage.expectedStates)} states</span>
        <span>${fmt.format(report.coverage.currentScopeRows)} matching rows</span>
        <span>${fmt.format(report.coverage.categorySectionsAvailable)} / ${fmt.format(report.coverage.categorySectionsTotal)} segment sections</span>
      </div>
    </section>
    ${renderCoverageAction(report)}
    ${report.sections.map(renderSection).join("")}
    <section class="panel monthly-report-section">
      <div class="panel-head"><h2>Data notes</h2></div>
      <ul class="monthly-report-notes">
        ${report.dataNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
      </ul>
    </section>
  `;

  if (report.liveRefresh?.jobId) {
    setRefreshStatus(compactRefreshMessage(report.liveRefresh) || "Refreshing recent VAHAN data...");
    pollReportRefresh(report.liveRefresh.jobId).catch((error) => setRefreshStatus(error.message));
  } else if (report.coverage?.trendPendingMonths?.length && !autoTrendRefreshAttempts.has(report.period.month)) {
    autoTrendRefreshAttempts.add(report.period.month);
    setRefreshStatus("Pending trend months found. Starting VAHAN fetch...");
    setTimeout(() => {
      startReportRefresh({ automatic: true }).catch((error) => setRefreshStatus(error.message));
    }, 250);
  } else if (missingOemGroups(report).length && !autoOemRefreshAttempts.has(autoRefreshKey(report))) {
    autoOemRefreshAttempts.add(autoRefreshKey(report));
    setRefreshStatus("Incomplete OEM category rows found. Starting VAHAN maker fetch...");
    setTimeout(() => {
      startReportRefresh({ automatic: true }).catch((error) => setRefreshStatus(error.message));
    }, 250);
  }
}

function setRefreshStatus(message) {
  const status = document.querySelector("#reportRefreshStatus");
  if (status) status.textContent = message ?? "";
}

async function pollReportRefresh(jobId) {
  const body = await apiJson(`/api/map-refresh/${encodeURIComponent(jobId)}`);
  const refreshInfo = body.liveRefresh;
  setRefreshStatus(compactRefreshMessage(refreshInfo));
  if (refreshInfo?.status === "pending") {
    refreshPollTimer = setTimeout(() => {
      pollReportRefresh(jobId).catch((error) => setRefreshStatus(error.message));
    }, 2500);
    return;
  }
  if (refreshInfo?.status === "failed") {
    setRefreshStatus(refreshInfo.error || "VAHAN refresh failed. The report is still showing saved rows.");
    return;
  }
  setRefreshStatus("Missing states fetched. Reloading report...");
  await loadReport({ autoRefresh: false });
}

async function startReportRefresh({ automatic = false } = {}) {
  const refreshMonth = reportMonth.value || currentReport?.period?.month;
  if (!refreshMonth) return;
  clearTimeout(refreshPollTimer);
  const button = document.querySelector("#refreshReportCoverage");
  if (button) {
    button.disabled = true;
    button.textContent = "Fetching...";
  }
  const hasMissingOem = missingOemGroups().length > 0;
  const fetchLabel = hasMissingOem ? "OEM category maker rows" : "trend coverage";
  setRefreshStatus(`${automatic ? "Auto-starting" : "Starting"} VAHAN fetch for ${displayMonth(refreshMonth)} ${fetchLabel}...`);
  try {
    const response = await fetch("/api/reports/monthly-sales/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      },
      body: JSON.stringify({
        month: refreshMonth,
        location: currentReport?.locationScope?.query ?? null,
        fuelScope: currentReport?.fuelSelection?.scope ?? "all",
        fuel: currentReport?.fuelSelection?.fuel ?? null,
        force: true,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not start VAHAN refresh.");
    const refresh = body.refresh;
    setRefreshStatus(body.message || compactRefreshMessage(refresh));
    if (refresh?.jobId) {
      await pollReportRefresh(refresh.jobId);
    } else {
      await loadReport({ autoRefresh: false });
    }
  } catch (error) {
    setRefreshStatus(error.message);
    if (button) {
      button.disabled = false;
      button.textContent = refreshActionLabel();
    }
  }
}

async function loadReport({ autoRefresh = false } = {}) {
  clearTimeout(refreshPollTimer);
  trendDrilldown = null;
  const params = queryParams();
  params.set("autoRefresh", autoRefresh ? "1" : "0");
  output.innerHTML = `<p class="result-empty">Generating monthly report...</p>`;
  loadReportBtn.disabled = true;
  loadReportBtn.textContent = "Generating...";
  try {
    const response = await fetch(`/api/reports/monthly-sales?${params.toString()}`, {
      credentials: "same-origin",
    });
    const report = await response.json();
    if (!response.ok) throw new Error(report.error ?? `Report failed: ${response.status}`);
    renderReport(report);
  } catch (error) {
    output.innerHTML = `<p class="result-empty">${escapeHtml(error.message)}</p>`;
    pdfLink.href = "#";
    pdfLink.setAttribute("aria-disabled", "true");
  } finally {
    loadReportBtn.disabled = false;
    loadReportBtn.textContent = "Generate report";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadReport();
});

output.addEventListener("click", (event) => {
  if (event.target?.id === "refreshReportCoverage") {
    startReportRefresh();
    return;
  }
  const showMoreButton = event.target.closest?.("[data-chart-show-more]");
  if (showMoreButton) {
    const chart = showMoreButton.closest(".monthly-report-bars, .trend-vertical-bars");
    const expanded = chart?.classList.toggle("show-more-expanded");
    const hiddenCount = Number(showMoreButton.dataset.hiddenCount || 0);
    showMoreButton.textContent = expanded ? "Show less" : `Show ${fmt.format(hiddenCount)} more`;
    return;
  }
  const point = event.target.closest?.("[data-trend-month]");
  if (point) {
    trendDrilldown = { month: point.dataset.trendMonth, view: "bar" };
    updateTrendSection();
    return;
  }
  const viewButton = event.target.closest?.("[data-trend-view]");
  if (viewButton && trendDrilldown) {
    trendDrilldown = { ...trendDrilldown, view: viewButton.dataset.trendView };
    updateTrendSection();
    return;
  }
  if (event.target.closest?.("[data-trend-back]")) {
    trendDrilldown = null;
    updateTrendSection();
  }
});

output.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const point = event.target.closest?.("[data-trend-month]");
  if (!point) return;
  event.preventDefault();
  trendDrilldown = { month: point.dataset.trendMonth, view: "bar" };
  updateTrendSection();
});

logoutBtn?.addEventListener("click", async () => {
  await apiJson("/auth/logout", { method: "POST" });
  csrfToken = null;
  setAuthState(null);
  pdfLink.href = "#";
  pdfLink.setAttribute("aria-disabled", "true");
  output.innerHTML = signedOutState();
});

fuelScope.addEventListener("change", () => {
  const needsFuel = fuelScope.value !== "all";
  reportFuel.disabled = !needsFuel;
  if (!needsFuel) reportFuel.value = "";
});

if (appFrame && sidebarTrigger && featureSidebar) {
  let closeSidebarTimer = null;
  const openSidebar = () => {
    clearTimeout(closeSidebarTimer);
    appFrame.classList.add("sidebar-open");
    sidebarTrigger.setAttribute("aria-expanded", "true");
  };
  const closeSidebar = () => {
    closeSidebarTimer = setTimeout(() => {
      if (sidebarTrigger.matches(":hover, :focus-visible") || featureSidebar.matches(":hover") || featureSidebar.contains(document.activeElement)) return;
      appFrame.classList.remove("sidebar-open");
      sidebarTrigger.setAttribute("aria-expanded", "false");
    }, 120);
  };
  sidebarTrigger.setAttribute("aria-haspopup", "true");
  sidebarTrigger.setAttribute("aria-expanded", "false");
  sidebarTrigger.addEventListener("mouseenter", openSidebar);
  sidebarTrigger.addEventListener("focus", openSidebar);
  sidebarTrigger.addEventListener("mouseleave", closeSidebar);
  sidebarTrigger.addEventListener("blur", closeSidebar);
  featureSidebar.addEventListener("mouseenter", openSidebar);
  featureSidebar.addEventListener("mouseleave", closeSidebar);
}

fuelScope.dispatchEvent(new Event("change"));
loadCurrentUser()
  .then((user) => {
    if (user) return loadReport();
    return null;
  })
  .catch((error) => {
    console.error("Monthly report session check failed.", error);
    setAuthState(null);
    output.innerHTML = signedOutState(
      "The report session could not be checked.",
      "Reload the page, then sign in before generating a report.",
    );
  });
