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
const authGate = document.querySelector("#authGate");
const trackedWorkspace = document.querySelector("#trackedWorkspace");
const accountStatus = document.querySelector("#accountStatus");
const logoutBtn = document.querySelector("#logoutBtn");
const telegramLinkBtn = document.querySelector("#telegramLinkBtn");

const fmt = new Intl.NumberFormat("en-IN");
let trackedQueries = [];
let selectedId = null;
let editingId = null;
let currentUser = null;

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
  if (!response.ok) {
    const error = new Error(body.error || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return body;
}

function setAuthState(user) {
  currentUser = user;
  const authenticated = Boolean(user);
  if (authGate) authGate.hidden = authenticated;
  if (trackedWorkspace) trackedWorkspace.hidden = !authenticated;
  if (logoutBtn) logoutBtn.hidden = !authenticated;
  if (telegramLinkBtn) telegramLinkBtn.hidden = !authenticated;
  if (refreshTrackedBtn) refreshTrackedBtn.hidden = !authenticated;
  if (accountStatus) {
    accountStatus.textContent = authenticated ? user.email : "Signed out";
  }
}

async function loadCurrentUser() {
  const body = await apiJson("/api/me");
  setAuthState(body.user);
  if (!body.authenticated && !body.googleConfigured) {
    showNotice("Google login is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, and APP_BASE_URL.", "error");
  }
  return body.user;
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
  if (!currentUser) return;
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

  const body = await apiJson(`/api/tracked-queries/${id}/observations?limit=30`);
  const observations = body.observations ?? [];
  const latest = observations[0] ?? null;
  const hasObservations = observations.length > 0;
  observationSummary.classList.toggle("empty-observation-state", !hasObservations);
  if (observationTableWrap) observationTableWrap.hidden = !hasObservations;

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
        <button type="button" class="secondary-action edit-action" data-action="edit">Edit</button>
        <button type="button" class="secondary-action" data-action="toggle">${item.active ? "Pause" : "Resume"}</button>
        <button type="button" class="secondary-action danger-action" data-action="disable">Disable</button>
        <button type="button" class="secondary-action danger-action" data-action="delete">Delete</button>
      </div>
    `
    : `
      <p class="result-empty">The daily runner has not stored observations for this query yet.</p>
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

  observationsBody.innerHTML = hasObservations
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
    : "";
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

logoutBtn?.addEventListener("click", async () => {
  await apiJson("/auth/logout", { method: "POST" });
  trackedQueries = [];
  selectedId = null;
  resetTrackedForm();
  setAuthState(null);
  renderEmptyDetail();
});

telegramLinkBtn?.addEventListener("click", async () => {
  try {
    const body = await apiJson("/api/telegram/link-code", { method: "POST" });
    const command = `/link ${body.code}`;
    const linkText = body.deepLink
      ? `Open Telegram: ${body.deepLink}`
      : `Send this command to the bot: ${command}`;
    await navigator.clipboard?.writeText(command).catch(() => {});
    showNotice(`${linkText}. The command has been copied if clipboard access is available.`, "success");
  } catch (error) {
    showNotice(error.message, "error");
  }
});

loadCurrentUser()
  .then((user) => {
    if (user) return loadTrackedQueries();
    trackedCount.textContent = "Login required";
    trackedList.innerHTML = `<p class="result-empty">Sign in to load your tracked queries.</p>`;
    renderEmptyDetail();
    return null;
  })
  .catch((error) => {
    trackedCount.textContent = "Unavailable";
    trackedList.innerHTML = `<p class="result-empty">Could not load tracked queries.</p>`;
    showNotice(error.message, "error");
  });
