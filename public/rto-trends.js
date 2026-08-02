const appFrame = document.querySelector(".app-frame");
const sidebarTrigger = document.querySelector("#sidebarTrigger");
const featureSidebar = document.querySelector("#featureSidebar");
const notice = document.querySelector("#rtoTrendNotice");
const form = document.querySelector("#rtoTrendForm");
const lookupInput = document.querySelector("#rtoLookupInput");
const suggestions = document.querySelector("#rtoLookupSuggestions");
const fuelSelect = document.querySelector("#rtoFuelGroup");
const categorySelect = document.querySelector("#rtoCategory");
const oemSelect = document.querySelector("#rtoOem");
const freshnessLabel = document.querySelector("#rtoTrendFreshness");
const pinButton = document.querySelector("#rtoPinBtn");
const requestButton = document.querySelector("#rtoRequestBtn");
const pinCount = document.querySelector("#rtoPinCount");
const pinnedCount = document.querySelector("#rtoPinnedCount");
const pinnedList = document.querySelector("#rtoPinnedList");
const accountStatus = document.querySelector("#rtoAccountStatus");
const loginButton = document.querySelector("#rtoLoginBtn");
const logoutButton = document.querySelector("#rtoLogoutBtn");
const title = document.querySelector("#rtoTrendTitle");
const meta = document.querySelector("#rtoTrendMeta");
const statusPill = document.querySelector("#rtoTrendStatus");
const summary = document.querySelector("#rtoTrendSummary");
const rowsBody = document.querySelector("#rtoTrendRows");
const tableWrap = document.querySelector("#rtoTrendTableWrap");
const coverageMeta = document.querySelector("#rtoCoverageMeta");
const coverageStatus = document.querySelector("#rtoCoverageStatus");
const coverageSummary = document.querySelector("#rtoCoverageSummary");
const coveragePanel = coverageSummary?.closest(".panel");
const trendSubmitButton = form?.querySelector('button[type="submit"]');

const fmt = new Intl.NumberFormat("en-IN");
const CATEGORY_OEMS = {
  "2W": ["Hero MotoCorp", "Honda Motorcycle", "TVS Motor (2W)", "Bajaj Auto (2W)", "Suzuki Motorcycle"],
  "3W": ["Bajaj Auto (3W)", "Mahindra Last Mile Mobility", "TVS Motor (3W)", "Piaggio Vehicles", "Atul Auto"],
  "4W": ["Maruti Suzuki", "Tata Motors", "Mahindra & Mahindra", "Hyundai Motor India", "JSW MG Motor India"],
};
const POLL_MS = 10_000;
const NOTICE_AUTO_HIDE_MS = 30_000;

let currentUser = null;
let currentSelection = null;
let currentStatus = null;
let currentPins = [];
let searchMatches = [];
let activeSuggestion = -1;
let searchTimer = null;
let searchGeneration = 0;
let statusTimer = null;
let noticeTimer = null;
let pinLimit = 10;
let csrfToken = null;

function setSidebarOpen(open) {
  appFrame?.classList.toggle("sidebar-open", open);
  sidebarTrigger?.setAttribute("aria-expanded", open ? "true" : "false");
}

sidebarTrigger?.addEventListener("click", () => setSidebarOpen(!appFrame?.classList.contains("sidebar-open")));
document.addEventListener("click", (event) => {
  if (!appFrame?.classList.contains("sidebar-open")) return;
  if (featureSidebar?.contains(event.target) || sidebarTrigger?.contains(event.target)) return;
  setSidebarOpen(false);
});

function hideNotice({ immediate = false } = {}) {
  clearTimeout(noticeTimer);
  noticeTimer = null;
  notice.classList.remove("is-visible");
  if (immediate) {
    notice.hidden = true;
    notice.textContent = "";
    return;
  }
  setTimeout(() => {
    if (!notice.classList.contains("is-visible")) {
      notice.hidden = true;
      notice.textContent = "";
    }
  }, 180);
}

function showNotice(message, type = "info") {
  if (!message) {
    hideNotice({ immediate: true });
    return;
  }
  clearTimeout(noticeTimer);
  notice.hidden = false;
  notice.dataset.type = type;
  notice.textContent = message;
  notice.classList.remove("is-visible");
  requestAnimationFrame(() => notice.classList.add("is-visible"));
  noticeTimer = setTimeout(() => hideNotice(), NOTICE_AUTO_HIDE_MS);
}

async function apiJson(url, options = {}) {
  const method = String(options.method ?? "GET").toUpperCase();
  const csrfHeaders = !["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken
    ? { "x-csrf-token": csrfToken }
    : {};
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...csrfHeaders, ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "Request failed.");
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function option(value, label = value) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function oemsForCategory(category = categorySelect.value) {
  return CATEGORY_OEMS[category] ?? CATEGORY_OEMS["2W"];
}

function renderOemOptions({ preserveSelection = true } = {}) {
  const previous = preserveSelection ? oemSelect.value : "";
  const oems = oemsForCategory();
  oemSelect.innerHTML = oems.map((item) => option(item)).join("");
  oemSelect.value = oems.includes(previous) ? previous : oems[0];
}

function metricCard(label, value, secondary = "") {
  return `<div class="tracked-metric"><span>${escapeHtml(label)}</span><strong>${value}</strong>${secondary ? `<small>${escapeHtml(secondary)}</small>` : ""}</div>`;
}

function movementText(value) {
  if (value === null || value === undefined) return `<span class="tracked-delta muted">--</span>`;
  const sign = value > 0 ? "+" : "";
  const tone = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return `<span class="tracked-delta ${tone}">${sign}${fmt.format(value)}</span>`;
}

function renderSparkline(rows) {
  if (rows.length < 2) return `<div class="tracked-sparkline tracked-sparkline-empty"><p class="result-empty">A trend line appears after two verified snapshots.</p></div>`;
  const width = 560;
  const height = 110;
  const padding = 14;
  const values = rows.map((row) => Number(row.vehicleCount));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const xFor = (index) => padding + (index / Math.max(1, rows.length - 1)) * (width - padding * 2);
  const yFor = (value) => padding + (height - padding * 2) - ((value - min) / span) * (height - padding * 2);
  const points = rows.map((row, index) => `${xFor(index).toFixed(1)},${yFor(Number(row.vehicleCount)).toFixed(1)}`).join(" ");
  return `<div class="tracked-sparkline"><div class="tracked-sparkline-head"><span>30-day snapshot trend</span><strong>${fmt.format(values[0])} to ${fmt.format(values.at(-1))}</strong></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="RTO daily snapshot trend"><polyline points="${points}" /><circle cx="${xFor(0)}" cy="${yFor(values[0])}" r="4" /><circle cx="${xFor(rows.length - 1)}" cy="${yFor(values.at(-1))}" r="4" /></svg></div>`;
}

function setAuthState(user) {
  currentUser = user;
  if (!user) csrfToken = null;
  accountStatus.textContent = user ? user.email : "Signed out";
  loginButton.hidden = Boolean(user);
  logoutButton.hidden = !user;
  if (!user) {
    currentPins = [];
    pinCount.textContent = `0 / ${pinLimit} pinned`;
    pinnedCount.textContent = "Sign in";
    pinnedList.innerHTML = `<p class="result-empty">Sign in to keep personal daily RTO pins across devices.</p>`;
  }
  renderSelectionActions();
}

async function loadCurrentUser() {
  const body = await apiJson("/api/me");
  csrfToken = body.csrfToken ?? null;
  setAuthState(body.user);
  if (body.user) await loadPins();
  return body.user;
}

function closeSuggestions() {
  suggestions.hidden = true;
  lookupInput.setAttribute("aria-expanded", "false");
  lookupInput.removeAttribute("aria-activedescendant");
  activeSuggestion = -1;
}

function renderSuggestions(matches) {
  searchMatches = matches;
  activeSuggestion = -1;
  suggestions.innerHTML = matches.length
    ? matches.map((item, index) => `<button type="button" id="rto-option-${index}" class="rto-suggestion" role="option" data-index="${index}" aria-selected="false"><strong>${escapeHtml(item.rto)}</strong><small>${escapeHtml(item.state)}</small></button>`).join("")
    : `<p class="result-empty">No official RTO matched this text.</p>`;
  suggestions.hidden = false;
  lookupInput.setAttribute("aria-expanded", "true");
  for (const button of suggestions.querySelectorAll(".rto-suggestion")) {
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", () => selectMatch(searchMatches[Number(button.dataset.index)]));
  }
}

function moveSuggestion(delta) {
  if (!searchMatches.length) return;
  activeSuggestion = (activeSuggestion + delta + searchMatches.length) % searchMatches.length;
  for (const [index, button] of [...suggestions.querySelectorAll(".rto-suggestion")].entries()) {
    const active = index === activeSuggestion;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    if (active) button.scrollIntoView({ block: "nearest" });
  }
  lookupInput.setAttribute("aria-activedescendant", `rto-option-${activeSuggestion}`);
}

async function searchRtos(query = lookupInput.value, generation = ++searchGeneration) {
  const body = await apiJson(`/api/rto-daily/search?${new URLSearchParams({ q: query, limit: "20" })}`);
  if (generation !== searchGeneration) return;
  renderSuggestions(body.matches ?? []);
}

function selectMatch(match) {
  if (!match) return;
  currentSelection = { state: match.state, rto: match.rto };
  lookupInput.value = match.rto;
  closeSuggestions();
  showNotice("");
  loadSelection().catch((error) => showNotice(error.message, "error"));
}

async function resolveTypedSelection() {
  const query = lookupInput.value.trim();
  if (!query) throw new Error("Enter an RTO name, city, alias, or code.");
  const body = await apiJson(`/api/rto-daily/status?${new URLSearchParams({ q: query })}`);
  currentSelection = { state: body.state, rto: body.rto };
  lookupInput.value = body.rto;
  currentStatus = body.status;
  return body;
}

function renderSelectionActions() {
  const selected = Boolean(currentSelection);
  pinButton.hidden = !selected;
  requestButton.hidden = !selected || Boolean(currentStatus?.lastSnapshotDate) || currentUser?.role !== "admin";
  if (!selected) return;
  pinButton.textContent = currentUser
    ? currentStatus?.pinned ? "Unpin RTO" : "Pin RTO"
    : "Sign in to pin";
  const pending = ["queued", "running", "retrying"].includes(currentStatus?.job?.status);
  requestButton.disabled = pending;
  requestButton.textContent = !currentUser
    ? "Sign in to queue"
    : pending ? `Snapshot ${currentStatus.job.status}` : "Queue first snapshot";
}

function renderTrend(rows, filters) {
  title.textContent = `${filters.rto} daily trend`;
  meta.textContent = `${filters.state} · ${filters.fuelGroup} / ${filters.category} / ${filters.oem}`;
  const latest = rows.at(-1) ?? null;
  const movement = latest?.dailyDelta ?? null;
  const failed = currentStatus?.job?.status === "failed";
  statusPill.textContent = latest ? "Loaded" : failed ? "Failed" : currentStatus?.job?.status ?? "No data";
  statusPill.className = `status-pill ${latest ? "tracked-status-active" : "tracked-status-paused"}`;
  tableWrap.hidden = !rows.length;
  summary.classList.toggle("empty-observation-state", !rows.length);
  if (rows.length) {
    summary.innerHTML = `${metricCard("Latest snapshot", fmt.format(latest.vehicleCount), latest.snapshotDate)}${metricCard("Daily movement", movementText(movement))}${metricCard("Snapshots", fmt.format(rows.length), "Verified raw retention window")}${renderSparkline(rows)}`;
  } else if (failed) {
    summary.innerHTML = `<p class="result-empty">The latest collection failed: ${escapeHtml(currentStatus.job.lastError || "unknown scraper error")}. No value is shown until a verified snapshot succeeds.</p>`;
  } else if (["queued", "running", "retrying"].includes(currentStatus?.job?.status)) {
    summary.innerHTML = `<p class="result-empty">The first snapshot is ${escapeHtml(currentStatus.job.status)}. This page will refresh when verified data arrives.</p>`;
  } else {
    summary.innerHTML = `<p class="result-empty">No verified daily snapshot exists for this RTO yet. Queue the first snapshot or pin the RTO for daily priority.</p>`;
  }
  rowsBody.innerHTML = rows.map((row) => `<tr><td>${escapeHtml(row.snapshotDate)}</td><td>${escapeHtml(row.targetMonth)}</td><td>${fmt.format(row.vehicleCount)}</td><td>${movementText(row.dailyDelta)}${row.correction ? " <small>correction</small>" : ""}</td><td>${escapeHtml(row.qualityStatus ?? row.scrapeStatus)}</td></tr>`).join("");
}

async function loadTrend() {
  if (!currentSelection) return;
  const filters = {
    ...currentSelection,
    fuelGroup: fuelSelect.value,
    category: categorySelect.value,
    oem: oemSelect.value,
  };
  const body = await apiJson(`/api/rto-daily/trend?${new URLSearchParams({ ...filters, limit: "30" })}`);
  renderTrend(body.rows ?? [], filters);
}

function scheduleStatusPoll() {
  clearTimeout(statusTimer);
  if (!["queued", "running", "retrying"].includes(currentStatus?.job?.status) || !currentSelection) return;
  statusTimer = setTimeout(async () => {
    try {
      await loadSelection();
      if (currentStatus?.job?.status === "success") await loadPins();
    } catch (error) {
      showNotice(error.message, "error");
    }
  }, POLL_MS);
}

async function loadSelection() {
  if (!currentSelection) return;
  const body = await apiJson(`/api/rto-daily/status?${new URLSearchParams(currentSelection)}`);
  currentSelection = { state: body.state, rto: body.rto };
  currentStatus = body.status;
  lookupInput.value = body.rto;
  freshnessLabel.textContent = currentStatus.lastSnapshotDate
    ? `${body.state} · latest ${currentStatus.lastSnapshotDate}`
    : `${body.state} · no verified snapshot yet`;
  renderSelectionActions();
  await loadTrend();
  scheduleStatusPoll();
}

function renderPins() {
  pinCount.textContent = `${currentPins.length} / ${pinLimit} pinned`;
  pinnedCount.textContent = `${currentPins.length} RTO${currentPins.length === 1 ? "" : "s"}`;
  pinnedList.innerHTML = currentPins.length
    ? currentPins.map((pin) => {
      const state = pin.job?.status ?? pin.lastStatus ?? "waiting";
      return `<div class="tracked-item rto-pinned-item"><button type="button" class="rto-pinned-select" data-pin-id="${pin.id}"><span class="tracked-item-main"><strong>${escapeHtml(pin.rto)}</strong><small>${escapeHtml(pin.state)}</small></span><span class="tracked-item-meta"><span class="status-pill ${state === "success" ? "tracked-status-active" : "tracked-status-paused"}">${escapeHtml(state)}</span><span>${escapeHtml(pin.lastSnapshotDate ?? "No verified snapshot")}</span></span></button><button type="button" class="rto-unpin" data-unpin-id="${pin.id}" aria-label="Unpin ${escapeHtml(pin.rto)}">×</button></div>`;
    }).join("")
    : `<p class="result-empty">No RTOs pinned yet. Search for one and choose “Pin RTO.”</p>`;
  for (const button of pinnedList.querySelectorAll(".rto-pinned-select")) {
    button.addEventListener("click", () => {
      const pin = currentPins.find((item) => item.id === Number(button.dataset.pinId));
      selectMatch(pin);
    });
  }
  for (const button of pinnedList.querySelectorAll(".rto-unpin")) {
    button.addEventListener("click", () => unpin(Number(button.dataset.unpinId)));
  }
}

async function loadPins() {
  if (!currentUser) return;
  const body = await apiJson("/api/rto-daily/pins");
  currentPins = body.pins ?? [];
  pinLimit = body.limit ?? 10;
  renderPins();
  if (currentSelection) {
    const pin = currentPins.find((item) => item.state === currentSelection.state && item.rto === currentSelection.rto);
    currentStatus = { ...(currentStatus ?? {}), pinned: Boolean(pin), pinId: pin?.id ?? null };
    renderSelectionActions();
  }
}

async function pinOrUnpin() {
  if (!currentUser) {
    window.location.assign("/auth/google?returnTo=/rto-trends.html");
    return;
  }
  if (!currentSelection) return;
  pinButton.disabled = true;
  try {
    if (currentStatus?.pinned && currentStatus.pinId) {
      await apiJson(`/api/rto-daily/pins/${currentStatus.pinId}`, { method: "DELETE" });
      showNotice(`${currentSelection.rto} was removed from your daily pins.`);
    } else {
      await apiJson("/api/rto-daily/pins", { method: "POST", body: JSON.stringify(currentSelection) });
      showNotice(`${currentSelection.rto} is pinned and has daily priority.`);
    }
    await Promise.all([loadPins(), loadSelection()]);
  } finally {
    pinButton.disabled = false;
  }
}

async function unpin(id) {
  await apiJson(`/api/rto-daily/pins/${id}`, { method: "DELETE" });
  showNotice("RTO removed from your daily pins.");
  await loadPins();
  if (currentStatus?.pinId === id) await loadSelection();
}

async function requestFirstSnapshot() {
  if (!currentUser) {
    window.location.assign("/auth/google?returnTo=/rto-trends.html");
    return;
  }
  if (!currentSelection) return;
  requestButton.disabled = true;
  try {
    await apiJson("/api/rto-daily/requests", { method: "POST", body: JSON.stringify(currentSelection) });
    showNotice("First snapshot queued. The deployment worker normally starts it within 15 minutes.");
    await loadSelection();
  } finally {
    requestButton.disabled = false;
  }
}

function renderCoverage(body) {
  document.body.classList.remove("rto-trends-source-error");
  coveragePanel?.classList.remove("is-unavailable");
  for (const control of [lookupInput, fuelSelect, categorySelect, oemSelect, trendSubmitButton]) {
    if (control) control.disabled = false;
  }
  const run = body.run;
  const cycle = body.summary ?? {};
  if (!run) {
    coverageMeta.textContent = "No collection cycle yet";
    coverageStatus.textContent = "Idle";
    coverageStatus.className = "status-pill tracked-status-paused";
    coverageSummary.innerHTML = `<p class="result-empty">Refresh the official RTO catalog, then start the bounded collector.</p>`;
    return;
  }
  const timing = run.completedAt
    ? `completed ${new Date(run.completedAt).toLocaleString("en-IN")}`
    : cycle.projectedFinishAt ? `projected ${new Date(cycle.projectedFinishAt).toLocaleString("en-IN")}` : null;
  coverageMeta.textContent = `${run.snapshotDate} · ${run.workerCount} workers${timing ? ` · ${timing}` : ""}`;
  const hasLateFill = (cycle.lateFillRtos ?? 0) > 0;
  coverageStatus.textContent = hasLateFill && run.status === "success" ? "success + late fill" : run.status;
  coverageStatus.className = `status-pill ${run.status === "success" && !hasLateFill ? "tracked-status-active" : "tracked-status-paused"}`;
  const activeRunning = cycle.activeRunning ?? cycle.running ?? 0;
  const retrying = cycle.retrying ?? 0;
  const staleRunning = cycle.staleRunning ?? Math.max(0, (cycle.running ?? 0) - activeRunning);
  const activeDetail = [
    `${fmt.format(retrying)} retrying`,
    staleRunning ? `${fmt.format(staleRunning)} stale` : null,
    `${fmt.format(cycle.failed ?? 0)} failed`,
    `${fmt.format(cycle.deferred ?? 0)} deferred`,
  ].filter(Boolean).join(" · ");
  const successRtos = cycle.successRtos ?? cycle.succeeded ?? 0;
  const lateFillRtos = cycle.lateFillRtos ?? 0;
  const pendingRtos = cycle.pendingRtos ?? Math.max(0, (cycle.total ?? 0) - (cycle.succeeded ?? 0) - (cycle.failed ?? 0) - (cycle.deferred ?? 0));
  coverageSummary.innerHTML = `${metricCard("Same-day", fmt.format(successRtos), `${fmt.format(cycle.total ?? 0)} queued for this cycle`)}${metricCard("Late fill", fmt.format(lateFillRtos), `${fmt.format(pendingRtos)} pending`)}${metricCard("Active now", fmt.format(activeRunning), activeDetail)}`;
}

async function init() {
  renderOemOptions({ preserveSelection: false });
  try {
    const [, coverage] = await Promise.all([loadCurrentUser(), apiJson("/api/rto-daily/coverage")]);
    renderCoverage(coverage);
  } catch (error) {
    console.error("RTO daily source request failed.", error);
    document.body.classList.add("rto-trends-source-error");
    coveragePanel?.classList.add("is-unavailable");
    coverageMeta.textContent = "Database-backed snapshots are offline";
    coverageStatus.textContent = "Unavailable";
    coverageStatus.className = "status-pill tracked-run-failed";
    coverageSummary.innerHTML = `
      <div class="atlas-prerequisite">
        <span class="panel-kicker">Source prerequisite</span>
        <strong>Daily RTO coverage cannot be verified right now.</strong>
        <p>Restore database access, then reload this page before using snapshot trends.</p>
      </div>
    `;
    for (const control of [lookupInput, fuelSelect, categorySelect, oemSelect, trendSubmitButton]) {
      if (control) control.disabled = true;
    }
    showNotice("Daily RTO data is temporarily unavailable. Restore database access, then reload.", "error");
  }
}

lookupInput.addEventListener("focus", () => searchRtos().catch((error) => showNotice(error.message, "error")));
lookupInput.addEventListener("blur", () => setTimeout(closeSuggestions, 120));
lookupInput.addEventListener("input", () => {
  if (currentSelection && lookupInput.value !== currentSelection.rto) {
    currentSelection = null;
    currentStatus = null;
    renderSelectionActions();
  }
  const generation = ++searchGeneration;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchRtos(lookupInput.value, generation).catch((error) => showNotice(error.message, "error")), 180);
});
lookupInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") { event.preventDefault(); moveSuggestion(1); }
  else if (event.key === "ArrowUp") { event.preventDefault(); moveSuggestion(-1); }
  else if (event.key === "Escape") closeSuggestions();
  else if (event.key === "Enter" && activeSuggestion >= 0) {
    event.preventDefault();
    selectMatch(searchMatches[activeSuggestion]);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showNotice("");
  try {
    if (!currentSelection) await resolveTypedSelection();
    await loadSelection();
  } catch (error) {
    if (error.body?.candidates?.length) renderSuggestions(error.body.candidates.map((item) => ({ state: item.state, rto: item.label })));
    showNotice(error.message, "error");
  }
});

for (const input of [fuelSelect, oemSelect]) {
  input.addEventListener("change", () => loadTrend().catch((error) => showNotice(error.message, "error")));
}
categorySelect.addEventListener("change", () => {
  renderOemOptions();
  loadTrend().catch((error) => showNotice(error.message, "error"));
});
pinButton.addEventListener("click", () => pinOrUnpin().catch((error) => showNotice(error.message, "error")));
requestButton.addEventListener("click", () => requestFirstSnapshot().catch((error) => showNotice(error.message, "error")));
logoutButton.addEventListener("click", async () => {
  await apiJson("/auth/logout", { method: "POST" });
  csrfToken = null;
  setAuthState(null);
  if (currentSelection) await loadSelection();
});

init();
