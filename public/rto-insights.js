const appFrame = document.querySelector(".app-frame");
const sidebarTrigger = document.querySelector("#sidebarTrigger");
const featureSidebar = document.querySelector("#featureSidebar");
const form = document.querySelector("#rtoInsightForm");
const stateInput = document.querySelector("#insightState");
const radiusSelect = document.querySelector("#insightRadius");
const limitSelect = document.querySelector("#insightLimit");
const notice = document.querySelector("#rtoInsightsNotice");
const healthMeta = document.querySelector("#insightHealthMeta");
const healthStatus = document.querySelector("#insightHealthStatus");
const healthMetrics = document.querySelector("#insightHealthMetrics");
const healthPanel = document.querySelector(".rto-insight-health");
const rankMeta = document.querySelector("#insightRankMeta");
const rankList = document.querySelector("#insightRankList");
const quadrant = document.querySelector("#insightQuadrant");
const detailTitle = document.querySelector("#insightDetailTitle");
const detailMeta = document.querySelector("#insightDetailMeta");
const detailStatus = document.querySelector("#insightDetailStatus");
const detailBody = document.querySelector("#insightDetailBody");
const refreshButton = form?.querySelector('button[type="submit"]');

const fmt = new Intl.NumberFormat("en-IN");
const pct = new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 1 });
let rows = [];
let selectedKey = null;
let searchTimer = null;
let summaryRequestId = 0;
let detailRequestId = 0;

function setSidebarOpen(open) {
  appFrame?.classList.toggle("sidebar-open", open);
  sidebarTrigger?.setAttribute("aria-expanded", open ? "true" : "false");
}

sidebarTrigger?.addEventListener("click", () => {
  setSidebarOpen(!appFrame?.classList.contains("sidebar-open"));
});

document.addEventListener("click", (event) => {
  if (!appFrame?.classList.contains("sidebar-open")) return;
  if (featureSidebar?.contains(event.target) || sidebarTrigger?.contains(event.target)) return;
  setSidebarOpen(false);
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  loadSummary();
});

stateInput?.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadSummary(), 220);
});

function showNotice(message, type = "info") {
  if (!notice) return;
  notice.hidden = !message;
  notice.dataset.type = type;
  notice.textContent = message || "";
}

function setSourceState(state) {
  const unavailable = state === "unavailable";
  document.body.classList.toggle("rto-insights-source-error", unavailable);
  healthPanel?.classList.toggle("is-available", state === "available");
  healthPanel?.classList.toggle("is-unavailable", unavailable);
  for (const control of [stateInput, radiusSelect, limitSelect]) {
    if (control) control.disabled = unavailable;
  }
  if (refreshButton) {
    refreshButton.disabled = state === "loading";
    refreshButton.textContent = unavailable ? "Retry source" : state === "loading" ? "Checking source" : "Refresh";
  }
}

function sourcePrerequisite(title, message) {
  return `
    <div class="atlas-prerequisite">
      <span class="panel-kicker">Source prerequisite</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
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

async function loadSummary() {
  const requestId = ++summaryRequestId;
  showNotice("");
  setSourceState("loading");
  rankList.innerHTML = `<p class="result-empty">Loading RTO patterns.</p>`;
  detailStatus.textContent = "Loading";
  const params = new URLSearchParams({
    radiusKm: radiusSelect.value,
    limit: limitSelect.value,
  });
  if (stateInput.value.trim()) params.set("q", stateInput.value.trim());

  try {
    const body = await apiJson(`/api/rto-insights/summary?${params}`);
    if (requestId !== summaryRequestId) return;
    rows = body.rows ?? [];
    selectedKey = rows[0] ? rowKey(rows[0]) : null;
    setSourceState("available");
    renderHealth(body.coverage);
    renderRanks(rows, body.radiusKm);
    renderQuadrant(rows);
    if (rows[0]) {
      await loadDetail(rows[0]);
    } else {
      renderEmptyDetail();
    }
  } catch (error) {
    if (requestId !== summaryRequestId) return;
    console.error("RTO insights source request failed.", error);
    rows = [];
    setSourceState("unavailable");
    renderHealth(null);
    rankMeta.textContent = "Source unavailable";
    rankList.innerHTML = sourcePrerequisite(
      "Pattern ranking is paused.",
      "Restore database access, then retry the source check.",
    );
    quadrant.innerHTML = sourcePrerequisite(
      "The comparison plot is unavailable.",
      "No RTO evidence is shown until the source can be verified.",
    );
    renderEmptyDetail("No evidence can be inspected while the source is unavailable.");
    showNotice("RTO insights are temporarily unavailable. Restore database access, then retry.", "error");
  }
}

function renderHealth(coverage) {
  if (!coverage) {
    healthMeta.textContent = "Database-backed evidence is offline";
    healthStatus.textContent = "Unavailable";
    healthStatus.className = "status-pill tracked-run-failed";
    healthMetrics.innerHTML = sourcePrerequisite(
      "RTO market signals cannot be verified right now.",
      "Check the server database connection and retry before using this page for analysis.",
    );
    return;
  }
  const signaled = coverage.totalRtos ? coverage.signalRtos / coverage.totalRtos : 0;
  healthMeta.textContent = `VAHAN latest ${coverage.latestVahanSnapshot ?? "not loaded"}`;
  healthStatus.textContent = signaled > 0 ? "Signals loaded" : "OSM pending";
  healthStatus.className = `status-pill ${signaled > 0 ? "tracked-status-active" : "tracked-status-paused"}`;
  healthMetrics.innerHTML = [
    metricCard("RTO configs", fmt.format(coverage.totalRtos ?? 0), "Enabled daily coverage base"),
    metricCard("Located", fmt.format(coverage.locatedProfiles ?? 0), "Geocoded profiles across the catalog"),
    metricCard("OSM signals", fmt.format(coverage.signalRows ?? 0), `${fmt.format(coverage.signalRtos ?? 0)} RTOs with cached signals`),
    metricCard("Last OSM fetch", coverage.latestSignalFetch ? displayDateTime(coverage.latestSignalFetch) : "Pending", "Cached server-side"),
  ].join("");
}

function renderRanks(items, radiusKm) {
  rankMeta.textContent = items.length
    ? `${fmt.format(items.length)} RTOs ranked at ${radiusKm} km`
    : "No VAHAN rows loaded";
  if (!items.length) {
    rankList.innerHTML = `<p class="result-empty">Run the daily RTO collector first, then import OSM signals for ranked findings.</p>`;
    return;
  }
  rankList.innerHTML = items.map((item, index) => {
    const selected = rowKey(item) === selectedKey;
    return `
      <button type="button" class="rto-insight-rank-card${selected ? " selected" : ""}" data-key="${escapeHtml(rowKey(item))}">
        <span class="rank-index">${index + 1}</span>
        <span class="rank-main">
          <strong>${escapeHtml(item.rto)}</strong>
          <small>${escapeHtml(item.state)} · ${escapeHtml(item.title)}</small>
        </span>
        <span class="rank-score">${Math.round(item.score)}</span>
      </button>
    `;
  }).join("");
  rankList.querySelectorAll("button[data-key]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = rows.find((item) => rowKey(item) === button.dataset.key);
      if (!row) return;
      await selectRow(row, { scrollToDetail: true });
    });
  });
}

async function selectRow(row, { scrollToDetail = false } = {}) {
  selectedKey = rowKey(row);
  renderRanks(rows, radiusSelect.value);
  renderQuadrant(rows);
  await loadDetail(row);
  if (scrollToDetail) {
    document.querySelector(".rto-insight-detail-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
}

function renderQuadrant(items) {
  if (!items.length) {
    quadrant.innerHTML = `<p class="result-empty">No rows available.</p>`;
    return;
  }
  const maxChargers = Math.max(1, ...items.map((item) => item.chargerCount || 0));
  const maxEvShare = Math.max(0.01, ...items.map((item) => item.evShare || 0));
  const selectedRow = items.find((item) => rowKey(item) === selectedKey) ?? items[0];
  const selectedSummary = selectedRow
    ? `${pct.format(selectedRow.evShare || 0)} EV share, ${fmt.format(selectedRow.chargerCount || 0)} mapped chargers`
    : "Select an RTO to inspect the gap";
  const points = items.slice(0, 70).map((item, index) => {
    const baseX = 8 + Math.min(1, (item.evShare || 0) / maxEvShare) * 84;
    const baseY = 88 - Math.min(1, (item.chargerCount || 0) / maxChargers) * 76;
    const jitter = pointJitter(rowKey(item), index);
    const x = clamp(baseX + jitter.x, 7, 93);
    const y = clamp(baseY + jitter.y, 10, 89);
    const selected = rowKey(item) === selectedKey;
    const title = `${item.rto}: ${pct.format(item.evShare || 0)} EV share, ${fmt.format(item.chargerCount || 0)} chargers`;
    return `
      <button
        class="plot-point${selected ? " selected" : ""}"
        data-key="${escapeHtml(rowKey(item))}"
        style="left:${x}%;top:${y}%"
        title="${escapeHtml(title)}"
        aria-label="${escapeHtml(title)}"
      >
        <span>${escapeHtml(shortRto(item.rto))}</span>
      </button>
    `;
  }).join("");
  quadrant.innerHTML = `
    <div class="quadrant-canvas" role="img" aria-label="EV share and charger count quadrant">
      <div class="quadrant-plot-title">
        <strong>${escapeHtml(shortRto(selectedRow?.rto || "Selected RTO"))}</strong>
        <span>${escapeHtml(selectedSummary)}</span>
      </div>
      <div class="quadrant-label top-left">Chargers ahead</div>
      <div class="quadrant-label top-right">Strong adoption</div>
      <div class="quadrant-label bottom-left">Early market</div>
      <div class="quadrant-label bottom-right">Infra gap</div>
      <div class="axis x-axis">EV share</div>
      <div class="axis y-axis">Mapped chargers</div>
      <div class="axis-tick x-zero">0%</div>
      <div class="axis-tick x-max">${escapeHtml(pct.format(maxEvShare))}</div>
      <div class="axis-tick y-zero">0</div>
      <div class="axis-tick y-max">${escapeHtml(fmt.format(maxChargers))}</div>
      <div class="quad-line vertical"></div>
      <div class="quad-line horizontal"></div>
      <div class="quadrant-plot-area"></div>
      ${points}
    </div>
  `;
  quadrant.querySelectorAll(".plot-point").forEach((point) => {
    point.addEventListener("click", async () => {
      const row = rows.find((item) => rowKey(item) === point.dataset.key);
      if (!row) return;
      await selectRow(row, { scrollToDetail: true });
    });
  });
}

function pointJitter(key, index) {
  let hash = index + 17;
  for (const char of String(key || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  }
  return {
    x: ((hash % 9) - 4) * 0.45,
    y: (((Math.floor(hash / 9) % 9) - 4) * 0.45),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

async function loadDetail(row) {
  const requestId = ++detailRequestId;
  detailTitle.textContent = row.rto;
  detailMeta.textContent = `${row.state} · ${row.latestSnapshotDate ?? "snapshot pending"}`;
  detailStatus.textContent = row.severity;
  detailStatus.className = `status-pill severity-${row.severity}`;
  detailBody.innerHTML = `<p class="result-empty">Loading evidence.</p>`;
  const params = new URLSearchParams({
    state: row.state,
    rto: row.rto,
    radiusKm: radiusSelect.value,
  });
  try {
    const body = await apiJson(`/api/rto-insights/rto?${params}`);
    if (requestId !== detailRequestId) return;
    const detail = body.row ?? row;
    detailBody.innerHTML = `
      <div class="rto-insight-detail-grid">
        ${metricCard("Pattern score", Math.round(detail.score), escapeHtml(detail.title))}
        ${metricCard("EV share", pct.format(detail.evShare || 0), `${fmt.format(detail.evTotal || 0)} EV report total`)}
        ${metricCard("Chargers", fmt.format(detail.chargerCount || 0), `${fmt.format(detail.publicChargerCount || 0)} likely public`)}
        ${metricCard("Premium proxy", fmt.format(Math.round(detail.premiumProxy || 0)), "POI-density score")}
      </div>
      <div class="rto-insight-explain">
        <strong>${escapeHtml(detail.title)}</strong>
        <p>${escapeHtml(detail.summary)}</p>
      </div>
      ${renderTrend(body.trends ?? [])}
      ${renderSignalBars(body.signals ?? [])}
    `;
  } catch (error) {
    if (requestId !== detailRequestId) return;
    console.warn("RTO insight detail request could not be matched.", error);
    detailStatus.textContent = "Partial";
    detailStatus.className = "status-pill severity-interesting";
    detailBody.innerHTML = sourcePrerequisite(
      "Detailed evidence is not available for this catalog entry.",
      "The ranking summary remains visible, but the drill-down source could not be matched.",
    );
  }
}

function renderTrend(trends) {
  if (!trends.length) return `<div class="rto-insight-explain"><strong>Trend</strong><p>No daily report trend rows are available for this RTO yet.</p></div>`;
  const max = Math.max(1, ...trends.map((item) => item.evTotal || 0));
  const bars = trends.slice(-14).map((item) => {
    const height = Math.max(4, Math.round(((item.evTotal || 0) / max) * 80));
    return `<span style="height:${height}px" title="${escapeHtml(item.snapshotDate)} · ${fmt.format(item.evTotal || 0)} EV"></span>`;
  }).join("");
  return `<div class="rto-insight-trend"><div><strong>EV trend</strong><small>${trends.at(-1)?.snapshotDate ?? ""}</small></div><div class="mini-bars">${bars}</div></div>`;
}

function renderSignalBars(signals) {
  if (!signals.length) return `<div class="rto-insight-explain"><strong>OSM signals</strong><p>No cached OSM signals for this radius yet.</p></div>`;
  const max = Math.max(1, ...signals.map((item) => item.numericValue || 0));
  const rows = signals.map((signal) => {
    const width = Math.max(2, Math.round(((signal.numericValue || 0) / max) * 100));
    return `
      <div class="signal-bar-row">
        <span>${escapeHtml(signalLabel(signal.signalKey))}</span>
        <div><i style="width:${width}%"></i></div>
        <strong>${fmt.format(signal.numericValue || 0)}</strong>
      </div>
    `;
  }).join("");
  return `<div class="rto-insight-signal-bars">${rows}</div>`;
}

function renderEmptyDetail(message = "No RTO selected.") {
  detailTitle.textContent = "Selected RTO";
  detailMeta.textContent = "Choose a row to inspect evidence";
  detailStatus.textContent = "Idle";
  detailStatus.className = "status-pill";
  detailBody.innerHTML = `<p class="result-empty">${escapeHtml(message)}</p>`;
}

function metricCard(label, value, detail) {
  return `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`;
}

function rowKey(row) {
  return `${encodeURIComponent(row.state ?? "")}|${encodeURIComponent(row.rto ?? "")}`;
}

function shortRto(value) {
  return String(value || "").replace(/\([^)]*\)/g, "").split(/\s+-\s+|\s+/).filter(Boolean).slice(0, 2).join(" ");
}

function signalLabel(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function displayDateTime(value) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

loadSummary();
