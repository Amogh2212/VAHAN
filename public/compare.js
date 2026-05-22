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
    left: "diesel fork lift registrations in Maharashtra from Jan 2024 to Jan 2024",
    right: "diesel fork lift registrations in Maharashtra from Feb 2024 to Feb 2024",
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

function setMode(nextMode) {
  currentMode = nextMode;
  monthModeBtn.classList.toggle("active", nextMode === "month");
  locationModeBtn.classList.toggle("active", nextMode === "location");
  monthModeBtn.setAttribute("aria-pressed", String(nextMode === "month"));
  locationModeBtn.setAttribute("aria-pressed", String(nextMode === "location"));
  modeHelp.textContent = modeConfig[nextMode].help;
  compareHint.textContent = modeConfig[nextMode].hint;
  if (!leftDirty) leftQuery.value = modeConfig[nextMode].left;
  if (!rightDirty) rightQuery.value = modeConfig[nextMode].right;
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
  return [...new Set([statusMessages[data.dataStatus], scraperMessage, ...(data.warnings ?? [])].filter(Boolean))];
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

function renderDoubleBars(leftData, rightData) {
  const leftTrend = new Map(leftData.trend.map((item) => [item.month, item.count]));
  const rightTrend = new Map(rightData.trend.map((item) => [item.month, item.count]));
  const months = [...new Set([...leftTrend.keys(), ...rightTrend.keys()])].sort((a, b) => a.localeCompare(b));

  if (!months.length) {
    verticalBarChart.innerHTML = '<p class="compare-empty">No monthly comparison data is available for these queries.</p>';
    doubleBarChart.innerHTML = '<p class="compare-empty">No monthly comparison data is available for these queries.</p>';
    return;
  }

  const max = Math.max(
    1,
    ...months.flatMap((month) => [leftTrend.get(month) ?? 0, rightTrend.get(month) ?? 0]),
  );

  verticalBarChart.innerHTML = `
    <div class="double-bar-legend">
      <span><i class="legend-swatch left"></i>Left query</span>
      <span><i class="legend-swatch right"></i>Right query</span>
    </div>
    <div class="vertical-bar-scroll" role="img" aria-label="Vertical monthly comparison chart">
      <div class="vertical-bar-plot">
        ${months
          .map((month) => {
            const leftCount = leftTrend.get(month) ?? 0;
            const rightCount = rightTrend.get(month) ?? 0;
            const leftHeight = (leftCount / max) * 100;
            const rightHeight = (rightCount / max) * 100;

          return `
              <div class="vertical-bar-group">
                <div class="vertical-bar-values">
                  <span>${fmt.format(leftCount)}</span>
                  <span>${fmt.format(rightCount)}</span>
                </div>
                <div class="vertical-bar-columns">
                  <span class="vertical-bar-fill left" style="height:${leftHeight}%"></span>
                  <span class="vertical-bar-fill right" style="height:${rightHeight}%"></span>
                </div>
                <div class="vertical-bar-label">${escapeHtml(month)}</div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;

  doubleBarChart.innerHTML = `
    <div class="normal-chart-label">Normal form representation</div>
    <div class="double-bar-legend">
      <span><i class="legend-swatch left"></i>Left query</span>
      <span><i class="legend-swatch right"></i>Right query</span>
    </div>
    <div class="double-bar-list">
      ${months
        .map((month) => {
          const leftCount = leftTrend.get(month) ?? 0;
          const rightCount = rightTrend.get(month) ?? 0;
          const leftWidth = (leftCount / max) * 100;
          const rightWidth = (rightCount / max) * 100;

            return `
            <div class="double-bar-row">
              <div class="double-bar-label">${escapeHtml(month)}</div>
              <div class="double-bar-pair">
                <div class="double-bar-track">
                  <span class="double-bar-fill left" style="width:${leftWidth}%"></span>
                </div>
                <strong>${fmt.format(leftCount)}</strong>
              </div>
              <div class="double-bar-pair">
                <div class="double-bar-track">
                  <span class="double-bar-fill right" style="width:${rightWidth}%"></span>
                </div>
                <strong>${fmt.format(rightCount)}</strong>
              </div>
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
  setText(`${prefix}QueryLabel`, `${query}${extractBracketMeta(query)}`);
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
    const response = await fetch(`/api/query-refresh/${encodeURIComponent(jobId)}`);
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
  const warningCount = dataWarnings(leftData).length + dataWarnings(rightData).length;
  deltaSummary.innerHTML = `
    <div><strong>Difference:</strong> ${formatChange(diff)} registrations</div>
    <div><strong>Change:</strong> ${formatPct(pct)}</div>
    <div><strong>Left:</strong> ${fmt.format(leftData.summary.total)} total (${escapeHtml(leftData.dataStatus ?? "complete")})</div>
    <div><strong>Right:</strong> ${fmt.format(rightData.summary.total)} total (${escapeHtml(rightData.dataStatus ?? "complete")})</div>
    ${warningCount ? `<div><strong>Warnings:</strong> ${fmt.format(warningCount)} data note${warningCount === 1 ? "" : "s"} shown below.</div>` : ""}
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
    renderDoubleBars(leftFinal, rightFinal);
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

  try {
    if (!left || !right) {
      throw new Error("Enter both queries before comparing.");
    }
    const [leftData, rightData] = await Promise.all([fetchQuery(left), fetchQuery(right)]);
    if (activeCompareRun !== runId) return;
    renderSide("left", left, leftData);
    renderSide("right", right, rightData);
    renderDoubleBars(leftData, rightData);
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
