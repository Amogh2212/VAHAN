/* ========================================================================
   VAHAN Dashboard — Frontend Logic
   ======================================================================== */

const form = document.querySelector("#queryForm");
const input = document.querySelector("#queryInput");
const warnings = document.querySelector("#warnings");
const submitBtn = document.querySelector("#submitBtn");
const app = document.querySelector("#app");

const fmt = new Intl.NumberFormat("en-IN");
const monthFmt = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });
let activeRefreshJobId = null;
let showZeroResultRows = false;

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
        <span>${displayMonth(item.month)}</span>
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
    "Working on it. Saved data will appear first, then missing or latest months will refresh from VAHAN.",
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
