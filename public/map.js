const mapSvg = document.querySelector("#indiaMap");
const mapTooltip = document.querySelector("#mapTooltip");
const coverageText = document.querySelector("#coverageText");
const mapFilters = document.querySelector("#mapFilters");
const mapQueryInput = document.querySelector("#mapQueryInput");
const mapPanelTitle = document.querySelector(".map-panel-head h2");
const mapLegend = document.querySelector(".map-legend");
const mapColorToggle = document.querySelector(".map-color-toggle");
const fetchAllStatesBtn = document.querySelector("#fetchAllStatesBtn");
const mapFetchStatus = document.querySelector("#mapFetchStatus");
const mapFetchProgress = document.querySelector("#mapFetchProgress");
const mapParsedFilters = document.querySelector("#mapParsedFilters");
const mapProgressLabel = document.querySelector("#mapProgressLabel");
const mapProgressCount = document.querySelector("#mapProgressCount");
const mapProgressFill = document.querySelector("#mapProgressFill");
const mapCurrentState = document.querySelector("#mapCurrentState");
const mapRemainingStates = document.querySelector("#mapRemainingStates");
const mapProgressList = document.querySelector("#mapProgressList");
const resetMapBtn = document.querySelector("#resetMapBtn");
const mapZoomOutBtn = document.querySelector("#mapZoomOutBtn");
const selectedStateTitle = document.querySelector("#selectedStateTitle");
const stateSummary = document.querySelector("#stateSummary");
const mapBucketList = document.querySelector("#mapBucketList");
const rtoList = document.querySelector("#rtoList");
const appFrame = document.querySelector(".app-frame");
const sidebarTrigger = document.querySelector("#sidebarTrigger");
const featureSidebar = document.querySelector("#featureSidebar");

const fmt = new Intl.NumberFormat("en-IN");
const pctFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const CLIENT_FETCH_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu & Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Dadra and Nagar Haveli",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];
let stateData = new Map();
let selectedState = null;
let activeMapJobId = null;
let latestMapFilters = null;
let selectedLegendLevels = new Set();
let currentLegendMetric = null;
let currentLegendMode = null;
let mapColorMode = "heat";
let activeTooltipState = null;
let latestStateDetailData = null;

function setFetchButtonBusy(isBusy) {
  fetchAllStatesBtn.disabled = isBusy;
  fetchAllStatesBtn.textContent = isBusy ? "Fetching..." : "Fetch all states";
}

function setMapStatus(message, kind = "info") {
  mapFetchStatus.textContent = message;
  mapFetchStatus.className = `map-fetch-status ${kind}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function percent(value) {
  return value === null || value === undefined ? "No data" : `${pctFmt.format(value * 100)}%`;
}

function signedPercentPoints(value) {
  if (value === null || value === undefined) return "No data";
  const sign = value > 0 ? "+" : "";
  return `${sign}${pctFmt.format(value * 100)} pts`;
}

function signedCount(value) {
  if (value === null || value === undefined) return "No data";
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmt.format(Math.round(value))}`;
}

function mapValue(item, filters = latestMapFilters) {
  if (!item || item.rowCount === 0) return null;
  return mapMetric(filters) === "registrations" ? item.total : item.evShare;
}

function comparisonBaseline(filters = latestMapFilters) {
  const loaded = [...stateData.values()].filter((item) => item.rowCount > 0);
  if (!loaded.length) return null;
  if (mapMetric(filters) === "registrations") {
    const total = loaded.reduce((sum, item) => sum + item.total, 0);
    return total / loaded.length;
  }
  const total = loaded.reduce((sum, item) => sum + item.total, 0);
  const evTotal = loaded.reduce((sum, item) => sum + item.evTotal, 0);
  return total > 0 ? evTotal / total : null;
}

function comparisonDelta(item, filters = latestMapFilters) {
  const baseline = comparisonBaseline(filters);
  const value = mapValue(item, filters);
  if (baseline === null || value === null) return null;
  return value - baseline;
}

function formatMapValue(value, filters = latestMapFilters) {
  if (value === null || value === undefined) return "No data";
  return mapMetric(filters) === "registrations" ? fmt.format(Math.round(value)) : percent(value);
}

function formatComparisonDelta(delta, filters = latestMapFilters) {
  if (delta === null || delta === undefined) return "No data";
  return mapMetric(filters) === "registrations" ? signedCount(delta) : signedPercentPoints(delta);
}

function levelFor(item) {
  if (!item || item.rowCount === 0 || item.evShare === null) return "is-empty";
  if (mapColorMode === "compare") return comparisonLevelFor(item);
  if (mapMetric() === "registrations") return "level-2";
  if (item.evShare >= 0.3) return "level-4";
  if (item.evShare >= 0.15) return "level-3";
  if (item.evShare >= 0.05) return "level-2";
  return "level-1";
}

function comparisonLevelFor(item) {
  const delta = comparisonDelta(item);
  const baseline = comparisonBaseline();
  if (!item || item.rowCount === 0 || delta === null || baseline === null) return "is-empty";
  if (mapMetric() === "registrations") {
    const ratio = baseline > 0 ? delta / baseline : 0;
    if (ratio <= -0.3) return "compare-lowest";
    if (ratio < -0.1) return "compare-low";
    if (ratio <= 0.1) return "compare-mid";
    if (ratio < 0.3) return "compare-high";
    return "compare-highest";
  }
  if (delta <= -0.1) return "compare-lowest";
  if (delta < -0.02) return "compare-low";
  if (delta <= 0.02) return "compare-mid";
  if (delta < 0.1) return "compare-high";
  return "compare-highest";
}

function legendLevelFor(item) {
  return levelFor(item);
}

function legendAllows(item) {
  return selectedLegendLevels.size === 0 || selectedLegendLevels.has(legendLevelFor(item));
}

function legendItems(filters = latestMapFilters) {
  const nextMetric = mapMetric(filters);
  if (mapColorMode === "compare") {
    return [
      ["is-empty", "No data"],
      ["compare-lowest", "Far below avg"],
      ["compare-low", "Below avg"],
      ["compare-mid", "Near avg"],
      ["compare-high", "Above avg"],
      ["compare-highest", "Far above avg"],
    ];
  }
  if (nextMetric === "registrations") {
    return [
      ["is-empty", "No data"],
      ["level-2", "Matching rows"],
    ];
  }
  return [
    ["is-empty", "No data"],
    ["level-1", "0-5%"],
    ["level-2", "5-15%"],
    ["level-3", "15-30%"],
    ["level-4", "30%+"],
  ];
}

function legendLabel(level, filters = latestMapFilters) {
  return legendItems(filters).find(([itemLevel]) => itemLevel === level)?.[1] ?? level;
}

function mapMetric(filters = latestMapFilters) {
  return filters?.metric === "registrations" ? "registrations" : "ev_share";
}

function metricLabel(filters = latestMapFilters) {
  return mapMetric(filters) === "registrations" ? "Registrations" : "EV share";
}

function currentParams() {
  const params = new URLSearchParams();
  const query = mapQueryInput?.value.trim();
  const from = document.querySelector("#mapFrom")?.value.trim();
  const to = document.querySelector("#mapTo")?.value.trim();
  if (query) params.set("query", query);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return params;
}

function currentBody() {
  return {
    query: mapQueryInput?.value.trim() ?? "",
    from: document.querySelector("#mapFrom")?.value.trim() || null,
    to: document.querySelector("#mapTo")?.value.trim() || null,
    vehicleCategories: [],
    norms: [],
    vehicleClasses: [],
  };
}

function monthKeyNumber(value) {
  const [year, month] = String(value ?? "").split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return year * 100 + month;
}

function validateMonthRange() {
  const from = document.querySelector("#mapFrom")?.value.trim();
  const to = document.querySelector("#mapTo")?.value.trim();
  const fromNumber = monthKeyNumber(from);
  const toNumber = monthKeyNumber(to);
  if (!fromNumber || !toNumber) return "Enter both months in YYYY-MM format.";
  if (fromNumber > toNumber) return `From month ${from} is after To month ${to}. Swap them or choose an earlier From month.`;
  return null;
}

function dashboardQuery(state, rto = null) {
  const from = document.querySelector("#mapFrom")?.value.trim();
  const to = document.querySelector("#mapTo")?.value.trim();
  const baseQuery = mapQueryInput?.value.trim() || "registrations";
  const location = rto ? `${rto}, ${state}` : state;
  const parts = [baseQuery, "in", location];
  if (from && to) parts.push(`from ${from} to ${to}`);
  return parts.join(" ");
}

function renderMapSkeleton() {
  mapSvg.innerHTML = `
    <g class="india-map-layer">
      ${window.INDIA_STATE_GEOMETRY.map((shape) => `
        <g class="map-state-group" data-state="${escapeHtml(shape.state)}">
          <path class="map-state is-empty" d="${shape.d}" tabindex="0" role="button" aria-label="${escapeHtml(shape.state)}"></path>
          <text class="map-label" x="${shape.labelX}" y="${shape.labelY}">${escapeHtml(shape.label)}</text>
        </g>
      `).join("")}
    </g>
  `;

  for (const group of mapSvg.querySelectorAll(".map-state-group")) {
    const path = group.querySelector("path");
    path.addEventListener("mouseenter", (event) => showTooltip(event, group.dataset.state));
    path.addEventListener("mousemove", (event) => moveTooltip(event));
    path.addEventListener("mouseleave", hideTooltip);
    path.addEventListener("click", () => {
      if (selectedState === group.dataset.state) {
        resetZoom();
      } else {
        selectState(group.dataset.state);
      }
    });
    path.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectState(group.dataset.state);
      }
    });
  }
}

function applyMapData(states) {
  stateData = new Map(states.map((item) => [item.state, item]));
  for (const group of mapSvg.querySelectorAll(".map-state-group")) {
    const item = stateData.get(group.dataset.state);
    const path = group.querySelector("path");
    const classes = [
      "map-state",
      levelFor(item),
      selectedState === group.dataset.state ? "selected" : "",
      legendAllows(item) ? "" : "is-muted",
    ].filter(Boolean);
    path.className.baseVal = classes.join(" ");
    path.setAttribute(
      "aria-label",
      `${group.dataset.state}: ${item?.rowCount ? `${metricLabel()} ${formatMapValue(mapValue(item))}` : "no saved data"}`,
    );
  }
  renderBucketList();
}

function showTooltip(event, state) {
  const item = stateData.get(state);
  activeTooltipState = state;
  const primaryLabel = metricLabel();
  const primaryValue = formatMapValue(mapValue(item));
  const baseline = comparisonBaseline();
  const delta = comparisonDelta(item);
  const comparisonRows = mapColorMode === "compare"
    ? `
      <span>India avg: ${escapeHtml(formatMapValue(baseline))}</span>
      <span>Diff: ${escapeHtml(formatComparisonDelta(delta))}</span>
    `
    : "";
  mapTooltip.innerHTML = `
    <strong>${escapeHtml(state)}</strong>
    <span>${escapeHtml(primaryLabel)}: ${escapeHtml(primaryValue)}</span>
    ${comparisonRows}
    <span>EV: ${fmt.format(item?.evTotal ?? 0)}</span>
    <span>Total: ${fmt.format(item?.total ?? 0)}</span>
    <span>RTOs: ${fmt.format(item?.rtoCount ?? 0)}</span>
  `;
  mapTooltip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  const activeState = stateFromPointer(event);
  if (!activeState) {
    hideTooltip();
    return;
  }
  if (activeState !== activeTooltipState) showTooltip(event, activeState);
  const stageBox = document.querySelector("#mapStage").getBoundingClientRect();
  mapTooltip.style.left = `${event.clientX - stageBox.left + 14}px`;
  mapTooltip.style.top = `${event.clientY - stageBox.top + 14}px`;
}

function hideTooltip() {
  activeTooltipState = null;
  mapTooltip.hidden = true;
}

function stateFromPointer(event) {
  for (const group of mapSvg.querySelectorAll(".map-state-group")) {
    const path = group.querySelector(".map-state");
    if (pointerIsInsidePath(event, path)) return group.dataset.state;
  }
  return null;
}

function pointerIsInsidePath(event, path) {
  if (!path?.getScreenCTM) return false;
  const matrix = path.getScreenCTM();
  if (!matrix) return false;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  if (typeof path.isPointInFill === "function" && !path.isPointInFill(point)) return false;
  if (typeof path.isPointInStroke === "function" && path.isPointInStroke(point)) return true;
  return typeof path.isPointInFill === "function" ? path.isPointInFill(point) : false;
}

document.querySelector("#mapStage")?.addEventListener("pointermove", (event) => {
  const state = stateFromPointer(event);
  if (!state) {
    hideTooltip();
    return;
  }
  if (state !== activeTooltipState) {
    showTooltip(event, state);
  } else {
    moveTooltip(event);
  }
});

document.querySelector("#mapStage")?.addEventListener("pointerleave", hideTooltip);

mapSvg.addEventListener("click", (event) => {
  if (event.target?.classList?.contains("map-state")) return;
  if (selectedState) resetZoom();
});

function zoomToState(state) {
  const path = mapSvg.querySelector(`[data-state="${CSS.escape(state)}"] path`);
  if (!path) return;
  const box = path.getBBox();
  const pad = 42;
  mapSvg.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`);
}

function setZoomOutVisible(isVisible) {
  if (!mapZoomOutBtn) return;
  mapZoomOutBtn.hidden = !isVisible;
  mapZoomOutBtn.disabled = !isVisible;
}

function resetZoom() {
  selectedState = null;
  latestStateDetailData = null;
  mapSvg.setAttribute("viewBox", "0 0 620 760");
  setZoomOutVisible(false);
  applyMapData([...stateData.values()]);
  selectedStateTitle.textContent = "Select a state";
  stateSummary.innerHTML = `<p class="compare-empty">Click a loaded state to inspect EV share and available RTO rows.</p>`;
  renderBucketList();
  rtoList.innerHTML = "";
}

async function selectState(state) {
  selectedState = state;
  zoomToState(state);
  setZoomOutVisible(true);
  applyMapData([...stateData.values()]);
  selectedStateTitle.textContent = state;
  stateSummary.innerHTML = `<p class="compare-empty">Loading saved state data.</p>`;
  rtoList.innerHTML = "";
  try {
    const params = currentParams();
    const response = await fetch(`/api/map/state/${encodeURIComponent(state)}/rtos?${params}`);
    if (!response.ok) throw new Error(`RTO drill-down failed: ${response.status}`);
    const data = await response.json();
    renderStateDetail(data);
  } catch (error) {
    stateSummary.innerHTML = `<p class="compare-empty">${escapeHtml(error.message)}</p>`;
  }
}

function renderStateDetail(data) {
  latestStateDetailData = data;
  const item = data.state;
  latestMapFilters = data.filters ?? latestMapFilters;
  selectedStateTitle.textContent = item.state;
  const query = dashboardQuery(item.state);
  const primaryLabel = metricLabel(data.filters);
  const primaryValue = formatMapValue(mapValue(item, data.filters), data.filters);
  const baseline = comparisonBaseline(data.filters);
  const delta = comparisonDelta(item, data.filters);
  const comparisonMetrics = mapColorMode === "compare"
    ? `
      <div class="metric"><span>India avg</span><strong>${escapeHtml(formatMapValue(baseline, data.filters))}</strong></div>
      <div class="metric"><span>Diff vs avg</span><strong>${escapeHtml(formatComparisonDelta(delta, data.filters))}</strong></div>
    `
    : "";
  stateSummary.innerHTML = `
    <div class="map-metric-grid">
      <div class="metric"><span>${escapeHtml(primaryLabel)}</span><strong>${escapeHtml(primaryValue)}</strong></div>
      <div class="metric"><span>EV registrations</span><strong>${fmt.format(item.evTotal)}</strong></div>
      <div class="metric"><span>Total</span><strong>${fmt.format(item.total)}</strong></div>
      <div class="metric"><span>Saved RTOs</span><strong>${fmt.format(item.rtoCount)}</strong></div>
      ${comparisonMetrics}
    </div>
    <a class="back-link map-query-link" href="/?query=${encodeURIComponent(query)}">Run dashboard query</a>
  `;

  if (!item.rowCount) {
    rtoList.innerHTML = `<p class="compare-empty">No saved data is available for this state in the selected range.</p>`;
    return;
  }

  if (!data.rtos.length) {
    rtoList.innerHTML = `<p class="compare-empty">Only aggregate state data is saved for this state. RTO-level drill-down will appear after RTO rows are loaded.</p>`;
    return;
  }

  rtoList.innerHTML = data.rtos
    .map((rto) => {
      const rtoQuery = dashboardQuery(item.state, rto.rto);
      return `
        <article class="rto-card">
          <div>
            <strong>${escapeHtml(rto.rto)}</strong>
            <span>${rto.months.length ? `${rto.months[0]} to ${rto.months.at(-1)}` : "No month range"}</span>
          </div>
          <div class="rto-card-metrics">
            <span>${mapMetric(data.filters) === "registrations" ? `${fmt.format(rto.total)} registrations` : `${percent(rto.evShare)} EV`}</span>
            <span>${fmt.format(rto.evTotal)} / ${fmt.format(rto.total)}</span>
          </div>
          <div class="rto-fuels">${rto.topFuels.map((fuel) => `<span>${escapeHtml(fuel.fuelType)} ${fmt.format(fuel.count)}</span>`).join("")}</div>
          <a class="back-link" href="/?query=${encodeURIComponent(rtoQuery)}">Run query</a>
        </article>
      `;
    })
    .join("");
}

function renderBucketList() {
  if (!mapBucketList) return;
  if (!selectedLegendLevels.size) {
    mapBucketList.innerHTML = `
      <section class="map-bucket-card empty">
        <div class="map-bucket-head">
          <span class="eyebrow">Selected bucket</span>
          <strong>No color bucket selected</strong>
        </div>
        <p class="compare-empty">Choose a color index filter above the map to see every state in that category.</p>
      </section>
    `;
    return;
  }

  const activeLevels = [...selectedLegendLevels];
  const matchingStates = [...stateData.values()]
    .filter((item) => selectedLegendLevels.has(legendLevelFor(item)))
    .sort((left, right) => {
      const leftValue = mapValue(left);
      const rightValue = mapValue(right);
      if (leftValue === null && rightValue === null) return left.state.localeCompare(right.state);
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      return rightValue - leftValue || left.state.localeCompare(right.state);
    });
  const title = activeLevels.map((level) => legendLabel(level)).join(", ");
  const statesMarkup = matchingStates.length
    ? matchingStates
      .map((item) => `
        <button type="button" class="map-bucket-state${selectedState === item.state ? " active" : ""}" data-bucket-state="${escapeHtml(item.state)}">
          <span>${escapeHtml(item.state)}</span>
          <strong>${escapeHtml(formatMapValue(mapValue(item)))}</strong>
        </button>
      `)
      .join("")
    : `<p class="compare-empty">No states fall in this selected category for the current map data.</p>`;

  mapBucketList.innerHTML = `
    <section class="map-bucket-card">
      <div class="map-bucket-head">
        <span class="eyebrow">Selected bucket</span>
        <strong>${escapeHtml(title)}</strong>
        <small>${fmt.format(matchingStates.length)} state${matchingStates.length === 1 ? "" : "s"}</small>
      </div>
      <div class="map-bucket-states">
        ${statesMarkup}
      </div>
    </section>
  `;
}

async function loadMap() {
  coverageText.textContent = "Loading saved VAHAN coverage.";
  const rangeError = validateMonthRange();
  if (rangeError) {
    setMapStatus(rangeError, "error");
    if (mapFetchProgress) mapFetchProgress.hidden = true;
    return;
  }
  const params = currentParams();
  const response = await fetch(`/api/map/summary?${params}`);
  if (!response.ok) throw new Error(`Map summary failed: ${response.status}`);
  const data = await response.json();
  renderMapData(data);
  if (selectedState) {
    await selectState(selectedState);
  }
}

function renderMapData(data) {
  latestMapFilters = data.filters ?? null;
  stateData = new Map(data.states.map((item) => [item.state, item]));
  renderMapHeading(data.filters);
  applyMapData(data.states);
  renderParsedFilters(data.filters);
  renderFetchProgress(data.liveRefresh);
  if (data.liveRefresh?.status === "pending") {
    const savedCount = data.liveRefresh.savedStateCount;
    const fetchCount = data.liveRefresh.fetchStateCount ?? data.liveRefresh.progress?.totalStates;
    const completedCount = data.liveRefresh.progress?.completedStates ?? data.coverage.availableStates;
    coverageText.textContent =
      `${fmt.format(data.coverage.availableStates)} of ${fmt.format(data.coverage.totalStates)} states shown. ${fmt.format(completedCount)} of ${fmt.format(fetchCount ?? data.coverage.totalStates)} background fetches completed. Latest loaded month: ${data.coverage.latestMonth ?? "not available"}.`;
    setMapStatus(savedCount !== null && savedCount !== undefined && fetchCount !== null && fetchCount !== undefined
      ? `Showing saved map while VAHAN fetches in the background. Updating ${fmt.format(fetchCount)} state${fetchCount === 1 ? "" : "s"} as each fetch completes; ${fmt.format(savedCount)} saved state${savedCount === 1 ? "" : "s"} ${savedCount === 1 ? "is" : "are"} visible now.`
      : `Showing saved map while VAHAN fetches ${data.liveRefresh.requiredMonths.join(", ")} in the background.`, "pending");
  } else if (data.liveRefresh?.status === "complete") {
    coverageText.textContent =
      `${fmt.format(data.coverage.availableStates)} of ${fmt.format(data.coverage.totalStates)} states have saved rows. Latest loaded month: ${data.coverage.latestMonth ?? "not available"}.`;
    const rows = data.liveRefresh.scraper?.runs?.reduce((sum, run) => sum + (run.rowsScraped ?? 0), 0) ?? 0;
    setMapStatus(data.liveRefresh.source === "saved"
      ? "Saved data already covers this map. No scraper fetch was needed."
      : `Fetch complete. Added ${fmt.format(rows)} scraped rows to the heat map.`, "success");
  } else if (data.liveRefresh?.status === "failed") {
    coverageText.textContent =
      `${fmt.format(data.coverage.availableStates)} of ${fmt.format(data.coverage.totalStates)} states have saved rows. Latest loaded month: ${data.coverage.latestMonth ?? "not available"}.`;
    setMapStatus(data.liveRefresh.error
      ? `Fetch failed: ${data.liveRefresh.error}`
      : "Fetch finished with errors. Saved rows are still shown.", "error");
  } else if (data.coverage.rowCount === 0) {
    coverageText.textContent =
      `${fmt.format(data.coverage.availableStates)} of ${fmt.format(data.coverage.totalStates)} states have saved rows. Latest loaded month: ${data.coverage.latestMonth ?? "not available"}.`;
    setMapStatus("No saved rows match this map range. Use Fetch all states to load VAHAN data for the selected months.", "warning");
  } else {
    coverageText.textContent =
      `${fmt.format(data.coverage.availableStates)} of ${fmt.format(data.coverage.totalStates)} states have saved rows. Latest loaded month: ${data.coverage.latestMonth ?? "not available"}.`;
    setMapStatus("Saved rows render instantly. Fetch all states starts a live VAHAN job for the selected range.");
  }
}

function renderMapHeading(filters = {}) {
  const nextMetric = mapMetric(filters);
  if (nextMetric !== currentLegendMetric || mapColorMode !== currentLegendMode) {
    currentLegendMetric = nextMetric;
    currentLegendMode = mapColorMode;
    selectedLegendLevels = new Set();
  }
  if (mapPanelTitle) {
    const baseTitle = nextMetric === "registrations"
      ? "Matching registrations by state"
      : "EV share by state";
    mapPanelTitle.textContent = mapColorMode === "compare"
      ? `${baseTitle} vs India average`
      : baseTitle;
  }
  if (!mapLegend) return;
  const items = legendItems(filters);
  const baseline = comparisonBaseline(filters);
  const note = mapColorMode === "compare"
    ? `Compared with India average: ${formatMapValue(baseline, filters)}`
    : nextMetric === "registrations"
      ? "Color shows states with matching registration rows"
      : "Color shows EV share bucket";
  mapLegend.innerHTML = `
    <div class="map-legend-head">
      <strong>Color index</strong>
      <small>${escapeHtml(note)}</small>
    </div>
    <div class="map-legend-items">
      ${items
    .map(([level, label]) => `
        <button type="button" class="${level}${selectedLegendLevels.has(level) ? " active" : ""}" data-level="${level}" aria-pressed="${selectedLegendLevels.has(level)}">
          ${escapeHtml(label)}
        </button>
      `)
    .join("")}
    </div>
  `;
}

function toggleLegendLevel(level) {
  if (!level) return;
  if (selectedLegendLevels.has(level)) {
    selectedLegendLevels.delete(level);
  } else {
    selectedLegendLevels.add(level);
  }
  renderMapHeading(latestMapFilters ?? {});
  applyMapData([...stateData.values()]);
}

mapLegend?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-level]");
  if (!button) return;
  toggleLegendLevel(button.dataset.level);
});

mapBucketList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-bucket-state]");
  if (!button) return;
  selectState(button.dataset.bucketState);
});

function setMapColorMode(mode) {
  mapColorMode = mode === "compare" ? "compare" : "heat";
  for (const button of mapColorToggle?.querySelectorAll("[data-map-color-mode]") ?? []) {
    const active = button.dataset.mapColorMode === mapColorMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  renderMapHeading(latestMapFilters ?? {});
  applyMapData([...stateData.values()]);
  if (selectedState) {
    if (latestStateDetailData?.state?.state === selectedState) {
      renderStateDetail(latestStateDetailData);
    }
  }
}

mapColorToggle?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-map-color-mode]");
  if (!button) return;
  setMapColorMode(button.dataset.mapColorMode);
});

function renderParsedFilters(filters = {}) {
  if (!mapParsedFilters) return;
  const entries = [
    ["Metric", metricLabel(filters)],
    ["Fuel", filters.fuelType ?? filters.fuelSegment ?? "All fuels"],
    ["Fuel checkbox", filters.fuelFilters?.length ? filters.fuelFilters.join(", ") : "All"],
    ["Vehicle category", filters.vehicleCategories?.length ? filters.vehicleCategories.join(", ") : "All"],
    ["Vehicle class", filters.vehicleClasses?.length ? filters.vehicleClasses.join(", ") : "All"],
    ["Norms", filters.norms?.length ? filters.norms.join(", ") : "All"],
    ["Range", [filters.from, filters.to].filter(Boolean).join(" to ") || "Not set"],
  ];
  mapParsedFilters.innerHTML = `
    <div class="map-interpret-head">
      <span>Interpreted query</span>
    </div>
    <div class="map-interpret-grid">
    ${entries
    .map(([label, value]) => `
      <span class="map-filter-chip">
        <small>${escapeHtml(label)}</small>
        <strong>${escapeHtml(value)}</strong>
      </span>
    `)
    .join("")}
    </div>
  `;
}

function renderFetchProgress(liveRefresh) {
  if (!mapFetchProgress || !liveRefresh || !["pending", "complete", "failed"].includes(liveRefresh.status)) {
    if (mapFetchProgress && !activeMapJobId) mapFetchProgress.hidden = true;
    return;
  }

  const progress = liveRefresh.progress ?? {
    totalStates: CLIENT_FETCH_STATES.length,
    completedStates: 0,
    failedStates: liveRefresh.status === "failed" ? CLIENT_FETCH_STATES.length : 0,
    currentState: null,
    requiredMonths: liveRefresh.requiredMonths ?? [],
    states: CLIENT_FETCH_STATES.map((state) => ({
      state,
      status: liveRefresh.status === "failed" ? "failed" : "pending",
      rowsScraped: 0,
      error: liveRefresh.error ?? null,
    })),
  };
  const states = progress.states ?? [];
  const finished = (progress.completedStates ?? 0) + (progress.failedStates ?? 0);
  const total = progress.totalStates || states.length || 0;
  const pct = total ? Math.round((finished / total) * 100) : 0;
  const remaining = states.filter((item) => item.status === "pending");
  const running = states.find((item) => item.status === "running")?.state ?? progress.currentState;
  const failed = states.filter((item) => item.status === "failed");

  mapFetchProgress.hidden = false;
  mapProgressLabel.textContent =
    liveRefresh.status === "pending"
      ? liveRefresh.savedStateCount !== null && liveRefresh.savedStateCount !== undefined
        ? `Using ${fmt.format(liveRefresh.savedStateCount)} saved, fetching ${fmt.format(total)} missing`
        : `Fetching ${progress.requiredMonths?.join(", ") || "selected months"}`
      : liveRefresh.status === "complete"
        ? liveRefresh.source === "saved" ? "Using saved data" : "Fetch complete"
        : "Fetch finished with errors";
  mapProgressCount.textContent = `${fmt.format(finished)} / ${fmt.format(total)}`;
  mapProgressFill.style.width = `${pct}%`;
  mapCurrentState.textContent = running || (liveRefresh.status === "pending" ? "Starting browser" : "No active state");
  mapRemainingStates.textContent = remaining.length
    ? remaining.slice(0, 8).map((item) => item.state).join(", ") + (remaining.length > 8 ? `, +${remaining.length - 8} more` : "")
    : "None";

  mapProgressList.innerHTML = states
    .map((item) => `
      <span class="map-progress-chip ${escapeHtml(item.status)}" title="${escapeHtml(item.error ?? "")}">
        ${escapeHtml(item.state)}
      </span>
    `)
    .join("");

  if (failed.length && liveRefresh.status !== "pending") {
    mapRemainingStates.textContent = failed.slice(0, 5).map((item) => item.state).join(", ") + (failed.length > 5 ? `, +${failed.length - 5} failed` : "");
  }
}

function showStartingProgress() {
  const loadedStates = [...stateData.values()].filter((item) => item.rowCount > 0).length;
  const missingStates = Math.max(CLIENT_FETCH_STATES.length - loadedStates, 0);
  const fallbackStates = CLIENT_FETCH_STATES.filter((state) => !stateData.get(state)?.rowCount);
  renderFetchProgress({
    status: "pending",
    savedStateCount: loadedStates,
    fetchStateCount: missingStates,
    progress: {
      totalStates: missingStates,
      completedStates: 0,
      failedStates: 0,
      currentState: null,
      requiredMonths: currentParams().get("from") && currentParams().get("to")
        ? [`${currentParams().get("from")} to ${currentParams().get("to")}`]
        : [],
      states: fallbackStates.map((state) => ({
        state,
        status: "pending",
        rowsScraped: 0,
        error: null,
      })),
    },
    requiredMonths: currentParams().get("from") && currentParams().get("to")
      ? [`${currentParams().get("from")} to ${currentParams().get("to")}`]
      : [],
  });
}

async function startAllStatesFetch() {
  activeMapJobId = null;
  const rangeError = validateMonthRange();
  if (rangeError) {
    setMapStatus(rangeError, "error");
    if (mapFetchProgress) mapFetchProgress.hidden = true;
    return;
  }
  setFetchButtonBusy(true);
  showStartingProgress();
  setMapStatus("Showing saved map while the all-state VAHAN fetch runs in the background.", "pending");
  try {
    const response = await fetch("/api/map/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(currentBody()),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `Map fetch failed: ${response.status}`);
    renderMapData(data);
    if (data.liveRefresh?.jobId) {
      activeMapJobId = data.liveRefresh.jobId;
      pollMapRefresh(activeMapJobId);
    }
  } catch (error) {
    setMapStatus(error.message, "error");
  } finally {
    if (!activeMapJobId) {
      setFetchButtonBusy(false);
    }
  }
}

async function pollMapRefresh(jobId) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (activeMapJobId !== jobId) return;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    if (activeMapJobId !== jobId) return;
    const response = await fetch(`/api/map-refresh/${encodeURIComponent(jobId)}`);
    if (!response.ok) {
      setMapStatus(`Map fetch status failed: ${response.status}`, "error");
      if (activeMapJobId === jobId) {
        activeMapJobId = null;
        setFetchButtonBusy(false);
      }
      return;
    }
    const data = await response.json();
    renderMapData(data);
    if (data.liveRefresh?.status !== "pending") {
      activeMapJobId = null;
      setFetchButtonBusy(false);
      if (selectedState) await selectState(selectedState);
      return;
    }
  }
  if (activeMapJobId === jobId) {
    setMapStatus("Fetch is still running. Refresh the map page later to see saved rows.", "warning");
    activeMapJobId = null;
    setFetchButtonBusy(false);
  }
}

mapFilters.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadMap();
});

fetchAllStatesBtn.addEventListener("click", startAllStatesFetch);
resetMapBtn.addEventListener("click", resetZoom);
mapZoomOutBtn?.addEventListener("click", resetZoom);

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

renderMapSkeleton();
loadMap().catch((error) => {
  coverageText.textContent = error.message;
});
