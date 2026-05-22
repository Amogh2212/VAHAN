const mapSvg = document.querySelector("#indiaMap");
const mapTooltip = document.querySelector("#mapTooltip");
const coverageText = document.querySelector("#coverageText");
const mapFilters = document.querySelector("#mapFilters");
const mapQueryInput = document.querySelector("#mapQueryInput");
const fetchAllStatesBtn = document.querySelector("#fetchAllStatesBtn");
const mapFetchStatus = document.querySelector("#mapFetchStatus");
const mapFetchProgress = document.querySelector("#mapFetchProgress");
const mapProgressLabel = document.querySelector("#mapProgressLabel");
const mapProgressCount = document.querySelector("#mapProgressCount");
const mapProgressFill = document.querySelector("#mapProgressFill");
const mapCurrentState = document.querySelector("#mapCurrentState");
const mapRemainingStates = document.querySelector("#mapRemainingStates");
const mapProgressList = document.querySelector("#mapProgressList");
const resetMapBtn = document.querySelector("#resetMapBtn");
const selectedStateTitle = document.querySelector("#selectedStateTitle");
const stateSummary = document.querySelector("#stateSummary");
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

function levelFor(item) {
  if (!item || item.rowCount === 0 || item.evShare === null) return "is-empty";
  if (item.evShare >= 0.3) return "level-4";
  if (item.evShare >= 0.15) return "level-3";
  if (item.evShare >= 0.05) return "level-2";
  return "level-1";
}

function currentParams() {
  const params = new URLSearchParams();
  const from = document.querySelector("#mapFrom")?.value.trim();
  const to = document.querySelector("#mapTo")?.value.trim();
  const fuelType = document.querySelector("#mapFuelType")?.value;
  const vehicleClass = document.querySelector("#mapVehicleClass")?.value;
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (fuelType) params.set("fuelType", fuelType);
  if (vehicleClass) params.set("vehicleClasses", vehicleClass);
  return params;
}

function currentBody() {
  const vehicleClass = document.querySelector("#mapVehicleClass")?.value;
  return {
    query: mapQueryInput?.value.trim() ?? "",
    from: document.querySelector("#mapFrom")?.value.trim() || null,
    to: document.querySelector("#mapTo")?.value.trim() || null,
    vehicleClasses: vehicleClass ? [vehicleClass] : [],
    vehicleCategories: [],
    norms: [],
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
  const vehicleClass = document.querySelector("#mapVehicleClass")?.value;
  const fuelType = document.querySelector("#mapFuelType")?.value;
  const parts = [];
  if (fuelType) parts.push(fuelType.toLowerCase());
  if (vehicleClass) parts.push(vehicleClass.toLowerCase());
  parts.push("registrations in");
  parts.push(rto ? `${rto}, ${state}` : state);
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
    path.addEventListener("click", () => selectState(group.dataset.state));
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
    path.className.baseVal = `map-state ${levelFor(item)}${selectedState === group.dataset.state ? " selected" : ""}`;
    path.setAttribute(
      "aria-label",
      `${group.dataset.state}: ${item?.rowCount ? `${percent(item.evShare)} EV share` : "no saved data"}`,
    );
  }
}

function showTooltip(event, state) {
  const item = stateData.get(state);
  mapTooltip.innerHTML = `
    <strong>${escapeHtml(state)}</strong>
    <span>EV share: ${percent(item?.evShare)}</span>
    <span>EV: ${fmt.format(item?.evTotal ?? 0)}</span>
    <span>Total: ${fmt.format(item?.total ?? 0)}</span>
    <span>RTOs: ${fmt.format(item?.rtoCount ?? 0)}</span>
  `;
  mapTooltip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  const stageBox = document.querySelector("#mapStage").getBoundingClientRect();
  mapTooltip.style.left = `${event.clientX - stageBox.left + 14}px`;
  mapTooltip.style.top = `${event.clientY - stageBox.top + 14}px`;
}

function hideTooltip() {
  mapTooltip.hidden = true;
}

function zoomToState(state) {
  const path = mapSvg.querySelector(`[data-state="${CSS.escape(state)}"] path`);
  if (!path) return;
  const box = path.getBBox();
  const pad = 42;
  mapSvg.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`);
}

function resetZoom() {
  selectedState = null;
  mapSvg.setAttribute("viewBox", "0 0 620 760");
  applyMapData([...stateData.values()]);
  selectedStateTitle.textContent = "Select a state";
  stateSummary.innerHTML = `<p class="compare-empty">Click a loaded state to inspect EV share and available RTO rows.</p>`;
  rtoList.innerHTML = "";
}

async function selectState(state) {
  selectedState = state;
  zoomToState(state);
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
  const item = data.state;
  selectedStateTitle.textContent = item.state;
  const query = dashboardQuery(item.state);
  stateSummary.innerHTML = `
    <div class="map-metric-grid">
      <div class="metric"><span>EV share</span><strong>${percent(item.evShare)}</strong></div>
      <div class="metric"><span>EV registrations</span><strong>${fmt.format(item.evTotal)}</strong></div>
      <div class="metric"><span>Total</span><strong>${fmt.format(item.total)}</strong></div>
      <div class="metric"><span>Saved RTOs</span><strong>${fmt.format(item.rtoCount)}</strong></div>
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
            <span>${percent(rto.evShare)} EV</span>
            <span>${fmt.format(rto.evTotal)} / ${fmt.format(rto.total)}</span>
          </div>
          <div class="rto-fuels">${rto.topFuels.map((fuel) => `<span>${escapeHtml(fuel.fuelType)} ${fmt.format(fuel.count)}</span>`).join("")}</div>
          <a class="back-link" href="/?query=${encodeURIComponent(rtoQuery)}">Run query</a>
        </article>
      `;
    })
    .join("");
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
  applyMapData(data.states);
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
