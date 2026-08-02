const fmt = new Intl.NumberFormat("en-IN");

const modeHelp = document.querySelector("#modeHelp");
const compareHint = document.querySelector("#compareHint");
const compareForm = document.querySelector("#compareForm");
const compareBtn = document.querySelector("#compareBtn");
const leftQuery = document.querySelector("#leftQuery");
const rightQuery = document.querySelector("#rightQuery");
const monthModeBtn = document.querySelector("#monthMode");
const locationModeBtn = document.querySelector("#locationMode");
const deltaSummary = document.querySelector("#deltaSummary");
const leftResultMeta = document.querySelector("#leftResultMeta");
const rightResultMeta = document.querySelector("#rightResultMeta");
const verticalBarChart = document.querySelector("#verticalBarChart");
const doubleBarChart = document.querySelector("#doubleBarChart");
const appFrame = document.querySelector(".app-frame");
const sidebarTrigger = document.querySelector("#sidebarTrigger");
const featureSidebar = document.querySelector("#featureSidebar");

const modeConfig = {
  month: {
    help: "Use the same state or RTO in both queries and change only the month or date range.",
    hint: "Example: compare Maharashtra fork lift diesel registrations for Jan 2024 and Feb 2024.",
    left: "Light Motor Vehicle registrations in Maharashtra in Jan 2026",
    right: "light motor vehicle registrations in Maharashtra in Feb 2026",
  },
  location: {
    help: "Use two different states or RTOs for the same month, so the location difference is obvious.",
    hint: "Example: compare e-rickshaw registrations in Delhi and Haryana for Jan 2025.",
    left: "e-rickshaw registrations in Delhi from Jan 2025 to Jan 2025",
    right: "e-rickshaw registrations in Haryana from Jan 2025 to Jan 2025",
  },
};

let currentMode = "month";
let leftDirty = false;
let rightDirty = false;
let activeCompareRun = 0;

function setText(id, value) {
  const el = document.querySelector(`#${id}`);
  if (el) el.textContent = value;
}

function resetSide(prefix, query, status = "Waiting") {
  const statusEl = document.querySelector(`#${prefix}Status`);
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.className = "status-pill";
  }
  setText(`${prefix}QueryLabel`, query || `${prefix === "left" ? "Left" : "Right"} query`);
  setText(`${prefix}ResultMeta`, "");
  setText(`${prefix}Total`, "-");
  setText(`${prefix}Average`, "-");
  setText(`${prefix}Peak`, "-");
  setText(`${prefix}Rows`, "-");
  const warningsEl = document.querySelector(`#${prefix}Warnings`);
  if (warningsEl) {
    warningsEl.hidden = true;
    warningsEl.innerHTML = "";
  }
  renderBars(`#${prefix}Trend`, [], "Run this query to see its monthly trend.");
  renderFuel(`#${prefix}Fuel`, [], "Run this query to see its fuel breakdown.");
}

function resetCompareState(message = "Run two queries to see the difference in totals, average, and peak month.") {
  deltaSummary.textContent = message;
  verticalBarChart.innerHTML = '<p class="compare-empty">Run two queries to compare monthly totals as vertical bars.</p>';
  doubleBarChart.innerHTML = '<p class="compare-empty">Run two queries to compare monthly totals side by side.</p>';
  resetSide("left", leftQuery.value.trim());
  resetSide("right", rightQuery.value.trim());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function extractBracketMeta(query) {
  const match = query.match(/in\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+)/i);
  if (!match) return "";
  const [, location, from, to] = match;
  return ` [${location.trim()} | ${from.trim()} - ${to.trim()}]`;
}

function extractQueryLocation(query) {
  const match = query.match(/in\s+(.+?)\s+from\s+.+?\s+to\s+.+/i);
  return match ? match[1].trim() : "";
}

function queryLabel(baseLabel, query) {
  const location = extractQueryLocation(query);
  return location ? `${baseLabel} (${location})` : baseLabel;
}

function setMode(nextMode) {
  activeCompareRun += 1;
  currentMode = nextMode;
  monthModeBtn.classList.toggle("active", nextMode === "month");
  locationModeBtn.classList.toggle("active", nextMode === "location");
  monthModeBtn.setAttribute("aria-pressed", String(nextMode === "month"));
  locationModeBtn.setAttribute("aria-pressed", String(nextMode === "location"));
  modeHelp.textContent = modeConfig[nextMode].help;
  compareHint.textContent = modeConfig[nextMode].hint;
  leftQuery.placeholder = modeConfig[nextMode].left;
  rightQuery.placeholder = modeConfig[nextMode].right;
  if (!leftDirty) leftQuery.value = modeConfig[nextMode].left;
  if (!rightDirty) rightQuery.value = modeConfig[nextMode].right;
  resetCompareState("Press Compare to run this view.");
}

function formatChange(value) {
  if (value === null) return "n/a";
  return `${value > 0 ? "+" : ""}${fmt.format(value)}`;
}

function formatPct(value) {
  if (value === null) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function displayMonthList(items) {
  return (items ?? []).join(", ");
}

function dataWarnings(data) {
  const statusMessages = {
    fetch_failed: "Fresh data could not be fetched, and no saved rows matched this query.",
    stale: "Showing saved data because live VAHAN refresh failed.",
    refreshing: `Showing saved data while VAHAN refresh runs for ${displayMonthList(data.liveRefresh?.requiredMonths) || "the requested months"}.`,
    partial: "Some requested months are missing from saved data.",
    missing: "No saved rows cover the requested months yet.",
    live: "Fresh VAHAN rows are displayed while they are saved.",
  };
  const scraperMessage = data.scraper?.failedRuns?.length
    ? `Live VAHAN fetch failed for ${data.scraper.failedRuns.length} run(s).`
    : null;
  return [
    ...new Set(
      [statusMessages[data.dataStatus], scraperMessage, ...(data.warnings ?? [])]
        .filter(Boolean)
        .filter((message) => !/(decode.*failed.*fallback|gemini.*decode.*failed)/i.test(message)),
    ),
  ];
}

function statusLabel(data) {
  if (data.liveRefresh?.status === "pending") return "Refreshing";
  if (data.dataStatus === "fetch_failed") return "Fetch failed";
  if (data.dataStatus === "stale") return "Stale";
  if (data.dataStatus === "partial") return "Partial";
  if (data.dataStatus === "missing") return "Missing";
  if (data.dataStatus === "live") return "Live";
  return "Loaded";
}

function statusClass(data) {
  if (data.liveRefresh?.status === "pending") return "pending";
  if (["fetch_failed", "missing"].includes(data.dataStatus)) return "error";
  if (["stale", "partial"].includes(data.dataStatus)) return "warning";
  if (data.dataStatus === "live") return "success";
  return "ready";
}

function renderSideWarnings(prefix, data) {
  const el = document.querySelector(`#${prefix}Warnings`);
  if (!el) return;
  const warnings = dataWarnings(data);
  el.hidden = warnings.length === 0;
  el.innerHTML = warnings.map((item) => `<div>${escapeHtml(item)}</div>`).join("");
}

function renderBars(target, items, emptyText) {
  const el = document.querySelector(target);
  if (!items.length) {
    el.innerHTML = `<p class="compare-empty">${emptyText}</p>`;
    return;
  }
  if (items.length === 1) {
    const item = items[0];
    el.innerHTML = `
      <div class="single-trend">
        <span>${escapeHtml(item.month ?? item.fuelType)}</span>
        <strong>${fmt.format(item.count)}</strong>
      </div>
    `;
    return;
  }
  const max = Math.max(1, ...items.map((item) => item.count));
  el.innerHTML = items
    .map(
      (item) => `
        <div class="bar">
          <span>${escapeHtml(item.month ?? item.fuelType)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(item.count / max) * 100}%"></span></span>
          <strong>${fmt.format(item.count)}</strong>
        </div>
      `,
    )
    .join("");
}

function renderFuel(target, items, emptyText) {
  const el = document.querySelector(target);
  if (!items.length) {
    el.innerHTML = `<p class="compare-empty">${emptyText}</p>`;
    return;
  }
  el.innerHTML = items
    .map(
      (item) => `
        <div class="fuel-item">
          <span>${escapeHtml(item.fuelType)}</span>
          <strong>${fmt.format(item.count)}</strong>
        </div>
      `,
    )
    .join("");
}

function renderDoubleBars(leftData, rightData, leftQueryText = "", rightQueryText = "") {
  const leftTrend = new Map(leftData.trend.map((item) => [item.month, item.count]));
  const rightTrend = new Map(rightData.trend.map((item) => [item.month, item.count]));
  const months = [...new Set([...leftTrend.keys(), ...rightTrend.keys()])].sort((a, b) => a.localeCompare(b));
  const leftLabel = queryLabel("Left query", leftQueryText);
  const rightLabel = queryLabel("Right query", rightQueryText);

  if (!months.length) {
    verticalBarChart.innerHTML = '<p class="compare-empty">No monthly comparison data is available for these queries.</p>';
    doubleBarChart.innerHTML = '<p class="compare-empty">No monthly comparison data is available for these queries.</p>';
    return;
  }

  const max = Math.max(
    1,
    ...months.flatMap((month) => [leftTrend.get(month), rightTrend.get(month)].filter((value) => value !== undefined)),
  );

  const leftTotal = leftData.summary.total ?? 0;
  const rightTotal = rightData.summary.total ?? 0;
  const combinedTotal = leftTotal + rightTotal;
  const leftPercent = combinedTotal ? (leftTotal / combinedTotal) * 100 : 0;
  const rightPercent = combinedTotal ? 100 - leftPercent : 0;
  const horizontalObservedBar = (trend, month, side) => {
    if (!trend.has(month)) {
      return `
        <div class="double-bar-pair missing">
          <div class="double-bar-track" aria-label="${side} query not fetched for ${escapeHtml(month)}"></div>
          <strong>n/a</strong>
        </div>
      `;
    }
    const width = (trend.get(month) / max) * 100;
    return `
      <div class="double-bar-pair">
        <div class="double-bar-track">
          <span class="double-bar-fill ${side}" style="width:${width}%"></span>
        </div>
        <strong>${fmt.format(trend.get(month))}</strong>
      </div>
    `;
  };

  verticalBarChart.innerHTML = `
    <div class="donut-compare" role="img" aria-label="Total registrations split between left and right query">
      <div
        class="donut-compare-chart"
        style="--left-share:${leftPercent.toFixed(2)}%"
        aria-hidden="true"
      >
        <div class="donut-compare-center">
          <span>Total</span>
          <strong>${fmt.format(combinedTotal)}</strong>
        </div>
      </div>
      <div class="donut-compare-metrics">
        <div class="donut-compare-item">
          <span><i class="legend-swatch left"></i>${escapeHtml(leftLabel)}</span>
          <strong>${fmt.format(leftTotal)}</strong>
          <em>${leftPercent.toFixed(1)}%</em>
        </div>
        <div class="donut-compare-item">
          <span><i class="legend-swatch right"></i>${escapeHtml(rightLabel)}</span>
          <strong>${fmt.format(rightTotal)}</strong>
          <em>${rightPercent.toFixed(1)}%</em>
        </div>
      </div>
    </div>
  `;

  doubleBarChart.innerHTML = `
    <div class="normal-chart-label">Normal form representation</div>
    <div class="double-bar-legend">
      <span><i class="legend-swatch left"></i>${escapeHtml(leftLabel)}</span>
      <span><i class="legend-swatch right"></i>${escapeHtml(rightLabel)}</span>
    </div>
    <div class="double-bar-list">
      ${months
        .map((month) => {
          return `
            <div class="double-bar-row">
              <div class="double-bar-label">${escapeHtml(month)}</div>
              ${horizontalObservedBar(leftTrend, month, "left")}
              ${horizontalObservedBar(rightTrend, month, "right")}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSide(prefix, query, data, status = statusLabel(data)) {
  const statusEl = document.querySelector(`#${prefix}Status`);
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.className = `status-pill ${statusClass(data)}`;
  }
  setText(`${prefix}QueryLabel`, query);
  setText(`${prefix}ResultMeta`, extractBracketMeta(query));
  setText(`${prefix}Total`, fmt.format(data.summary.total));
  setText(`${prefix}Average`, fmt.format(data.summary.monthlyAverage));
  setText(`${prefix}Peak`, data.summary.peakMonth ? `${data.summary.peakMonth}` : "-");
  setText(`${prefix}Rows`, fmt.format(data.rows.length));
  renderSideWarnings(prefix, data);
  const emptyText = data.dataStatus === "fetch_failed"
    ? "Could not fetch fresh data for this query."
    : "No monthly trend for this query.";
  renderBars(`#${prefix}Trend`, data.trend, emptyText);
  renderFuel(`#${prefix}Fuel`, data.fuelBreakdown, data.dataStatus === "fetch_failed" ? emptyText : "No fuel breakdown for this query.");
}

async function fetchQuery(query) {
  const response = await fetch("/api/query", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Query failed: ${response.status}`);
  }
  return response.json();
}

async function pollQueryRefresh(jobId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const response = await fetch(`/api/query-refresh/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Live refresh failed: ${response.status}`);
    const data = await response.json();
    if (data.liveRefresh?.status !== "pending") return data;
  }
  throw new Error("Live VAHAN refresh is still running. Compare again in a few minutes for the latest data.");
}

function computeDelta(left, right) {
  const diff = right.summary.total - left.summary.total;
  const pct = left.summary.total === 0
    ? null
    : ((diff / left.summary.total) * 100);
  return { diff, pct };
}

function renderDelta(leftData, rightData) {
  const { diff, pct } = computeDelta(leftData, rightData);
  deltaSummary.innerHTML = `
    <div><strong>Difference:</strong> ${formatChange(diff)} registrations</div>
    <div><strong>Change:</strong> ${formatPct(pct)}</div>
    <div><strong>Left:</strong> ${fmt.format(leftData.summary.total)} total (${escapeHtml(leftData.dataStatus ?? "complete")})</div>
    <div><strong>Right:</strong> ${fmt.format(rightData.summary.total)} total (${escapeHtml(rightData.dataStatus ?? "complete")})</div>
  `;
}

async function refreshPendingCompare(runId, leftQueryText, rightQueryText, leftData, rightData) {
  const leftFinalPromise = leftData.liveRefresh?.status === "pending" && leftData.liveRefresh.jobId
    ? pollQueryRefresh(leftData.liveRefresh.jobId)
    : Promise.resolve(leftData);
  const rightFinalPromise = rightData.liveRefresh?.status === "pending" && rightData.liveRefresh.jobId
    ? pollQueryRefresh(rightData.liveRefresh.jobId)
    : Promise.resolve(rightData);

  try {
    const [leftFinal, rightFinal] = await Promise.all([leftFinalPromise, rightFinalPromise]);
    if (activeCompareRun !== runId) return;
    renderSide("left", leftQueryText, leftFinal);
    renderSide("right", rightQueryText, rightFinal);
    renderDoubleBars(leftFinal, rightFinal, leftQueryText, rightQueryText);
    renderDelta(leftFinal, rightFinal);
  } catch (error) {
    if (activeCompareRun !== runId) return;
    deltaSummary.textContent = error.message;
  }
}

async function runCompare(event) {
  event.preventDefault();
  const runId = ++activeCompareRun;
  compareBtn.disabled = true;
  compareBtn.textContent = "Comparing...";
  deltaSummary.textContent = "Loading both queries...";
  verticalBarChart.innerHTML = '<p class="compare-empty">Building vertical comparison chart...</p>';
  doubleBarChart.innerHTML = '<p class="compare-empty">Building comparison chart...</p>';

  const left = leftQuery.value.trim();
  const right = rightQuery.value.trim();
  leftQuery.value = left;
  rightQuery.value = right;
  resetSide("left", left || "Left query", "Loading");
  resetSide("right", right || "Right query", "Loading");

  try {
    if (!left || !right) {
      throw new Error("Enter both queries before comparing.");
    }
    const [leftData, rightData] = await Promise.all([fetchQuery(left), fetchQuery(right)]);
    if (activeCompareRun !== runId) return;
    renderSide("left", left, leftData);
    renderSide("right", right, rightData);
    renderDoubleBars(leftData, rightData, left, right);
    renderDelta(leftData, rightData);

    if (leftData.liveRefresh?.status === "pending" || rightData.liveRefresh?.status === "pending") {
      refreshPendingCompare(runId, left, right, leftData, rightData);
    }
  } catch (error) {
    deltaSummary.textContent = error.message;
    const message = escapeHtml(error.message);
    verticalBarChart.innerHTML = `<p class="compare-empty">${message}</p>`;
    doubleBarChart.innerHTML = `<p class="compare-empty">${message}</p>`;
    const fallbackData = {
      dataStatus: "fetch_failed",
      warnings: [error.message],
      scraper: { failedRuns: [] },
      summary: { total: 0, monthlyAverage: 0 },
      rows: [],
      trend: [],
      fuelBreakdown: [],
    };
    renderSide("left", left || "Left query", fallbackData, "Error");
    renderSide("right", right || "Right query", fallbackData, "Error");
  } finally {
    compareBtn.disabled = false;
    compareBtn.textContent = "Compare";
  }
}

monthModeBtn.addEventListener("click", () => setMode("month"));
locationModeBtn.addEventListener("click", () => setMode("location"));
leftQuery.addEventListener("input", () => {
  leftDirty = true;
});
rightQuery.addEventListener("input", () => {
  rightDirty = true;
});
compareForm.addEventListener("submit", runCompare);

if (appFrame && sidebarTrigger && featureSidebar) {
  let closeSidebarTimer = null;

  const openSidebar = () => {
    clearTimeout(closeSidebarTimer);
    appFrame.classList.add("sidebar-open");
    sidebarTrigger.setAttribute("aria-expanded", "true");
  };

  const closeSidebar = () => {
    closeSidebarTimer = setTimeout(() => {
      const activeElement = document.activeElement;
      if (sidebarTrigger.matches(":hover, :focus-visible") || featureSidebar.matches(":hover") || featureSidebar.contains(activeElement)) return;
      appFrame.classList.remove("sidebar-open");
      sidebarTrigger.setAttribute("aria-expanded", "false");
    }, 120);
  };

  sidebarTrigger.setAttribute("aria-haspopup", "true");
  sidebarTrigger.setAttribute("aria-expanded", "false");
  sidebarTrigger.addEventListener("mouseenter", openSidebar);
  sidebarTrigger.addEventListener("pointerenter", openSidebar);
  sidebarTrigger.addEventListener("focus", openSidebar);
  sidebarTrigger.addEventListener("mouseleave", closeSidebar);
  sidebarTrigger.addEventListener("pointerleave", closeSidebar);
  sidebarTrigger.addEventListener("blur", closeSidebar);
  featureSidebar.addEventListener("mouseenter", openSidebar);
  featureSidebar.addEventListener("pointerenter", openSidebar);
  featureSidebar.addEventListener("mouseleave", closeSidebar);
  featureSidebar.addEventListener("pointerleave", closeSidebar);
  featureSidebar.addEventListener("focusin", openSidebar);
  featureSidebar.addEventListener("focusout", closeSidebar);
}

setMode("month");
runCompare(new Event("submit"));
