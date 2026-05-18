/* ========================================================================
   VAHAN Dashboard — Frontend Logic
   ======================================================================== */

const form = document.querySelector("#queryForm");
const input = document.querySelector("#queryInput");
const warnings = document.querySelector("#warnings");
const submitBtn = document.querySelector("#submitBtn");
const app = document.querySelector("#app");

const fmt = new Intl.NumberFormat("en-IN");
let activeRefreshJobId = null;

/* ── Helpers ────────────────────────────────────────────────────────────── */

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

/* ── Renderers ──────────────────────────────────────────────────────────── */

function renderFilters(filters) {
  const el = document.querySelector("#filters");
  const entries = [
    ["Fuel segment", filters.fuelSegment ?? "All"],
    ["Fuel type", filters.fuelType ?? "All"],
    ["State", filters.state ?? "All loaded states"],
    ["RTO", filters.rto ?? filters.locationText ?? "All loaded RTOs"],
    ["From", filters.from ?? "-"],
    ["To", filters.to ?? "-"],
  ];
  el.innerHTML = entries
    .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`)
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
        <span>${item.month}</span>
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
        <span>${item.fuelType}</span>
        <strong>${fmt.format(item.count)}</strong>
      </div>
    `,
    )
    .join("");
}

function renderRowChart(rows, dataStatus) {
  const el = document.querySelector("#rowChart");
  if (!rows.length) {
    const message =
      dataStatus === "fetch_failed"
        ? "Could not fetch fresh VAHAN data for this query."
        : "No rows matched this query.";
    el.innerHTML = `<p style="color:var(--text-muted)">${message}</p>`;
    return;
  }

  const max = Math.max(1, ...rows.map((row) => row.vehicle_count));
  el.innerHTML = `
    <div class="row-chart-scroll" role="img" aria-label="Vertical chart of returned result rows">
      <div class="row-chart-plot">
        ${rows
          .map((row, i) => {
            const month = `${row.year}-${String(row.month).padStart(2, "0")}`;
            const height = (row.vehicle_count / max) * 100;
            const title = `${month} | ${row.state} | ${row.rto} | ${row.fuel_type} | ${fmt.format(row.vehicle_count)}`;

            return `
              <div class="row-chart-group" title="${escapeAttribute(title)}" style="animation: fadeSlideIn 0.4s var(--ease-out) ${i * 0.02}s both">
                <div class="row-chart-value">${fmt.format(row.vehicle_count)}</div>
                <div class="row-chart-column">
                  <span class="row-chart-fill" style="height:${height}%"></span>
                </div>
                <div class="row-chart-label">
                  <span>${month}</span>
                  <span>${row.fuel_type}</span>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderRows(rows, dataStatus) {
  const el = document.querySelector("#rows");
  if (!rows.length) {
    const message =
      dataStatus === "fetch_failed"
        ? "Could not fetch fresh VAHAN data for this query."
        : "No rows matched this query.";
    el.innerHTML = `<tr><td colspan="6" style="color:var(--text-muted);text-align:center;padding:24px">${message}</td></tr>`;
    return;
  }
  el.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${row.year}-${String(row.month).padStart(2, "0")}</td>
        <td>${row.state}</td>
        <td>${row.rto}</td>
        <td>${row.fuel_segment}</td>
        <td>${row.fuel_type}</td>
        <td>${fmt.format(row.vehicle_count)}</td>
      </tr>
    `,
    )
    .join("");
}

function renderWarnings(items) {
  const uniqueItems = [...new Set((items ?? []).filter(Boolean))];
  warnings.hidden = !uniqueItems.length;
  warnings.innerHTML = uniqueItems.length
    ? uniqueItems.map((item) => `<div>${item}</div>`).join("")
    : "";
}

/* ── Main Render ────────────────────────────────────────────────────────── */

function render(data) {
  // Animate counters
  animateCounter(document.querySelector("#total"), data.summary.total);
  animateCounter(document.querySelector("#average"), data.summary.monthlyAverage);
  animateCounter(document.querySelector("#rowCount"), data.rows.length);

  setText(
    "peak",
    data.summary.peakMonth
      ? `${data.summary.peakMonth} (${fmt.format(data.summary.peakMonthCount)})`
      : "-",
  );

  document.querySelector("#freshness").textContent =
    `${data.freshness.source}. Latest loaded month: ${data.freshness.latestMonth ?? "not available"}. Status: ${data.dataStatus ?? "complete"}. Save: ${data.persistenceStatus ?? "saved"}.`;

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
          ? [`Showing stored historical data while refreshing ${data.liveRefresh?.requiredMonths?.join(", ") ?? "recent months"} from VAHAN.`]
        : data.dataStatus === "partial"
          ? ["Some requested months are missing from the local dataset."]
          : [];
  renderWarnings([...scraperMessage, ...statusMessage, ...(data.warnings ?? [])]);

  renderFilters(data.filters);
  renderTrend(data.trend);
  renderFuelBreakdown(data.fuelBreakdown);
  renderRowChart(data.rows, data.dataStatus);
  renderRows(data.rows, data.dataStatus);

  // Remove loading state
  app.classList.remove("loading");
}

/* ── API Call ────────────────────────────────────────────────────────────── */

async function runQuery(query) {
  activeRefreshJobId = null;
  const response = await fetch("/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`Query failed: ${response.status}`);
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

/* ── Events ─────────────────────────────────────────────────────────────── */

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  activeRefreshJobId = null;
  app.classList.add("loading");
  submitBtn.disabled = true;
  submitBtn.querySelector(".btn-text").textContent = "Working…";
  renderWarnings([
    "Working on it. Stored historical data will appear first if recent months need a live VAHAN refresh.",
  ]);
  try {
    await runQuery(input.value);
  } catch (error) {
    renderWarnings([error.message]);
    app.classList.remove("loading");
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector(".btn-text").textContent = "Run Query";
  }
});

// Run default query on load
runQuery(input.value);
