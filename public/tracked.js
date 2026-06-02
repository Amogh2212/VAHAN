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

const fmt = new Intl.NumberFormat("en-IN");
let trackedQueries = [];
let selectedId = null;

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

async function loadTrackedQueries() {
  showNotice("");
  trackedList.innerHTML = `<p class="result-empty">Loading tracked queries.</p>`;
  trackedCount.textContent = "Loading";

  const body = await apiJson("/api/tracked-queries");
  trackedQueries = body.trackedQueries ?? [];
  trackedCount.textContent = `${trackedQueries.length} saved`;

  const latestById = new Map();
  await Promise.all(trackedQueries.map(async (item) => {
    try {
      latestById.set(item.id, await latestObservation(item.id));
    } catch {
      latestById.set(item.id, null);
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
    return `
      <button type="button" class="tracked-item ${item.id === selectedId ? "active" : ""}" data-id="${item.id}">
        <span class="tracked-item-main">
          <strong>${escapeHtml(displayLabel(item))}</strong>
          <small>${escapeHtml(item.query)}</small>
        </span>
        <span class="tracked-item-meta">
          ${statusPill(item)}
          <span>${escapeHtml(item.runTimeLocal)} ${escapeHtml(item.timezone)}</span>
          <span>${latest ? fmt.format(latest.total) : "No observations"}</span>
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
  observationSummary.innerHTML = `<p class="result-empty">Create a tracked query to review daily totals and deltas.</p>`;
  observationsBody.innerHTML = `<tr><td colspan="6">No query selected.</td></tr>`;
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
  observationSummary.innerHTML = `<p class="result-empty">Loading observations.</p>`;
  observationsBody.innerHTML = `<tr><td colspan="6">Loading.</td></tr>`;

  const body = await apiJson(`/api/tracked-queries/${id}/observations?limit=30`);
  const observations = body.observations ?? [];
  const latest = observations[0] ?? null;

  observationSummary.innerHTML = latest
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
        <button type="button" class="secondary-action" data-action="toggle">${item.active ? "Pause" : "Resume"}</button>
        <button type="button" class="secondary-action danger-action" data-action="delete">Disable</button>
      </div>
    `
    : `
      <p class="result-empty">The daily runner has not stored observations for this query yet.</p>
      <div class="tracked-actions">
        <button type="button" class="secondary-action" data-action="toggle">${item.active ? "Pause" : "Resume"}</button>
        <button type="button" class="secondary-action danger-action" data-action="delete">Disable</button>
      </div>
    `;

  observationSummary.querySelector("[data-action='toggle']")?.addEventListener("click", () => toggleTrackedQuery(item));
  observationSummary.querySelector("[data-action='delete']")?.addEventListener("click", () => disableTrackedQuery(item));

  observationsBody.innerHTML = observations.length
    ? observations.map((row) => `
      <tr>
        <td>${escapeHtml(row.observationDate)}</td>
        <td>${fmt.format(row.total)}</td>
        <td>${deltaText(row.dailyDelta)}</td>
        <td>${deltaText(row.weeklyDelta)}</td>
        <td>${escapeHtml(row.dataStatus || "-")}</td>
        <td>${fmt.format(row.warnings?.length ?? 0)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6">No observations yet. Run <code>npm run tracked:run</code> after saving the query. If the query has no month, the worker uses the run month.</td></tr>`;
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

trackedForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.querySelector("#createTrackedBtn");
  submit.disabled = true;
  showNotice("");
  try {
    const body = {
      label: document.querySelector("#trackedLabel")?.value.trim() || null,
      query: document.querySelector("#trackedQuery")?.value.trim(),
      runTimeLocal: document.querySelector("#trackedRunTime")?.value || "08:00",
      timezone: document.querySelector("#trackedTimezone")?.value.trim() || "Asia/Calcutta",
      active: Boolean(document.querySelector("#trackedActive")?.checked),
    };
    const created = await apiJson("/api/tracked-queries", {
      method: "POST",
      body: JSON.stringify(body),
    });
    selectedId = created.trackedQuery.id;
    trackedForm.reset();
    document.querySelector("#trackedRunTime").value = "08:00";
    document.querySelector("#trackedTimezone").value = "Asia/Calcutta";
    document.querySelector("#trackedActive").checked = true;
    showNotice("Tracked query saved.", "success");
    await loadTrackedQueries();
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

refreshTrackedBtn?.addEventListener("click", () => {
  loadTrackedQueries().catch((error) => showNotice(error.message, "error"));
});

loadTrackedQueries().catch((error) => {
  trackedCount.textContent = "Unavailable";
  trackedList.innerHTML = `<p class="result-empty">Could not load tracked queries.</p>`;
  showNotice(error.message, "error");
});
