/* ========================================================================
   VAHAN Dashboard - Frontend Logic
   ======================================================================== */

const form = document.querySelector("#queryForm");
const input = document.querySelector("#queryInput");
const warnings = document.querySelector("#warnings");
const submitBtn = document.querySelector("#submitBtn");
const app = document.querySelector("#app");
const appFrame = document.querySelector(".app-frame");
const sidebarShell = document.querySelector("#sidebarShell");
const sidebarTrigger = document.querySelector("#sidebarTrigger");
const featureSidebar = document.querySelector("#featureSidebar");
const downloadCsvBtn = document.querySelector("#downloadCsvBtn");
const downloadPdfBtn = document.querySelector("#downloadPdfBtn");
const downloadMenu = document.querySelector(".download-menu");
const downloadMenuBtn = document.querySelector("#downloadMenuBtn");
const dashboardLayout = document.querySelector("#dashboardLayout");
const dashboardModeButtons = document.querySelectorAll("[data-dashboard-mode]");
const queryShortcutButtons = document.querySelectorAll("[data-query]");

const fmt = new Intl.NumberFormat("en-IN");
const monthFmt = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });
let activeRefreshJobId = null;
let activeQueryController = null;
let activeQueryRequestId = 0;
let activeSubmissionToken = null;
let showZeroResultRows = false;
let latestData = null;
let latestResult = null;
let selectedDistributionMonth = null;
let warningToastTimers = [];
const DASHBOARD_STATE_KEY = "vahan-dashboard:last-answer:v1";

/* Helpers */

function setText(id, value) {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  el.textContent = value;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value) {
  return escapeAttribute(value);
}

function rowMonth(row) {
  return `${row.year}-${String(row.month).padStart(2, "0")}`;
}

function displayMonth(value) {
  const [year, month] = String(value).split("-").map(Number);
  if (!year || !month) return value;
  return monthFmt.format(new Date(year, month - 1, 1));
}

function displayMonthList(items) {
  return (items ?? []).map(displayMonth).join(", ");
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-IN");
}

function dataStatusLabel(status) {
  const labels = {
    complete: "Complete",
    live: "Fresh scrape",
    refreshing: "Refreshing",
    partial: "Partial",
    stale: "Stale",
    missing: "Missing",
    fetch_failed: "Fetch failed",
  };
  return labels[status] ?? "Complete";
}

function persistLatestResult(result) {
  try {
    sessionStorage.setItem(DASHBOARD_STATE_KEY, JSON.stringify({
      query: result.query,
      data: result.data,
    }));
  } catch {
    // Storage can be unavailable or full; the in-page answer remains usable.
  }
}

function readPersistedResult() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DASHBOARD_STATE_KEY) ?? "null");
    if (!saved?.query || !saved?.data?.summary || !Array.isArray(saved.data.rows)) return null;
    return saved;
  } catch {
    return null;
  }
}

function isUntrustedStatus(status) {
  return ["stale", "partial", "missing", "fetch_failed"].includes(status);
}

function hasSideFilterContext(filters = {}) {
  return Boolean(
    filters.selectedFuelTypes?.length ||
    filters.fuelFilters?.length ||
    filters.selectedVehicleCategories?.length ||
    filters.vehicleCategories?.length ||
    filters.selectedNorms?.length ||
    filters.norms?.length ||
    filters.selectedVehicleClasses?.length ||
    filters.vehicleClasses?.length ||
    filters.excludedVehicleCategories?.length ||
    filters.excludedNorms?.length ||
    filters.excludedVehicleClasses?.length
  );
}

function selectedFuelLabelText(filters = {}) {
  return filters.selectedFuelTypes?.length ? filters.selectedFuelTypes.join(", ") : "All fuel labels";
}

function selectedVehicleCategoryText(filters = {}) {
  return filters.selectedVehicleCategories?.length
    ? filters.selectedVehicleCategories.join(", ")
    : filters.vehicleCategories?.length
      ? filters.vehicleCategories.join(", ")
      : "";
}

function selectedVehicleClassText(filters = {}) {
  return filters.selectedVehicleClasses?.length
    ? filters.selectedVehicleClasses.join(", ")
    : filters.vehicleClasses?.length
      ? filters.vehicleClasses.join(", ")
      : "";
}

function reliabilityMessage(data) {
  const status = data.dataStatus ?? "complete";
  if (status === "stale") {
    return `Saved rows are being shown because the VAHAN refresh failed. Treat ${fmt.format(data.summary?.total ?? 0)} as a stale snapshot, not the current VAHAN total.`;
  }
  if (status === "partial") {
    return "This answer is missing one or more requested months from the local dataset.";
  }
  if (status === "missing") {
    return "No saved rows match this exact filter context yet.";
  }
  if (status === "fetch_failed") {
    return "Fresh VAHAN data could not be fetched and no complete saved answer is available.";
  }
  return null;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function slugifyFilename(value) {
  return (
    String(value ?? "vahan-report")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "vahan-report"
  );
}

function filterEntries(filters = {}) {
  return [
    ["Interpreted intent", filters.semanticIntent ?? "Standard filter parse"],
    ["Semantic confidence", filters.semanticConfidence !== null && filters.semanticConfidence !== undefined ? `${Math.round(filters.semanticConfidence * 100)}%` : "Not scored"],
    ["Semantic explanation", filters.semanticExplanation ?? "-"],
    ["AI provider", filters.aiProvider ?? "Local rules"],
    ["Selected fuel labels", filters.selectedFuelTypes?.length ? filters.selectedFuelTypes.join(", ") : "All"],
    ["Selected vehicle groups", filters.selectedVehicleGroups?.length ? filters.selectedVehicleGroups.join(", ") : "All"],
    ["Selected vehicle classes", filters.selectedVehicleClasses?.length ? filters.selectedVehicleClasses.join(", ") : "All"],
    ["Selected vehicle categories", filters.selectedVehicleCategories?.length ? filters.selectedVehicleCategories.join(", ") : "All"],
    ["Selected norms", filters.selectedNorms?.length ? filters.selectedNorms.join(", ") : "All"],
    ["Excluded fuel labels", filters.excludedFuelTypes?.length ? filters.excludedFuelTypes.join(", ") : "None"],
    ["Excluded vehicle groups", filters.excludedVehicleGroups?.length ? filters.excludedVehicleGroups.join(", ") : "None"],
    ["Excluded vehicle classes", filters.excludedVehicleClasses?.length ? filters.excludedVehicleClasses.join(", ") : "None"],
    ["Excluded vehicle categories", filters.excludedVehicleCategories?.length ? filters.excludedVehicleCategories.join(", ") : "None"],
    ["Excluded norms", filters.excludedNorms?.length ? filters.excludedNorms.join(", ") : "None"],
    ["Fuel segment", filters.fuelSegment ?? "All"],
    ["Fuel type", filters.fuelType ?? "All"],
    ["Fuel checkbox", filters.fuelFilters?.length ? filters.fuelFilters.join(", ") : "All"],
    ["Vehicle category", filters.vehicleCategories?.length ? filters.vehicleCategories.join(", ") : "All"],
    ["Norms", filters.norms?.length ? filters.norms.join(", ") : "All"],
    ["Vehicle class", filters.vehicleClasses?.length ? filters.vehicleClasses.join(", ") : "All"],
    ["State", filters.state ?? "All loaded states"],
    ["RTO", filters.rto ?? filters.locationText ?? "All loaded RTOs"],
    ["RTO resolution", filters.rtoResolution?.status ?? "not needed"],
    ["From", filters.from ?? "-"],
    ["To", filters.to ?? "-"],
  ];
}

function usefulFilterEntries(filters = {}) {
  return filterEntries(filters).filter(([key, value]) => {
    if (["Semantic confidence", "Semantic explanation", "AI provider", "RTO resolution"].includes(key)) return false;
    if (key === "Interpreted intent") return true;
    const normalized = String(value ?? "").trim();
    return Boolean(normalized) && !/^(?:all\b|none$|not scored$|not needed$|local rules$|-)$/.test(normalized.toLowerCase());
  });
}

const filterPresentationLabels = {
  "Interpreted intent": "Question",
  "Selected fuel labels": "Fuel",
  "Selected vehicle groups": "Vehicle group",
  "Selected vehicle classes": "Vehicle class",
  "Selected vehicle categories": "Vehicle",
  "Selected norms": "Norm",
  "Excluded fuel labels": "Excluded fuel",
  "Excluded vehicle groups": "Excluded vehicle group",
  "Excluded vehicle classes": "Excluded vehicle class",
  "Excluded vehicle categories": "Excluded vehicle category",
  "Excluded norms": "Excluded norm",
  "Fuel segment": "Fuel segment",
  "Fuel type": "Fuel type",
  "Fuel checkbox": "Fuel",
  "Vehicle category": "Category",
  Norms: "Norm",
  "Vehicle class": "Class",
  State: "State",
  RTO: "RTO coverage",
  From: "From",
  To: "To",
};

function setExportButtonsEnabled(enabled) {
  downloadCsvBtn.disabled = !enabled;
  downloadPdfBtn.disabled = !enabled;
}

function animateCounter(el, target) {
  const start = parseInt(el.textContent.replace(/[^\d]/g, "")) || 0;
  if (start === target) return;
  const duration = 600;
  const startTime = performance.now();
  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (target - start) * eased);
    el.textContent = fmt.format(current);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function setMetricDisplay(id, value, { trusted = true } = {}) {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  if (!trusted) {
    el.textContent = "--";
    return;
  }
  animateCounter(el, value);
}

/* Renderers */

function renderFilters(filters) {
  const el = document.querySelector("#filters");
  const entries = usefulFilterEntries(filters);
  el.innerHTML = entries
    .map(([key, value]) => `<dt>${escapeHtml(filterPresentationLabels[key] ?? key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
}

function renderTrend(trend) {
  const el = document.querySelector("#trend");
  if (!trend.length) {
    el.innerHTML = `<p style="color:var(--text-muted)">No trend data for these filters.</p>`;
    return;
  }
  el.innerHTML = buildTrendLineChart(trend, { compact: true });
}

function renderFuelBreakdown(items) {
  const el = document.querySelector("#fuelBreakdown");
  if (!items.length) {
    el.innerHTML = `<p style="color:var(--text-muted)">No fuel breakdown for these filters.</p>`;
    return;
  }
  const max = Math.max(1, ...items.map((item) => item.count));
  el.innerHTML = items
    .map(
      (item, i) => `
      <div class="fuel-item" style="animation: fadeSlideIn 0.4s var(--ease-out) ${i * 0.03}s both">
        <span>${escapeHtml(item.fuelType)}</span>
        <strong>${fmt.format(item.count)}</strong>
      </div>
    `,
    )
    .join("");
}

function fuelBreakdownForMonth(rows = [], month) {
  const byFuel = new Map();
  for (const row of rows) {
    if (rowMonth(row) !== month) continue;
    byFuel.set(row.fuel_type, (byFuel.get(row.fuel_type) ?? 0) + Number(row.vehicle_count ?? 0));
  }
  return [...byFuel.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([fuelType, count]) => ({ fuelType, count }));
}

function setFuelMixSelection(month = null) {
  selectedDistributionMonth = month;
  const note = document.querySelector("#fuelMixSelection");
  if (note) note.textContent = month ? `${displayMonth(month)} selected` : "All months";
  const items = month ? fuelBreakdownForMonth(latestData?.rows ?? [], month) : latestData?.fuelBreakdown ?? [];
  renderFuelBreakdown(items);
  document.querySelectorAll("#monthlyDistribution [data-month]").forEach((item) => {
    const active = item.dataset.month === month;
    item.classList.toggle("is-selected", active);
    item.setAttribute("aria-pressed", String(active));
  });
}

function renderMonthlyDistribution(trend = [], rows = []) {
  const el = document.querySelector("#monthlyDistribution");
  const range = document.querySelector("#monthlyDistributionRange");
  if (!el) return;
  if (!trend.length) {
    el.innerHTML = `<p class="result-empty">No monthly distribution for these filters.</p>`;
    if (range) range.textContent = "No trend data";
    return;
  }
  const total = trend.reduce((sum, item) => sum + item.count, 0);
  const max = Math.max(1, ...trend.map((item) => item.count));
  if (range) {
    range.textContent = `${displayMonth(trend[0].month)} to ${displayMonth(trend.at(-1).month)}`;
  }
  el.innerHTML = trend
    .map((item) => {
      const share = total ? (item.count / total) * 100 : 0;
      const width = Math.max(2, (item.count / max) * 100);
      return `
        <button type="button" class="monthly-distribution-row" data-month="${escapeAttribute(item.month)}" aria-pressed="false">
          <div class="monthly-distribution-meta">
            <span>${escapeHtml(shortMonthLabel(item.month, false))}</span>
            <strong>${fmt.format(item.count)}</strong>
          </div>
          <div class="monthly-distribution-track" aria-hidden="true"><span style="width:${width}%"></span></div>
          <small>${share.toFixed(1)}% of period</small>
        </button>
      `;
    })
    .join("");
  el.querySelectorAll("[data-month]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const month = button.dataset.month;
      setFuelMixSelection(selectedDistributionMonth === month ? null : month);
    });
  });
}

document.addEventListener("click", (event) => {
  if (!selectedDistributionMonth || event.target.closest(".monthly-distribution, .trend-month-hit")) return;
  setFuelMixSelection();
});

document.querySelector("#trend")?.addEventListener("click", (event) => {
  const monthHit = event.target.closest(".trend-month-hit");
  if (!monthHit) return;
  event.stopPropagation();
  const month = monthHit.dataset.month;
  setFuelMixSelection(selectedDistributionMonth === month ? null : month);
});

function renderInsightRail(data) {
  const status = data.dataStatus ?? "complete";
  const waitingForExactSideFilterRows = status === "refreshing" && hasSideFilterContext(data.filters) && !(data.rows?.length ?? 0);
  const sourceStatusPill = document.querySelector("#sourceStatusPill");
  const sourceMetric = document.querySelector("#sourceMetric");
  const railLatestMonth = document.querySelector("#railLatestMonth");
  const railSaveStatus = document.querySelector("#railSaveStatus");
  const railScrapeStatus = document.querySelector("#railScrapeStatus");
  const analystNotes = document.querySelector("#analystNotes");
  const trendRange = document.querySelector("#trendRange");
  const fuelLeader = document.querySelector("#fuelLeader");
  const filterConfidence = document.querySelector("#filterConfidence");

  if (sourceStatusPill) {
    sourceStatusPill.textContent = dataStatusLabel(status);
    sourceStatusPill.classList.toggle("success", ["complete", "live"].includes(status));
    sourceStatusPill.classList.toggle("error", status === "fetch_failed");
    sourceStatusPill.classList.toggle("warning", ["stale", "partial"].includes(status));
  }
  if (sourceMetric) sourceMetric.textContent = (isUntrustedStatus(status) || waitingForExactSideFilterRows) && !(data.rows?.length) ? "--" : fmt.format(data.rows?.length ?? 0);
  if (railLatestMonth) {
    railLatestMonth.textContent = data.freshness?.latestMonth ? displayMonth(data.freshness.latestMonth) : "-";
  }
  if (railSaveStatus) railSaveStatus.textContent = data.persistenceStatus ?? "saved";
  if (railScrapeStatus) {
    railScrapeStatus.textContent = data.scraper?.autoTriggered
      ? data.scraper.success
        ? "Completed"
        : "Attempted"
      : data.liveRefresh?.status === "pending"
        ? "Running"
        : "Idle";
  }

  if (trendRange) {
    const months = data.trend?.map((item) => item.month) ?? [];
    trendRange.textContent = months.length
      ? `${displayMonth(months[0])} to ${displayMonth(months[months.length - 1])}`
      : "No trend data";
  }
  if (fuelLeader) {
    const leader = data.fuelBreakdown?.[0];
    fuelLeader.textContent = leader ? `${leader.fuelType}: ${fmt.format(leader.count)}` : "No leader yet";
  }
  if (filterConfidence) {
    filterConfidence.textContent = data.filters?.semanticConfidence !== null && data.filters?.semanticConfidence !== undefined
      ? `${Math.round(data.filters.semanticConfidence * 100)}% semantic`
      : data.filters?.rtoResolution?.status === "matched" ? "RTO matched" : "Rule parsed";
  }

  if (!analystNotes) return;
  const notes = [];
  if (data.summary?.total) {
    notes.push(
      `<p><strong>${fmt.format(data.summary.total)}</strong> registrations matched the current query, averaging <strong>${fmt.format(data.summary.monthlyAverage)}</strong> per month.</p>`,
    );
  }
  if (data.summary?.peakMonth) {
    notes.push(
      `<p>Peak activity was <strong>${displayMonth(data.summary.peakMonth)}</strong> with <strong>${fmt.format(data.summary.peakMonthCount)}</strong> registrations.</p>`,
    );
  }
  if (data.fuelBreakdown?.length) {
    const leader = data.fuelBreakdown[0];
    notes.push(`<p><strong>${escapeHtml(leader.fuelType)}</strong> leads the fuel mix for this slice.</p>`);
  }
  if (data.filters?.selectedFuelTypes?.length) {
    notes.push(`<p>Fuel labels used: <strong>${escapeHtml(selectedFuelLabelText(data.filters))}</strong></p>`);
  }
  const vehicleCategoryText = selectedVehicleCategoryText(data.filters);
  if (vehicleCategoryText) {
    notes.push(`<p>Vehicle category used: <strong>${escapeHtml(vehicleCategoryText)}</strong></p>`);
  }
  const vehicleClassText = selectedVehicleClassText(data.filters);
  if (vehicleClassText) {
    notes.push(`<p>Vehicle class used: <strong>${escapeHtml(vehicleClassText)}</strong></p>`);
  }
  const reliability = reliabilityMessage(data);
  if (reliability) {
    notes.unshift(`<p><strong>${escapeHtml(dataStatusLabel(status))} answer.</strong> ${escapeHtml(reliability)}</p>`);
  }
  if (data.filters?.semanticIntent) {
    notes.push(`<p>Interpreted as: <strong>${escapeHtml(data.filters.semanticIntent)}</strong></p>`);
  }
  if (status === "refreshing") {
    notes.push("<p>Fresh VAHAN data is being fetched in the background; saved rows are shown now.</p>");
  }
  analystNotes.innerHTML = notes.length ? notes.join("") : "<p>No matching rows yet. Try a broader state, date, or fuel query.</p>";
}

function renderResultCards(rows, dataStatus) {
  const el = document.querySelector("#rowChart");
  if (!rows.length) {
    const message =
      dataStatus === "fetch_failed"
        ? "Could not fetch fresh VAHAN data for this query."
        : "No rows matched this query.";
    el.innerHTML = `<p class="result-empty">${message}</p>`;
    return;
  }

  const groups = new Map();
  for (const row of rows) {
    const month = rowMonth(row);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(row);
  }

  const cards = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, monthRows], index) => {
      const visibleRows = showZeroResultRows
        ? monthRows
        : monthRows.filter((row) => row.vehicle_count !== 0);
      const hiddenZeroCount = monthRows.length - visibleRows.length;
      const total = monthRows.reduce((sum, row) => sum + row.vehicle_count, 0);
      const location = [monthRows[0]?.state, monthRows[0]?.rto].filter(Boolean).join(" | ");
      const context = [
        monthRows[0]?.vehicle_category_filter && monthRows[0].vehicle_category_filter !== "ALL" ? monthRows[0].vehicle_category_filter : null,
        monthRows[0]?.vehicle_class_filter && monthRows[0].vehicle_class_filter !== "ALL" ? monthRows[0].vehicle_class_filter : null,
        monthRows[0]?.norms_filter && monthRows[0].norms_filter !== "ALL" ? monthRows[0].norms_filter : null,
      ].filter(Boolean).join(" | ");

      return `
        <article class="result-card" style="animation: fadeSlideIn 0.4s var(--ease-out) ${index * 0.03}s both">
          <div class="result-card-head">
            <div>
              <span>${displayMonth(month)}</span>
              <small>${escapeHtml(location)}</small>
              ${context ? `<small>${escapeHtml(context)}</small>` : ""}
            </div>
            <strong>${fmt.format(total)}</strong>
          </div>
          <div class="result-card-rows">
            ${
              visibleRows.length
                ? visibleRows
                    .sort((a, b) => b.vehicle_count - a.vehicle_count || a.fuel_type.localeCompare(b.fuel_type))
                    .map((row) => `
                      <div class="result-card-row ${row.vehicle_count === 0 ? "is-zero" : ""}">
                        <span>${escapeHtml(row.fuel_type)}</span>
                        <strong>${fmt.format(row.vehicle_count)}</strong>
                      </div>
                    `)
                    .join("")
                : `<p class="result-empty small">Only zero-count rows for this month.</p>`
            }
            ${
              hiddenZeroCount > 0
                ? `<p class="result-hidden">${hiddenZeroCount} zero-count row${hiddenZeroCount === 1 ? "" : "s"} hidden</p>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");

  el.innerHTML = `
    <div class="result-card-toolbar">
      <span>${fmt.format(groups.size)} month${groups.size === 1 ? "" : "s"} returned</span>
      <label class="zero-toggle">
        <input id="zeroRowsToggle" type="checkbox" ${showZeroResultRows ? "checked" : ""} />
        <span>Show zero rows</span>
      </label>
    </div>
    <div class="result-card-grid">
      ${cards}
    </div>
  `;

  document.querySelector("#zeroRowsToggle")?.addEventListener("change", (event) => {
    showZeroResultRows = event.target.checked;
    renderResultCards(rows, dataStatus);
  });
}

function renderReliabilityBanner(data) {
  const existing = document.querySelector("#reliabilityBanner");
  existing?.remove();

  const message = reliabilityMessage(data);
  if (!message) return;

  const filtersPanel = document.querySelector("#filtersPanel");
  if (!filtersPanel) return;

  const banner = document.createElement("section");
  banner.id = "reliabilityBanner";
  banner.className = `reliability-banner ${data.dataStatus === "fetch_failed" ? "error" : "warning"}`;
  banner.innerHTML = `
    <div>
      <strong>${escapeHtml(dataStatusLabel(data.dataStatus))} saved-data answer</strong>
      <p>${escapeHtml(message)}</p>
    </div>
    <dl>
      <div>
        <dt>Fuel labels</dt>
        <dd>${escapeHtml(selectedFuelLabelText(data.filters))}</dd>
      </div>
      <div>
        <dt>Latest loaded</dt>
        <dd>${escapeHtml(data.freshness?.latestMonth ? displayMonth(data.freshness.latestMonth) : "not available")}</dd>
      </div>
    </dl>
  `;
  filtersPanel.parentElement?.insertBefore(banner, filtersPanel);
}

function renderWarnings(items) {
  const uniqueItems = [...new Set((items ?? []).filter(Boolean))]
    .filter((item) => !/^Showing saved data now\. Missing or latest months/i.test(item))
    .filter((item) => !/^Resolved .+ using the VAHAN RTO catalog\.$/i.test(item))
    .slice(0, 3);
  for (const timer of warningToastTimers) clearTimeout(timer);
  warningToastTimers = [];
  warnings.innerHTML = "";
  warnings.hidden = !uniqueItems.length;
  if (!uniqueItems.length) return;

  for (const item of uniqueItems) {
    const toast = document.createElement("div");
    toast.className = "warning-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML = `
      <span>${escapeHtml(item)}</span>
      <button type="button" class="warning-toast-close" aria-label="Dismiss message">x</button>
    `;

    const removeToast = () => {
      toast.remove();
      warnings.hidden = warnings.children.length === 0;
    };
    toast.querySelector("button")?.addEventListener("click", removeToast);
    warningToastTimers.push(setTimeout(removeToast, 30_000));
    warnings.appendChild(toast);
  }
}

function compactRefreshMessage(data) {
  if (data.dataStatus !== "refreshing") return null;
  const count = data.liveRefresh?.requiredMonths?.length ?? 0;
  if (hasSideFilterContext(data.filters)) {
    return count
      ? `Fetching exact Public Dashboard data for ${count} month${count === 1 ? "" : "s"}. The answer will update after validation.`
      : "Fetching exact Public Dashboard data. The answer will update after validation.";
  }
  return count
    ? `Fetching ${count} missing/latest month${count === 1 ? "" : "s"} from the Public Dashboard. Saved data is shown now and will update automatically.`
    : "Fetching missing/latest Public Dashboard data. Saved data is shown now and will update automatically.";
}

/* Main Render */

function render(data, query, requestId) {
  if (requestId !== activeQueryRequestId) return false;
  latestResult = Object.freeze({ query, data, requestId });
  persistLatestResult(latestResult);
  latestData = data;
  selectedDistributionMonth = null;
  setText("answerHeading", `Registration evidence for “${query}”`);
  const status = data.dataStatus ?? "complete";
  const hasTrustedRows = !isUntrustedStatus(status) && (data.rows?.length ?? 0) > 0;
  setExportButtonsEnabled(Boolean(latestData) && hasTrustedRows);
  document.querySelector("#summaryCards")?.classList.toggle("is-untrusted", isUntrustedStatus(status));
  const waitingForExactSideFilterRows = status === "refreshing" && hasSideFilterContext(data.filters) && !(data.rows?.length ?? 0);
  const showMetricNumbers = status !== "missing" && status !== "fetch_failed" && !waitingForExactSideFilterRows;
  setMetricDisplay("total", data.summary.total, { trusted: showMetricNumbers });
  setMetricDisplay("average", data.summary.monthlyAverage, { trusted: showMetricNumbers });
  setMetricDisplay("rowCount", data.rows.length, { trusted: showMetricNumbers });

  setText(
    "peak",
    data.summary.peakMonth
      ? `${displayMonth(data.summary.peakMonth)} (${fmt.format(data.summary.peakMonthCount)})`
      : "-",
  );

  document.querySelector("#freshness").textContent =
    `${data.freshness.source}. Latest loaded month: ${data.freshness.latestMonth ? displayMonth(data.freshness.latestMonth) : "not available"}. Status: ${data.dataStatus ?? "complete"}. Save: ${data.persistenceStatus ?? "saved"}.`;

  const scraperMessage = data.scraper?.autoTriggered
    ? data.scraper.success
      ? [`Auto-scraped missing Public Dashboard data for ${data.scraper.runs.map((run) => `${run.year}`).join(", ")} before answering.`]
      : [`Public Dashboard fetch failed for ${data.scraper.failedRuns?.length ?? 0} run(s). Results may be missing or stale.`]
    : [];
  const statusMessage =
    data.dataStatus === "fetch_failed"
      ? ["Fresh data could not be fetched, and no cached rows matched this query."]
      : data.dataStatus === "stale"
        ? ["Showing stale local data because the live fetch failed."]
        : data.dataStatus === "live"
          ? ["Showing freshly scraped Public Dashboard data while it is saved in the background."]
        : data.dataStatus === "refreshing"
          ? [compactRefreshMessage(data)]
        : data.dataStatus === "partial"
          ? ["Some requested months are missing from the local dataset."]
        : data.dataStatus === "missing"
            ? ["No saved rows match this exact filter context yet."]
          : [];
  renderWarnings([...scraperMessage, ...statusMessage, ...(data.warnings ?? [])]);

  renderReliabilityBanner(data);
  renderFilters(data.filters);
  renderTrend(data.trend);
  renderFuelBreakdown(data.fuelBreakdown);
  renderMonthlyDistribution(data.trend, data.rows);
  renderResultCards(data.rows, data.dataStatus);
  renderInsightRail(data);

  // Remove loading state
  app.classList.remove("loading");
  return true;
}

function buildReportCsv(data, query) {
  const lines = [];
  const generatedAt = new Date().toISOString();
  const metadata = [
    ["Report", "VAHAN Registration Dashboard"],
    ["Query", query],
    ["Generated at", generatedAt],
    ["Source", data.freshness?.source ?? ""],
    ["Latest loaded month", data.freshness?.latestMonth ?? ""],
    ["Data status", data.dataStatus ?? ""],
    ["Save status", data.persistenceStatus ?? ""],
    ["Total registrations", data.summary?.total ?? 0],
    ["Monthly average", data.summary?.monthlyAverage ?? 0],
    ["Peak month", data.summary?.peakMonth ?? ""],
    ["Peak month count", data.summary?.peakMonthCount ?? 0],
    ["Rows returned", data.rows?.length ?? 0],
  ];

  lines.push(["Metadata", "Value"].map(csvCell).join(","));
  for (const item of metadata) lines.push(item.map(csvCell).join(","));
  lines.push("");
  lines.push(["Parsed filter", "Value"].map(csvCell).join(","));
  for (const item of filterEntries(data.filters)) lines.push(item.map(csvCell).join(","));
  lines.push("");
  if (data.warnings?.length) {
    lines.push(["Warnings"].map(csvCell).join(","));
    for (const warning of data.warnings) lines.push([warning].map(csvCell).join(","));
    lines.push("");
  }

  const headers = [
    "year",
    "month",
    "state",
    "rto",
    "fuel_segment",
    "fuel_type",
    "fuel_filter",
    "vehicle_category_filter",
    "norms_filter",
    "vehicle_class_filter",
    "vehicle_count",
    "scraped_at",
    "source_url",
  ];
  lines.push(headers.map(csvCell).join(","));
  for (const row of data.rows ?? []) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }
  return lines.join("\r\n");
}

function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadCurrentCsv() {
  if (!latestResult) return;
  const { data, query } = latestResult;
  const filename = `${slugifyFilename(query)}-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadBlob(filename, buildReportCsv(data, query), "text/csv;charset=utf-8");
}

function tableRows(items, columns) {
  if (!items?.length) {
    return `<tr><td colspan="${columns.length}">No data available.</td></tr>`;
  }
  return items
    .map((item) => `
      <tr>
        ${columns.map((column) => `<td>${escapeHtml(column.render ? column.render(item) : item[column.key])}</td>`).join("")}
      </tr>
    `)
    .join("");
}

function compactChartNumber(value) {
  const number = Math.round(Number(value) || 0);
  const absolute = Math.abs(number);
  if (absolute >= 100000) {
    const lakhs = number / 100000;
    return `${Number.isInteger(lakhs) ? lakhs : lakhs.toFixed(lakhs >= 10 ? 0 : 1)}L`;
  }
  if (absolute >= 1000) {
    const thousands = number / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(thousands >= 10 ? 0 : 1)}k`;
  }
  return fmt.format(number);
}

function shortMonthLabel(value, includeYear = false) {
  const label = displayMonth(value);
  const [month, year] = label.split(" ");
  const shortMonth = (month || label).slice(0, 3);
  return includeYear && year ? `${shortMonth} ${year}` : shortMonth;
}

function clampChartValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function importantTrendIndexes(trend) {
  let peakIndex = 0;
  let lowIndex = 0;
  trend.forEach((item, index) => {
    if (item.count > trend[peakIndex].count) peakIndex = index;
    if (item.count < trend[lowIndex].count) lowIndex = index;
  });
  return new Set([peakIndex, lowIndex, trend.length - 1]);
}

function buildTrendLineChart(trend = [], options = {}) {
  if (!trend.length) {
    return `<p class="empty-chart">No trend data is available for a line chart.</p>`;
  }

  const compact = Boolean(options.compact);
  const width = compact ? Math.max(900, trend.length * 80) : Math.max(860, trend.length * 72);
  const height = compact ? 400 : 280;
  const padding = compact
    ? { top: 58, right: 132, bottom: 70, left: 88 }
    : { top: 42, right: 104, bottom: 50, left: 78 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const average = trend.reduce((sum, item) => sum + item.count, 0) / trend.length;
  const rawMax = Math.max(1, average, ...trend.map((item) => item.count));
  const max = Math.ceil(rawMax * 1.14);
  const xFor = (index) => padding.left + (trend.length === 1 ? plotWidth / 2 : (index / (trend.length - 1)) * plotWidth);
  const yFor = (count) => padding.top + plotHeight - (count / max) * plotHeight;
  const points = trend.map((item, index) => `${xFor(index)},${yFor(item.count)}`).join(" ");
  const areaPoints = `${padding.left},${padding.top + plotHeight} ${points} ${padding.left + plotWidth},${padding.top + plotHeight}`;
  const averageY = yFor(average);
  const importantIndexes = importantTrendIndexes(trend);
  const peakIndex = [...importantIndexes].reduce((highest, index) => (trend[index].count > trend[highest].count ? index : highest), 0);
  const lastIndex = trend.length - 1;
  const firstItem = trend[0];
  const lastItem = trend[lastIndex];
  const peakItem = trend[peakIndex];
  const movement =
    lastItem.count > firstItem.count
      ? "increased"
      : lastItem.count < firstItem.count
        ? "decreased"
        : "remained level";
  const chartSummary =
    `Registrations ${movement} from ${fmt.format(firstItem.count)} in ${displayMonth(firstItem.month)} ` +
    `to ${fmt.format(lastItem.count)} in ${displayMonth(lastItem.month)}. ` +
    `The highest month was ${displayMonth(peakItem.month)} with ${fmt.format(peakItem.count)} registrations.`;
  const averageLabel = `Avg ${compactChartNumber(average)}`;
  const averageChipWidth = Math.max(70, averageLabel.length * 7 + 18);
  const averageChipX = padding.left + plotWidth + 10;
  const averageChipY = clampChartValue(averageY - 12, padding.top + 4, padding.top + plotHeight - 28);
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = padding.top + plotHeight - ratio * plotHeight;
    const value = Math.round(max * ratio);
    return `
      <line x1="${padding.left}" y1="${y}" x2="${padding.left + plotWidth}" y2="${y}" class="chart-grid" />
      <text x="${padding.left - 10}" y="${y + 4}" class="axis-label y-axis-label" text-anchor="end">${compactChartNumber(value)}</text>
    `;
  }).join("");
  const labels = trend.map((item, index) => {
    const x = xFor(index);
    const y = yFor(item.count);
    const isImportant = importantIndexes.has(index);
    const pointClass = [
      "line-point",
      index === peakIndex ? "peak-point" : "",
      index === lastIndex ? "latest-point" : "",
    ].filter(Boolean).join(" ");
    const labelAnchor = index === 0 ? "start" : index === lastIndex ? "end" : "middle";
    const labelX = index === 0 ? x + 8 : index === lastIndex ? x - 8 : x;
    const labelY = clampChartValue(y - 13, padding.top - 8, padding.top + plotHeight - 10);
    const xLabel = shortMonthLabel(item.month, !compact && (index === 0 || index === lastIndex));
    return `
      <g class="trend-month-hit" data-month="${escapeAttribute(item.month)}" tabindex="0" role="button" aria-label="Show fuel mix for ${escapeAttribute(displayMonth(item.month))}">
        <rect class="trend-month-hit-target" x="${x - 30}" y="${padding.top}" width="60" height="${plotHeight + 42}" fill="transparent" />
        <circle cx="${x}" cy="${y}" r="${index === peakIndex || index === lastIndex ? 5.5 : 4.5}" class="${pointClass}">
          <title>${escapeHtml(displayMonth(item.month))}: ${fmt.format(item.count)} registrations</title>
        </circle>
        ${isImportant ? `<text x="${labelX}" y="${labelY}" class="point-label" text-anchor="${labelAnchor}">${fmt.format(item.count)}</text>` : ""}
        <text x="${x}" y="${height - 18}" class="axis-label x-axis-label" text-anchor="middle">${escapeHtml(xLabel)}</text>
      </g>
    `;
  }).join("");

  return `
    <p class="chart-summary">${escapeHtml(chartSummary)}</p>
    <div class="${compact ? "dashboard-line-chart-wrap" : "line-chart-wrap"}">
      <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly registrations line chart">
        <rect x="0" y="0" width="${width}" height="${height}" rx="10" class="chart-bg" />
        <polygon points="${areaPoints}" class="line-area" />
        ${gridLines}
        <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight}" class="chart-axis" />
        <line x1="${padding.left}" y1="${averageY}" x2="${padding.left + plotWidth}" y2="${averageY}" class="average-line" />
        <g class="average-chip" transform="translate(${averageChipX} ${averageChipY})">
          <rect width="${averageChipWidth}" height="24" rx="12" />
          <text x="${averageChipWidth / 2}" y="16" text-anchor="middle">${escapeHtml(averageLabel)}</text>
        </g>
        <polyline points="${points}" class="line-path" />
        ${labels}
      </svg>
    </div>
  `;
}

function openPrintableReport() {
  if (!latestResult) return;
  const { data, query } = latestResult;
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    renderWarnings(["Allow pop-ups to open the printable report."]);
    return;
  }

  const filterTable = filterEntries(data.filters)
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  const trendRows = tableRows(data.trend, [
    { key: "month", render: (item) => displayMonth(item.month) },
    { key: "count", render: (item) => fmt.format(item.count) },
  ]);
  const trendLineChart = buildTrendLineChart(data.trend);
  const fuelRows = tableRows(data.fuelBreakdown, [
    { key: "fuelType" },
    { key: "count", render: (item) => fmt.format(item.count) },
  ]);
  const resultRows = tableRows(data.rows, [
    { key: "year" },
    { key: "month" },
    { key: "state" },
    { key: "rto" },
    { key: "fuel_type" },
    { key: "vehicle_count", render: (item) => fmt.format(item.vehicle_count) },
    { key: "scraped_at", render: (item) => formatTimestamp(item.scraped_at) },
  ]);

  reportWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>VAHAN Report</title>
        <style>
          body { margin: 32px; color: #172033; font-family: Inter, Arial, sans-serif; line-height: 1.45; }
          h1 { margin: 0 0 6px; font-size: 28px; }
          h2 { margin: 28px 0 10px; font-size: 16px; text-transform: uppercase; letter-spacing: 0.06em; color: #526070; }
          p { margin: 4px 0; color: #526070; }
          .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 20px 0; }
          .metric { border: 1px solid #d7dee8; border-radius: 8px; padding: 12px; }
          .metric span { display: block; color: #667085; font-size: 11px; text-transform: uppercase; }
          .metric strong { display: block; margin-top: 6px; font-size: 20px; color: #101828; }
          table { width: 100%; border-collapse: collapse; margin: 8px 0 18px; font-size: 12px; }
          th, td { border: 1px solid #d7dee8; padding: 7px 8px; text-align: left; vertical-align: top; }
          th { background: #f3f6fa; color: #344054; }
          .source { border-top: 2px solid #12b886; padding-top: 12px; margin-top: 16px; }
          .warnings { color: #9a6700; }
          .line-chart-wrap { margin: 8px 0 16px; overflow: hidden; }
          .line-chart { display: block; width: 100%; max-width: 820px; height: auto; }
          .chart-bg { fill: #f8fafc; stroke: #d7dee8; }
          .chart-grid { stroke: #e1e7ef; stroke-width: 1; }
          .chart-axis { stroke: #98a2b3; stroke-width: 1.2; }
          .line-area { fill: rgba(18, 184, 134, 0.12); }
          .line-path { fill: none; stroke: #12b886; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
          .line-point { fill: #0ca678; stroke: #ffffff; stroke-width: 2; }
          .average-line { stroke: #f08c00; stroke-width: 2; stroke-dasharray: 7 7; }
          .axis-label { fill: #667085; font-size: 11px; }
          .point-label { fill: #344054; font-size: 11px; font-weight: 700; }
          .average-label { fill: #b35c00; font-size: 11px; font-weight: 700; }
          .empty-chart { border: 1px dashed #d7dee8; border-radius: 8px; padding: 14px; color: #667085; }
          @media print {
            body { margin: 18mm; }
            button { display: none; }
            .summary { grid-template-columns: repeat(2, 1fr); }
            table { break-inside: auto; }
            tr { break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <h1>VAHAN Registration Report</h1>
        <p><strong>Query:</strong> ${escapeHtml(query)}</p>
        <p><strong>Generated:</strong> ${escapeHtml(formatTimestamp(new Date().toISOString()))}</p>
        <div class="source">
          <p><strong>Source:</strong> ${escapeHtml(data.freshness?.source ?? "")}</p>
          <p><strong>Latest loaded month:</strong> ${escapeHtml(data.freshness?.latestMonth ? displayMonth(data.freshness.latestMonth) : "not available")}</p>
          <p><strong>Status:</strong> ${escapeHtml(data.dataStatus ?? "complete")}</p>
        </div>
        <div class="summary">
          <div class="metric"><span>Total registrations</span><strong>${fmt.format(data.summary.total)}</strong></div>
          <div class="metric"><span>Monthly average</span><strong>${fmt.format(data.summary.monthlyAverage)}</strong></div>
          <div class="metric"><span>Peak month</span><strong>${escapeHtml(data.summary.peakMonth ? displayMonth(data.summary.peakMonth) : "-")}</strong></div>
          <div class="metric"><span>Rows</span><strong>${fmt.format(data.rows.length)}</strong></div>
        </div>
        ${data.warnings?.length ? `<h2>Warnings</h2><p class="warnings">${data.warnings.map(escapeHtml).join("<br>")}</p>` : ""}
        <h2>Parsed Filters</h2>
        <table><tbody>${filterTable}</tbody></table>
        <h2>Monthly Trend</h2>
        ${trendLineChart}
        <table><thead><tr><th>Month</th><th>Registrations</th></tr></thead><tbody>${trendRows}</tbody></table>
        <h2>Fuel Breakdown</h2>
        <table><thead><tr><th>Fuel type</th><th>Registrations</th></tr></thead><tbody>${fuelRows}</tbody></table>
        <h2>Result Rows</h2>
        <table>
          <thead><tr><th>Year</th><th>Month</th><th>State</th><th>RTO</th><th>Fuel type</th><th>Count</th><th>Scraped at</th></tr></thead>
          <tbody>${resultRows}</tbody>
        </table>
        <script>window.addEventListener("load", () => { window.print(); });</script>
      </body>
    </html>
  `);
  reportWindow.document.close();
}

/* API Call */

async function runQuery(query) {
  activeRefreshJobId = null;
  activeQueryController?.abort();
  const requestId = ++activeQueryRequestId;
  const controller = new AbortController();
  activeQueryController = controller;

  try {
    const response = await fetch("/api/query", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (requestId !== activeQueryRequestId) return { status: "stale", requestId };
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (requestId !== activeQueryRequestId) return { status: "stale", requestId };
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const retryHint = Number.isFinite(retryAfter) && retryAfter > 0
          ? ` Try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`
          : " Please try again shortly.";
        throw new Error(`${body.error ?? "Too many dashboard queries."}${retryHint}`);
      }
      throw new Error(body.error ?? `Query failed: ${response.status}`);
    }
    const data = await response.json();
    if (!render(data, query, requestId)) return { status: "stale", requestId };
    if (data.liveRefresh?.status === "pending" && data.liveRefresh.jobId) {
      activeRefreshJobId = data.liveRefresh.jobId;
      pollLiveRefresh(data.liveRefresh.jobId, requestId, query);
    }
    return { status: "rendered", requestId };
  } catch (error) {
    if (error.name === "AbortError" || requestId !== activeQueryRequestId) {
      return { status: "stale", requestId };
    }
    throw error;
  } finally {
    if (requestId === activeQueryRequestId && activeQueryController === controller) {
      activeQueryController = null;
    }
  }
}

async function pollLiveRefresh(jobId, requestId, query) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (requestId !== activeQueryRequestId || activeRefreshJobId !== jobId) return;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    if (requestId !== activeQueryRequestId || activeRefreshJobId !== jobId) return;

    const response = await fetch(`/api/query-refresh/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    if (!response.ok) {
      if (requestId === activeQueryRequestId && activeRefreshJobId === jobId) {
        const message = `Live refresh failed: ${response.status}`;
        activeRefreshJobId = null;
        if (latestData) {
          render({
            ...latestData,
            dataStatus: "fetch_failed",
            liveRefresh: latestData.liveRefresh
              ? { ...latestData.liveRefresh, status: "failed", error: message }
              : null,
            warnings: [...(latestData.warnings ?? []), message],
          }, query, requestId);
        } else {
          renderWarnings([message]);
        }
      }
      return;
    }

    const data = await response.json();
    if (requestId !== activeQueryRequestId || activeRefreshJobId !== jobId) return;
    if (data.liveRefresh?.status === "pending") continue;

    if (requestId === activeQueryRequestId && activeRefreshJobId === jobId) {
      activeRefreshJobId = null;
      render(data, query, requestId);
    }
    return;
  }

  if (requestId === activeQueryRequestId && activeRefreshJobId === jobId) {
    const message = "Public Dashboard refresh timed out. Submit the query again for the latest data.";
    activeRefreshJobId = null;
    if (latestData) {
      render({
        ...latestData,
        dataStatus: "fetch_failed",
        liveRefresh: latestData.liveRefresh
          ? { ...latestData.liveRefresh, status: "failed", error: message }
          : null,
        warnings: [...(latestData.warnings ?? []), message],
      }, query, requestId);
    } else {
      renderWarnings([message]);
    }
  }
}

/* Events */

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) {
    renderWarnings(["Enter a query before running the dashboard."]);
    input.focus();
    return;
  }
  input.value = query;
  const submissionToken = Symbol("query submission");
  activeSubmissionToken = submissionToken;
  latestResult = null;
  setText("answerHeading", `Loading evidence for “${query}”`);
  app.classList.add("loading");
  setExportButtonsEnabled(false);
  submitBtn.disabled = true;
  submitBtn.querySelector(".btn-text").textContent = "Loading answer...";
  renderWarnings([
    "Working on it. Saved data will appear first, then missing or latest months will refresh from VAHAN.",
  ]);
  try {
    await runQuery(query);
  } catch (error) {
    if (activeSubmissionToken === submissionToken) {
      renderWarnings([error.message]);
      app.classList.remove("loading");
    }
  } finally {
    if (activeSubmissionToken === submissionToken) {
      activeSubmissionToken = null;
      submitBtn.disabled = false;
      submitBtn.querySelector(".btn-text").textContent = "Show registrations";
    }
  }
});

downloadCsvBtn.addEventListener("click", downloadCurrentCsv);
downloadPdfBtn.addEventListener("click", openPrintableReport);
downloadMenu?.addEventListener("mouseenter", () => downloadMenuBtn?.setAttribute("aria-expanded", "true"));
downloadMenu?.addEventListener("mouseleave", () => downloadMenuBtn?.setAttribute("aria-expanded", "false"));
downloadMenu?.addEventListener("focusin", () => downloadMenuBtn?.setAttribute("aria-expanded", "true"));
downloadMenu?.addEventListener("focusout", (event) => {
  if (!downloadMenu.contains(event.relatedTarget)) {
    downloadMenuBtn?.setAttribute("aria-expanded", "false");
  }
});

dashboardModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.dashboardMode;
    dashboardLayout?.setAttribute("data-mode", mode);
    dashboardModeButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
  });
});

queryShortcutButtons.forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.query;
    input.focus();
  });
});

if (appFrame && sidebarTrigger && featureSidebar) {
  let closeSidebarTimer = null;
  let sidebarPinnedOpen = false;

  const openSidebar = () => {
    clearTimeout(closeSidebarTimer);
    appFrame.classList.add("sidebar-open");
    sidebarTrigger.setAttribute("aria-expanded", "true");
  };

  const closeSidebar = () => {
    if (sidebarPinnedOpen) return;
    closeSidebarTimer = setTimeout(() => {
      const activeElement = document.activeElement;
      if (
        sidebarTrigger.matches(":hover, :focus-visible") ||
        featureSidebar.matches(":hover") ||
        featureSidebar.contains(activeElement)
      ) {
        return;
      }
      appFrame.classList.remove("sidebar-open");
      sidebarTrigger.setAttribute("aria-expanded", "false");
    }, 120);
  };

  const closeSidebarImmediately = () => {
    clearTimeout(closeSidebarTimer);
    appFrame.classList.remove("sidebar-open");
    sidebarTrigger.setAttribute("aria-expanded", "false");
  };

  sidebarTrigger.setAttribute("aria-haspopup", "true");
  sidebarTrigger.setAttribute("aria-expanded", "false");
  sidebarTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    sidebarPinnedOpen = !sidebarPinnedOpen;
    if (sidebarPinnedOpen) {
      openSidebar();
    } else {
      closeSidebarImmediately();
    }
  });
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

  document.addEventListener("pointerdown", (event) => {
    if (!sidebarPinnedOpen || featureSidebar.contains(event.target) || sidebarTrigger.contains(event.target)) return;
    sidebarPinnedOpen = false;
    closeSidebarImmediately();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !appFrame.classList.contains("sidebar-open")) return;
    sidebarPinnedOpen = false;
    closeSidebarImmediately();
    sidebarTrigger.focus();
  });
}

setExportButtonsEnabled(false);
const initialQuery = new URLSearchParams(window.location.search).get("query");
const navigationType = performance.getEntriesByType("navigation")[0]?.type;
if (!initialQuery && navigationType === "reload") {
  try {
    sessionStorage.removeItem(DASHBOARD_STATE_KEY);
  } catch {
    // Storage can be unavailable; there is no persisted answer to clear.
  }
}
if (initialQuery) {
  input.value = initialQuery;
  runQuery(initialQuery).catch((error) => {
    renderWarnings([error.message]);
    app.classList.remove("loading");
  });
} else {
  const savedResult = readPersistedResult();
  if (savedResult) {
    input.value = savedResult.query;
    render(savedResult.data, savedResult.query, ++activeQueryRequestId);
  }
}
