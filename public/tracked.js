const appFrame = document.querySelector(".app-frame");
const sidebarTrigger = document.querySelector("#sidebarTrigger");
const featureSidebar = document.querySelector("#featureSidebar");
const trackedForm = document.querySelector("#trackedForm");
const trackedList = document.querySelector("#trackedList");
const trackedCount = document.querySelector("#trackedCount");
const trackedNotice = document.querySelector("#trackedNotice");
const refreshTrackedBtn = document.querySelector("#refreshTrackedBtn");
const detailTitle = document.querySelector("#trackedDetailTitle");
const detailMeta = document.querySelector("#trackedDetailMeta");
const detailStatus = document.querySelector("#trackedDetailStatus");
const observationSummary = document.querySelector("#trackedObservationSummary");
const observationsBody = document.querySelector("#trackedObservations");
const observationTableWrap = document.querySelector(".tracked-table-wrap");
const formTitle = document.querySelector("#trackedFormTitle");
const createTrackedBtn = document.querySelector("#createTrackedBtn");
const cancelEditBtn = document.querySelector("#cancelEditBtn");

const fmt = new Intl.NumberFormat("en-IN");
let trackedQueries = [];
let selectedId = null;
let editingId = null;

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

function showNotice(message, type = "info") {
  if (!trackedNotice) return;
  trackedNotice.hidden = !message;
  trackedNotice.dataset.type = type;
  trackedNotice.textContent = message || "";
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
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function displayLabel(item) {
  return item.label || item.query;
}

function statusPill(item) {
  return item.active
    ? `<span class="status-pill tracked-status-active">Active</span>`
    : `<span class="status-pill tracked-status-paused">Paused</span>`;
}

function deltaText(value) {
  if (value === null || value === undefined) return `<span class="tracked-delta muted">-</span>`;
  const sign = value > 0 ? "+" : "";
  const tone = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return `<span class="tracked-delta ${tone}">${sign}${fmt.format(value)}</span>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function latestObservation(id) {
  const body = await apiJson(`/api/tracked-queries/${id}/observations?limit=1`);
  return body.observations?.[0] ?? null;
}

async function latestRun(id) {
  const body = await apiJson(`/api/tracked-queries/${id}/runs?limit=1`);
  return body.runs?.[0] ?? null;
}

function latestListLabel(latest, run) {
  if (run?.status === "failed" && (!latest || run.observationDate >= latest.observationDate)) return "Failed";
  return latest ? fmt.format(latest.total) : "No observations";
}

async function loadTrackedQueries() {
  showNotice("");
  trackedList.innerHTML = `<p class="result-empty">Loading tracked queries.</p>`;
  trackedCount.textContent = "Loading";

  const body = await apiJson("/api/tracked-queries");
  trackedQueries = body.trackedQueries ?? [];
  trackedCount.textContent = `${trackedQueries.length} saved`;

  const latestById = new Map();
  const latestRunById = new Map();
  await Promise.all(trackedQueries.map(async (item) => {
    try {
      latestById.set(item.id, await latestObservation(item.id));
    } catch {
      latestById.set(item.id, null);
    }
    try {
      latestRunById.set(item.id, await latestRun(item.id));
    } catch {
      latestRunById.set(item.id, null);
    }
  }));

  if (!trackedQueries.length) {
    trackedList.innerHTML = `<p class="result-empty">No tracked queries yet. Add one above to start collecting daily observations.</p>`;
    renderEmptyDetail();
    return;
  }

  if (!selectedId || !trackedQueries.some((item) => item.id === selectedId)) {
    selectedId = trackedQueries[0].id;
  }

  trackedList.innerHTML = trackedQueries.map((item) => {
    const latest = latestById.get(item.id);
    const run = latestRunById.get(item.id);
    return `
      <button type="button" class="tracked-item ${item.id === selectedId ? "active" : ""}" data-id="${item.id}">
        <span class="tracked-item-main">
          <strong>${escapeHtml(displayLabel(item))}</strong>
          <small>${escapeHtml(item.query)}</small>
        </span>
        <span class="tracked-item-meta">
          ${statusPill(item)}
          <span>${escapeHtml(item.runTimeLocal)} ${escapeHtml(item.timezone)}</span>
          <span>${escapeHtml(latestListLabel(latest, run))}</span>
        </span>
      </button>
    `;
  }).join("");

  for (const button of trackedList.querySelectorAll(".tracked-item")) {
    button.addEventListener("click", () => {
      selectedId = Number(button.dataset.id);
      renderTrackedListSelection();
      loadObservations(selectedId).catch((error) => showNotice(error.message, "error"));
    });
  }

  await loadObservations(selectedId);
}

function renderTrackedListSelection() {
  for (const button of trackedList.querySelectorAll(".tracked-item")) {
    button.classList.toggle("active", Number(button.dataset.id) === selectedId);
  }
}

function renderEmptyDetail() {
  detailTitle.textContent = "Observation history";
  detailMeta.textContent = "No tracked query selected";
  detailStatus.textContent = "Idle";
  observationSummary?.classList.add("empty-observation-state");
  observationSummary.innerHTML = `<p class="result-empty">Create a tracked query to review daily totals and deltas.</p>`;
  if (observationTableWrap) observationTableWrap.hidden = true;
  observationsBody.innerHTML = `<tr><td colspan="6">No query selected.</td></tr>`;
}

function formValues() {
  return {
    label: document.querySelector("#trackedLabel")?.value.trim() || null,
    query: document.querySelector("#trackedQuery")?.value.trim(),
    runTimeLocal: document.querySelector("#trackedRunTime")?.value || "08:00",
    timezone: document.querySelector("#trackedTimezone")?.value.trim() || "Asia/Calcutta",
    active: Boolean(document.querySelector("#trackedActive")?.checked),
  };
}

function resetTrackedForm() {
  editingId = null;
  trackedForm?.reset();
  document.querySelector("#trackedRunTime").value = "08:00";
  document.querySelector("#trackedTimezone").value = "Asia/Calcutta";
  document.querySelector("#trackedActive").checked = true;
  if (formTitle) formTitle.textContent = "Add tracked query";
  if (createTrackedBtn) createTrackedBtn.textContent = "Save query";
  if (cancelEditBtn) cancelEditBtn.hidden = true;
}

function editTrackedQuery(item) {
  editingId = item.id;
  document.querySelector("#trackedLabel").value = item.label || "";
  document.querySelector("#trackedQuery").value = item.query || "";
  document.querySelector("#trackedRunTime").value = item.runTimeLocal || "08:00";
  document.querySelector("#trackedTimezone").value = item.timezone || "Asia/Calcutta";
  document.querySelector("#trackedActive").checked = Boolean(item.active);
  if (formTitle) formTitle.textContent = "Edit tracked query";
  if (createTrackedBtn) createTrackedBtn.textContent = "Update query";
  if (cancelEditBtn) cancelEditBtn.hidden = false;
  trackedForm?.scrollIntoView({ behavior: "smooth", block: "center" });
  document.querySelector("#trackedLabel")?.focus();
}

async function loadObservations(id) {
  const item = trackedQueries.find((entry) => entry.id === id);
  if (!item) {
    renderEmptyDetail();
    return;
  }

  detailTitle.textContent = displayLabel(item);
  detailMeta.textContent = `${item.runTimeLocal} ${item.timezone}`;
  detailStatus.textContent = item.active ? "Active" : "Paused";
  detailStatus.className = `status-pill ${item.active ? "tracked-status-active" : "tracked-status-paused"}`;
  observationSummary.classList.remove("empty-observation-state");
  if (observationTableWrap) observationTableWrap.hidden = true;
  observationSummary.innerHTML = `<p class="result-empty">Loading observations.</p>`;
  observationsBody.innerHTML = `<tr><td colspan="6">Loading.</td></tr>`;

  const [observationBody, runBody] = await Promise.all([
    apiJson(`/api/tracked-queries/${id}/observations?limit=30`),
    apiJson(`/api/tracked-queries/${id}/runs?limit=30`),
  ]);
  const observations = observationBody.observations ?? [];
  const runs = runBody.runs ?? [];
  const latest = observations[0] ?? null;
  const latestAttempt = runs[0] ?? null;
  const latestAttemptFailed = latestAttempt?.status === "failed" && (!latest || latestAttempt.observationDate >= latest.observationDate);
  const historyRows = trackedHistoryRows(observations, runs);
  const hasHistory = historyRows.length > 0;
  observationSummary.classList.toggle("empty-observation-state", !hasHistory);
  if (observationTableWrap) observationTableWrap.hidden = !hasHistory;

  observationSummary.innerHTML = latestAttemptFailed
    ? `
      <div class="tracked-metric">
        <span>Latest run</span>
        <strong>Failed</strong>
      </div>
      <div class="tracked-metric">
        <span>Observation date</span>
        <strong>${escapeHtml(latestAttempt.observationDate)}</strong>
      </div>
      <div class="tracked-metric">
        <span>Last good total</span>
        <strong>${latest ? fmt.format(latest.total) : "-"}</strong>
      </div>
      <div class="tracked-actions">
        <button type="button" class="secondary-action edit-action" data-action="edit">Edit</button>
        <button type="button" class="secondary-action" data-action="toggle">${item.active ? "Pause" : "Resume"}</button>
        <button type="button" class="secondary-action danger-action" data-action="disable">Disable</button>
        <button type="button" class="secondary-action danger-action" data-action="delete">Delete</button>
      </div>
    `
    : latest
    ? `
      <div class="tracked-metric">
        <span>Latest total</span>
        <strong>${fmt.format(latest.total)}</strong>
      </div>
      <div class="tracked-metric">
        <span>Daily delta</span>
        <strong>${deltaText(latest.dailyDelta)}</strong>
      </div>
      <div class="tracked-metric">
        <span>Weekly delta</span>
        <strong>${deltaText(latest.weeklyDelta)}</strong>
      </div>
      <div class="tracked-actions">
        <button type="button" class="secondary-action edit-action" data-action="edit">Edit</button>
        <button type="button" class="secondary-action" data-action="toggle">${item.active ? "Pause" : "Resume"}</button>
        <button type="button" class="secondary-action danger-action" data-action="disable">Disable</button>
        <button type="button" class="secondary-action danger-action" data-action="delete">Delete</button>
      </div>
    `
    : `
      <p class="result-empty">${runs.some((run) => run.status === "failed") ? "The latest daily runner attempt failed before a trustworthy observation could be stored." : "The daily runner has not stored observations for this query yet."}</p>
      <div class="tracked-actions">
        <button type="button" class="secondary-action edit-action" data-action="edit">Edit</button>
        <button type="button" class="secondary-action" data-action="toggle">${item.active ? "Pause" : "Resume"}</button>
        <button type="button" class="secondary-action danger-action" data-action="disable">Disable</button>
        <button type="button" class="secondary-action danger-action" data-action="delete">Delete</button>
      </div>
    `;

  observationSummary.querySelector("[data-action='edit']")?.addEventListener("click", () => editTrackedQuery(item));
  observationSummary.querySelector("[data-action='toggle']")?.addEventListener("click", () => toggleTrackedQuery(item));
  observationSummary.querySelector("[data-action='disable']")?.addEventListener("click", () => disableTrackedQuery(item));
  observationSummary.querySelector("[data-action='delete']")?.addEventListener("click", () => deleteTrackedQuery(item));

  observationsBody.innerHTML = hasHistory
    ? historyRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.observationDate)}</td>
        <td>${row.total === null || row.total === undefined ? "-" : fmt.format(row.total)}</td>
        <td>${deltaText(row.dailyDelta)}</td>
        <td>${deltaText(row.weeklyDelta)}</td>
        <td>${escapeHtml(row.statusLabel)}</td>
        <td>${fmt.format(row.warningCount ?? 0)}</td>
      </tr>
    `).join("")
    : "";
}

function trackedHistoryRows(observations, runs) {
  const rowsByDate = new Map(observations.map((row) => [row.observationDate, {
    observationDate: row.observationDate,
    total: row.total,
    dailyDelta: row.dailyDelta,
    weeklyDelta: row.weeklyDelta,
    statusLabel: row.dataStatus || "-",
    warningCount: row.warnings?.length ?? 0,
    sortKey: row.updatedAt ?? row.observationDate,
  }]));

  for (const run of runs) {
    if (run.status !== "failed") continue;
    const existing = rowsByDate.get(run.observationDate);
    if (existing && existing.statusLabel !== "stale") continue;
    rowsByDate.set(run.observationDate, {
      observationDate: run.observationDate,
      total: null,
      dailyDelta: null,
      weeklyDelta: null,
      statusLabel: "failed",
      warningCount: run.error ? 1 : 0,
      sortKey: run.completedAt ?? run.startedAt ?? run.observationDate,
    });
  }

  return [...rowsByDate.values()]
    .sort((a, b) => b.observationDate.localeCompare(a.observationDate) || String(b.sortKey).localeCompare(String(a.sortKey)))
    .slice(0, 30);
}

async function toggleTrackedQuery(item) {
  await apiJson(`/api/tracked-queries/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify({ active: !item.active }),
  });
  showNotice(`${item.active ? "Paused" : "Resumed"} ${displayLabel(item)}.`, "success");
  await loadTrackedQueries();
}

async function disableTrackedQuery(item) {
  await apiJson(`/api/tracked-queries/${item.id}`, { method: "DELETE" });
  showNotice(`Disabled ${displayLabel(item)}.`, "success");
  await loadTrackedQueries();
}

async function deleteTrackedQuery(item) {
  const confirmed = window.confirm(`Delete "${displayLabel(item)}" and all of its observations?`);
  if (!confirmed) return;
  await apiJson(`/api/tracked-queries/${item.id}?hard=true`, { method: "DELETE" });
  showNotice(`Deleted ${displayLabel(item)}.`, "success");
  if (selectedId === item.id) selectedId = null;
  if (editingId === item.id) resetTrackedForm();
  await loadTrackedQueries();
}

trackedForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = createTrackedBtn;
  submit.disabled = true;
  showNotice("");
  try {
    const body = formValues();
    const url = editingId ? `/api/tracked-queries/${editingId}` : "/api/tracked-queries";
    const saved = await apiJson(url, {
      method: editingId ? "PATCH" : "POST",
      body: JSON.stringify(body),
    });
    selectedId = saved.trackedQuery.id;
    showNotice(editingId ? "Tracked query updated." : "Tracked query saved.", "success");
    resetTrackedForm();
    await loadTrackedQueries();
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

cancelEditBtn?.addEventListener("click", resetTrackedForm);

refreshTrackedBtn?.addEventListener("click", () => {
  loadTrackedQueries().catch((error) => showNotice(error.message, "error"));
});

loadTrackedQueries().catch((error) => {
  trackedCount.textContent = "Unavailable";
  trackedList.innerHTML = `<p class="result-empty">Could not load tracked queries.</p>`;
  showNotice(error.message, "error");
});
