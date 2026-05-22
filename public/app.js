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

const fmt = new Intl.NumberFormat("en-IN");
const monthFmt = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });
let activeRefreshJobId = null;
let showZeroResultRows = false;
let latestQuery = "";
let latestData = null;

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

/* Renderers */

function renderFilters(filters) {
  const el = document.querySelector("#filters");
  el.innerHTML = filterEntries(filters)
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
}

function renderTrend(trend) {
  const el = document.querySelector("#trend");
  const max = Math.max(1, ...trend.map((item) => item.count));
  if (!trend.length) {
    el.innerHTML = `<p style="color:var(--text-muted)">No trend data for these filters.</p>`;
    return;
  }
  el.innerHTML = trend
    .map(
      (item, i) => `
      <div class="bar" style="animation: fadeSlideIn 0.4s var(--ease-out) ${i * 0.04}s both">
        <span>${escapeHtml(displayMonth(item.month))}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(item.count / max) * 100}%"></span></span>
        <strong>${fmt.format(item.count)}</strong>
      </div>
    `,
    )
    .join("");
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

      return `
        <article class="result-card" style="animation: fadeSlideIn 0.4s var(--ease-out) ${index * 0.03}s both">
          <div class="result-card-head">
            <div>
              <span>${displayMonth(month)}</span>
              <small>${escapeHtml(location)}</small>
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

function renderWarnings(items) {
  const uniqueItems = [...new Set((items ?? []).filter(Boolean))];
  warnings.hidden = !uniqueItems.length;
  warnings.innerHTML = uniqueItems.length
    ? uniqueItems.map((item) => `<div>${escapeHtml(item)}</div>`).join("")
    : "";
}

/* Main Render */

function render(data) {
  latestData = data;
  setExportButtonsEnabled(Boolean(latestData));
  // Animate counters
  animateCounter(document.querySelector("#total"), data.summary.total);
  animateCounter(document.querySelector("#average"), data.summary.monthlyAverage);
  animateCounter(document.querySelector("#rowCount"), data.rows.length);

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
      ? [`Auto-scraped missing VAHAN data for ${data.scraper.runs.map((run) => `${run.year}`).join(", ")} before answering.`]
      : [`Live VAHAN fetch failed for ${data.scraper.failedRuns?.length ?? 0} run(s). Results may be missing or stale.`]
    : [];
  const statusMessage =
    data.dataStatus === "fetch_failed"
      ? ["Fresh data could not be fetched, and no cached rows matched this query."]
      : data.dataStatus === "stale"
        ? ["Showing stale local data because the live fetch failed."]
        : data.dataStatus === "live"
          ? ["Showing freshly scraped VAHAN data while it is saved in the background."]
        : data.dataStatus === "refreshing"
          ? [`Showing saved data now. Missing or latest months (${displayMonthList(data.liveRefresh?.requiredMonths) || "requested months"}) are being fetched from VAHAN; the dashboard will update automatically.`]
        : data.dataStatus === "partial"
          ? ["Some requested months are missing from the local dataset."]
          : [];
  renderWarnings([...scraperMessage, ...statusMessage, ...(data.warnings ?? [])]);

  renderFilters(data.filters);
  renderTrend(data.trend);
  renderFuelBreakdown(data.fuelBreakdown);
  renderResultCards(data.rows, data.dataStatus);

  // Remove loading state
  app.classList.remove("loading");
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
  if (!latestData) return;
  const filename = `${slugifyFilename(latestQuery)}-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadBlob(filename, buildReportCsv(latestData, latestQuery), "text/csv;charset=utf-8");
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

function openPrintableReport() {
  if (!latestData) return;
  const data = latestData;
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
        <p><strong>Query:</strong> ${escapeHtml(latestQuery)}</p>
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
  latestQuery = query;
  const response = await fetch("/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Query failed: ${response.status}`);
  }
  const data = await response.json();
  render(data);
  if (data.liveRefresh?.status === "pending" && data.liveRefresh.jobId) {
    activeRefreshJobId = data.liveRefresh.jobId;
    pollLiveRefresh(data.liveRefresh.jobId);
  }
}

async function pollLiveRefresh(jobId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (activeRefreshJobId !== jobId) return;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    if (activeRefreshJobId !== jobId) return;

    const response = await fetch(`/api/query-refresh/${encodeURIComponent(jobId)}`);
    if (!response.ok) {
      renderWarnings([`Live refresh failed: ${response.status}`]);
      return;
    }

    const data = await response.json();
    if (data.liveRefresh?.status === "pending") continue;

    if (activeRefreshJobId === jobId) {
      activeRefreshJobId = null;
      render(data);
    }
    return;
  }

  if (activeRefreshJobId === jobId) {
    renderWarnings(["Live VAHAN refresh is still running. Submit the query again in a few minutes for the latest data."]);
  }
}

/* Events */

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  activeRefreshJobId = null;
  const query = input.value.trim();
  if (!query) {
    renderWarnings(["Enter a query before running the dashboard."]);
    input.focus();
    return;
  }
  input.value = query;
  app.classList.add("loading");
  setExportButtonsEnabled(false);
  submitBtn.disabled = true;
  submitBtn.querySelector(".btn-text").textContent = "Working...";
  renderWarnings([
    "Working on it. Saved data will appear first, then missing or latest months will refresh from VAHAN.",
  ]);
  try {
    await runQuery(query);
  } catch (error) {
    renderWarnings([error.message]);
    app.classList.remove("loading");
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector(".btn-text").textContent = "Run Query";
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

// Run default query on load
setExportButtonsEnabled(false);
const initialQuery = new URLSearchParams(window.location.search).get("query");
if (initialQuery) input.value = initialQuery;
runQuery(input.value);
