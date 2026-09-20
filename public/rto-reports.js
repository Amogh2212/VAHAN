const state = {
  cadence: "daily",
  batches: [],
  batch: null,
  reports: [],
  report: null,
  currentUser: null,
  csrfToken: null,
  draftExplanations: [],
  oemCategory: "2W",
  searchTimer: null,
  readiness: null,
  requestId: 0,
  detailRequestId: 0,
  currentEvidenceMode: false,
  evidenceReadiness: null,
  trendFocus: null,
  trendMode: "date",
};

const OEM_CATEGORIES = Object.freeze(["2W", "3W", "4W"]);

const batchDateInput = document.querySelector("#rtoReportBatchDate");
const periodStatus = document.querySelector("#rtoReportPeriodStatus");
const periodLabel = document.querySelector("#rtoReportPeriodLabel");
const periodHelp = document.querySelector("#rtoReportPeriodHelp");
const searchInput = document.querySelector("#rtoReportSearch");
const statusFilter = document.querySelector("#rtoReportStatusFilter");
const reportList = document.querySelector("#rtoReportList");
const reportDetail = document.querySelector("#rtoReportDetail");

function apiJson(url, options = {}) {
  const method = String(options.method ?? "GET").toUpperCase();
  const headers = {
    accept: "application/json",
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(!["GET", "HEAD", "OPTIONS"].includes(method) && state.csrfToken
      ? { "x-csrf-token": state.csrfToken }
      : {}),
    ...(options.headers ?? {}),
  };
  return fetch(url, { credentials: "same-origin", ...options, method, headers }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed with ${response.status}`);
    return body;
  });
}

function initSidebar() {
  const frame = document.querySelector(".app-frame");
  const sidebar = document.querySelector("#featureSidebar");
  const trigger = document.querySelector("#sidebarTrigger");
  if (!frame || !sidebar || !trigger) return;
  const close = () => frame.classList.remove("sidebar-open");
  trigger.addEventListener("click", () => frame.classList.toggle("sidebar-open"));
  document.addEventListener("click", (event) => {
    if (!frame.classList.contains("sidebar-open")) return;
    if (sidebar.contains(event.target) || trigger.contains(event.target)) return;
    close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
}

async function loadInitialState() {
  try {
    const [readiness, batchesBody, me] = await Promise.all([
      apiJson("/api/rto-reports/readiness"),
      apiJson("/api/rto-reports/batches?limit=300"),
      apiJson("/api/me"),
    ]);
    state.currentUser = me.user ?? null;
    state.csrfToken = me.csrfToken ?? null;
    state.batches = batchesBody.batches ?? [];
    state.readiness = readiness;
    renderReadiness(readiness);
    selectCadence(state.cadence);
  } catch (error) {
    renderError(error.message);
  }
}

function renderReadiness(readiness) {
  document.body.classList.remove("rto-reports-source-error");
  const readinessPanel = document.querySelector(".rto-report-readiness");
  const title = document.querySelector("#rtoReportReadinessTitle");
  const metrics = document.querySelector("#rtoReportReadinessMetrics");
  const status = document.querySelector("#rtoReportReadinessStatus");
  const message = document.querySelector("#rtoReportReadinessMessage");
  readinessPanel?.classList.remove("is-unavailable");
  for (const tab of document.querySelectorAll(".rto-report-tab")) {
    tab.disabled = false;
    tab.removeAttribute("aria-disabled");
  }
  const complete = readiness.completeRtos ?? 0;
  const expected = readiness.expectedRtos ?? 100;
  metrics.innerHTML = `<span><strong>${fmt(complete)}</strong> / ${fmt(expected)} complete</span><span><strong>${fmt(readiness.cohortSize ?? 0)}</strong> frozen members</span>`;
  if (message) {
    message.hidden = true;
    message.textContent = "";
  }
  status.className = `status-pill ${readiness.eligible
    ? "status-ready"
    : readiness.reason === "cohort_incomplete"
      ? "status-ready-with-warnings"
      : "status-needs-review"}`;
  if (state.cadence === "daily" && readiness.dailyRegistrationEligible !== true) {
    // Every incomplete RTO is part of the partial-coverage cohort. Some may
    // have zero verified scopes; those remain explicitly unverified rather
    // than disappearing from the coverage summary.
    const partialRtos = (readiness.missingRtos ?? []).filter((entry) => Number(entry.validReports) < 6);
    const verifiedPartialScopes = partialRtos.reduce((total, entry) => total + Number(entry.validReports ?? 0), 0);
    const examples = partialRtos.slice(0, 3)
      .map((entry) => `${entry.rto} (${fmt(entry.validReports)}/6 scopes)`)
      .join("; ");
    title.textContent = partialRtos.length ? "Daily registrations partially collected" : "Daily registrations unavailable";
    status.className = "status-pill status-needs-review";
    status.textContent = partialRtos.length ? "Partial evidence" : "Comparison incomplete";
    metrics.innerHTML = partialRtos.length
      ? `<span><strong>${fmt(complete)}</strong> / ${fmt(expected)} RTOs complete</span><span><strong>${fmt(partialRtos.length)}</strong> partial RTOs · ${fmt(verifiedPartialScopes)} verified scopes</span>`
      : `<span><strong>${fmt(complete)}</strong> / ${fmt(expected)} RTOs with six registration scopes</span><span><strong>${fmt(readiness.comparisonEligibleRtos ?? 0)}</strong> / ${fmt(expected)} comparison-eligible</span>`;
    if (message) {
      message.hidden = false;
      message.textContent = partialRtos.length
        ? `Verified scopes are retained for operational review but excluded from the Daily total until all six scopes are available. ${examples}${partialRtos.length > 3 ? "; …" : ""}`
        : readiness.dailyRegistrationReason || "Consecutive compatible monthly-registration observations are incomplete.";
    }
    return;
  }
  if (readiness.eligible) {
    title.textContent = `${readiness.run?.snapshotDate ?? "Current cycle"} ready for reporting`;
    status.textContent = `${fmt(complete)} / ${fmt(expected)}`;
    return;
  }
  if (readiness.reason === "cohort_incomplete") {
    title.textContent = `${expected - complete} RTO${expected - complete === 1 ? "" : "s"} remaining`;
    status.textContent = `${fmt(complete)} available`;
    if (message) {
      message.hidden = false;
      message.textContent = `The source cycle is incomplete. Showing the ${fmt(complete)} completed RTOs below; ${fmt(expected - complete)} unavailable RTOs are marked for review and are not treated as zero.`;
    }
    return;
  }
  if (readiness.reason === "cohort_size_not_100") {
    title.textContent = `Frozen cohort has ${readiness.cohortSize ?? 0} RTOs`;
    status.textContent = "Ineligible";
    return;
  }
  title.textContent = "Awaiting the first frozen top-100 cycle";
  status.textContent = "No cohort";
}

function activeEvidenceReadiness() {
  return state.evidenceReadiness ?? state.readiness;
}

function activateEvidence(readiness) {
  state.evidenceReadiness = readiness;
  state.currentEvidenceMode = true;
  state.batch = null;
  state.reports = readiness.currentCycleEvidence ?? [];
  state.report = state.reports[0] ?? null;
  batchDateInput.disabled = false;
  batchDateInput.value = readiness.run?.snapshotDate ?? "";
  statusFilter.disabled = true;
  statusFilter.value = "";
  if (periodLabel) periodLabel.textContent = "Source evidence date";
  if (periodHelp) periodHelp.textContent = "Saved month-to-date source evidence; this is not a complete Daily registration report.";
  updatePeriodStatus(null);
  periodStatus.textContent = "Source evidence";
  renderBatch();
  renderReportList();
  renderCurrentEvidenceDetail(state.report);
}

function selectCadence(cadence) {
  state.cadence = cadence;
  state.evidenceReadiness = null;
  if (state.readiness) renderReadiness(state.readiness);
  ++state.requestId;
  ++state.detailRequestId;
  for (const tab of document.querySelectorAll(".rto-report-tab")) {
    const active = tab.dataset.cadence === cadence;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  const matching = batchesForCadence(cadence);
  renderPeriodPicker(matching);
  const currentEvidence = cadence === "daily" ? (state.readiness?.currentCycleEvidence ?? []) : [];
  if (currentEvidence.length) {
    activateEvidence(state.readiness);
    return;
  }
  state.currentEvidenceMode = false;
  statusFilter.disabled = false;
  if (periodLabel) periodLabel.textContent = "Report period";
  if (periodHelp) periodHelp.textContent = "Select a generated report period.";
  if (!matching.length) {
    state.batch = null;
    state.reports = [];
    state.report = null;
    updatePeriodStatus(null);
    renderBatch();
    renderReportList();
    renderEmptyDetail(
      state.batches.length ? `No ${cadence} reports yet` : "No reports generated yet",
      state.batches.length
        ? `Choose another cadence to view an available batch.`
        : "Daily reports appear after all six EV/ICE and 2W/3W/4W monthly-registration observations are stored for every frozen RTO. Missing or incompatible comparisons remain unavailable rather than becoming zero.",
    );
    return;
  }
  const preferred =
    matching.find((batch) => batch.id === state.batch?.id) ??
    findBatchForDate(batchDateInput.value, matching) ??
    matching[0];
  setPeriodInputDate(preferred);
  selectBatch(preferred.id);
}

async function selectBatch(batchId) {
  state.batch = state.batches.find((batch) => batch.id === Number(batchId)) ?? null;
  state.report = null;
  setPeriodInputDate(state.batch);
  updatePeriodStatus(state.batch);
  renderBatch();
  await loadReports();
}

async function loadReports() {
  if (state.currentEvidenceMode) {
    const q = searchInput.value.trim().toLowerCase();
    state.reports = (activeEvidenceReadiness()?.currentCycleEvidence ?? []).filter((entry) => !q || `${entry.state} ${entry.rto}`.toLowerCase().includes(q));
    renderReportList();
    const selected = state.reports.find((entry) => entry.rto === state.report?.rto && entry.state === state.report?.state) ?? state.reports[0];
    state.report = selected ?? null;
    renderCurrentEvidenceDetail(state.report);
    return;
  }
  if (!state.batch) return;
  const requestId = ++state.requestId;
  const batchId = state.batch.id;
  ++state.detailRequestId;
  reportList.innerHTML = `<p class="result-empty">Loading ${escapeHtml(state.cadence)} reports.</p>`;
  const params = new URLSearchParams({ limit: "100" });
  const q = searchInput.value.trim();
  const status = statusFilter.value;
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  try {
    const body = await apiJson(`/api/rto-reports/batches/${state.batch.id}/reports?${params}`);
    if (requestId !== state.requestId || batchId !== state.batch?.id) return;
    state.reports = body.reports ?? [];
    renderReportList();
    const stillSelected = state.reports.find((report) => report.id === state.report?.id);
    if (stillSelected) await selectReport(stillSelected.id);
    else if (state.reports.length) await selectReport(state.reports[0].id);
    else renderEmptyDetail(
      "No reports match these filters",
      "Try a different RTO name or clear the status filter.",
    );
  } catch (error) {
    if (requestId !== state.requestId || batchId !== state.batch?.id) return;
    renderError(error.message);
  }
}

function renderBatch() {
  const strip = document.querySelector("#rtoReportBatchStrip");
  const download = document.querySelector("#rtoReportBatchCsv");
  // Current-cycle evidence is displayed in the normal list/detail workspace even
  // though it has not yet produced a generated Daily report batch.
  document.body.classList.toggle("rto-reports-no-batch", !state.batch && !state.currentEvidenceMode);
  document.body.classList.toggle("rto-reports-current-evidence", state.currentEvidenceMode);
  if (!state.batch) {
    strip.hidden = true;
    download.hidden = true;
    document.querySelector("#rtoReportListMeta").textContent = state.currentEvidenceMode ? "Current verified source evidence" : "No generated batch";
    return;
  }
  const ready = Math.max(0, state.batch.reportCount - state.batch.warningCount - state.batch.reviewCount);
  strip.hidden = false;
  document.querySelector("#rtoReportGeneratedCount").textContent = `${fmt(state.batch.coverageCount)} / ${fmt(state.batch.cohortSize)}`;
  document.querySelector("#rtoReportReadyCount").textContent = fmt(ready);
  document.querySelector("#rtoReportWarningCount").textContent = fmt(state.batch.warningCount);
  document.querySelector("#rtoReportReviewCount").textContent = fmt(state.batch.reviewCount);
  document.querySelector("#rtoReportRevision").textContent = `r${state.batch.revision}`;
  document.querySelector("#rtoReportListMeta").textContent = `${periodOption(state.batch)} | ${statusLabel(state.batch.status)}`;
  download.href = `/api/rto-reports/batches/${state.batch.id}.csv`;
  download.hidden = false;
}

function batchesForCadence(cadence = state.cadence) {
  return state.batches
    .filter((batch) => batch.cadence === cadence)
    .sort((a, b) => String(b.periodEnd ?? "").localeCompare(String(a.periodEnd ?? "")));
}

function renderPeriodPicker(batches) {
  if (!batchDateInput) return;
  const dates = batches.flatMap((batch) => [batch.periodStart, batch.periodEnd].filter(Boolean));
  const evidenceReadiness = activeEvidenceReadiness();
  const currentEvidenceDate = state.cadence === "daily" && evidenceReadiness?.currentCycleEvidence?.length
    ? evidenceReadiness?.run?.snapshotDate
    : null;
  if (currentEvidenceDate) dates.push(currentEvidenceDate);
  batchDateInput.disabled = batches.length === 0;
  batchDateInput.min = dates.length ? dates.reduce((min, date) => date < min ? date : min, dates[0]) : "";
  batchDateInput.max = dates.length ? dates.reduce((max, date) => date > max ? date : max, dates[0]) : "";
  batchDateInput.setCustomValidity("");
}

function setPeriodInputDate(batch) {
  if (!batchDateInput) return;
  if (!batch) {
    batchDateInput.value = "";
    return;
  }
  batchDateInput.value = batch.periodEnd ?? batch.sourceSnapshotDate ?? batch.periodStart ?? "";
  batchDateInput.setCustomValidity("");
}

function findBatchForDate(date, batches = batchesForCadence()) {
  if (!date) return null;
  return batches.find((batch) => {
    const start = batch.periodStart ?? batch.periodEnd;
    const end = batch.periodEnd ?? batch.periodStart;
    return start && end && date >= start && date <= end;
  }) ?? null;
}

function updatePeriodStatus(batch) {
  if (!periodStatus) return;
  periodStatus.className = `status-pill ${batch ? statusClass(batch.status) : ""}`;
  periodStatus.textContent = batch ? statusLabel(batch.status) : "No report";
}

function openDatePicker() {
  if (!batchDateInput || batchDateInput.disabled) return;
  batchDateInput.focus({ preventScroll: true });
  if (typeof batchDateInput.showPicker !== "function") return;
  try {
    batchDateInput.showPicker();
  } catch {}
}

function renderReportList() {
  if (state.currentEvidenceMode) {
    document.querySelector("#rtoReportListTitle").textContent = "Current RTO evidence";
    document.querySelector("#rtoReportListMeta").textContent = `${fmt(state.reports.length)} shown | month-to-date source evidence`;
    reportList.innerHTML = state.reports.map((entry) => `
      <button type="button" class="rto-report-list-item${entry.rto === state.report?.rto && entry.state === state.report?.state ? " active" : ""}" data-current-rto="${escapeHtml(entry.rto)}" data-current-state="${escapeHtml(entry.state)}">
        <span class="rto-report-rank">${fmt(entry.verifiedScopes)}/6</span>
        <span class="rto-report-list-copy"><strong>${escapeHtml(entry.rto)}</strong><small>${escapeHtml(entry.state)} | MTD ${fmt(entry.totalMonthToDate)}</small></span>
        <span class="rto-report-list-status ${entry.verifiedScopes === 6 ? "status-ready" : "status-needs-review"}">${entry.verifiedScopes === 6 ? "Verified" : "Partial"}</span>
      </button>
    `).join("") || `<p class="result-empty">No RTO evidence matches this search.</p>`;
    for (const button of reportList.querySelectorAll("[data-current-rto]")) {
      button.addEventListener("click", () => {
        state.report = state.reports.find((entry) => entry.rto === button.dataset.currentRto && entry.state === button.dataset.currentState) ?? null;
        renderReportList();
        renderCurrentEvidenceDetail(state.report);
      });
    }
    return;
  }
  document.querySelector("#rtoReportListTitle").textContent = "Individual RTO reports";
  if (!state.batch) {
    reportList.innerHTML = `<p class="result-empty">No report batch has been generated yet.</p>`;
    return;
  }
  document.querySelector("#rtoReportListMeta").textContent = `${fmt(state.reports.length)} shown | ${periodOption(state.batch)}`;
  if (!state.reports.length) {
    reportList.innerHTML = `<p class="result-empty">No RTO reports match the current filters.</p>`;
    return;
  }
  reportList.innerHTML = state.reports.map((report) => `
    <button type="button" class="rto-report-list-item${report.id === state.report?.id ? " active" : ""}" data-report-id="${report.id}">
      <span class="rto-report-rank">${report.cohortRank ? `#${report.cohortRank}` : "--"}</span>
      <span class="rto-report-list-copy">
        <strong>${escapeHtml(report.rto)}</strong>
        <small>${escapeHtml(report.state)} | ${escapeHtml(reportEvLabel(report))}</small>
      </span>
      <span class="rto-report-list-status ${statusClass(report.status)}">${escapeHtml(shortStatus(report.status))}</span>
    </button>
  `).join("");
  for (const button of reportList.querySelectorAll("[data-report-id]")) {
    button.addEventListener("click", () => selectReport(Number(button.dataset.reportId)));
  }
}

async function selectReport(reportId) {
  const requestId = ++state.detailRequestId;
  const batchId = state.batch?.id;
  try {
    const [body, draftsBody] = await Promise.all([
      apiJson(`/api/rto-reports/${reportId}`),
      state.currentUser?.role === "admin"
        ? apiJson(`/api/admin/rto-factor-explanations?reportId=${encodeURIComponent(reportId)}&status=draft`)
        : Promise.resolve({ explanations: [] }),
    ]);
    if (requestId !== state.detailRequestId || batchId !== state.batch?.id) return;
    state.report = body.report;
    state.draftExplanations = draftsBody.explanations ?? [];
    renderReportList();
    renderReportDetail(state.report);
  } catch (error) {
    if (requestId !== state.detailRequestId || batchId !== state.batch?.id) return;
    renderError(error.message);
  }
}

function renderReportDetail(report) {
  const payload = report.payload ?? {};
  const metrics = payload.metrics ?? {};
  const isDaily = payload.cadence === "daily";
  const daily = payload.dailyRegistration;
  const categories = payload.categories ?? [];
  const oems = payload.oems ?? [];
  const selectedOemRows = oemRowsForCategory(oems, state.oemCategory, isDaily);
  const warnings = payload.quality?.warnings ?? [];
  const explanations = report.explanations ?? [];
  reportDetail.innerHTML = `
    <header class="rto-report-detail-head">
      <div>
        <span class="panel-kicker">${escapeHtml(report.state)} | ${escapeHtml(payload.period?.label ?? "")}</span>
        <h2>${escapeHtml(report.rto)}</h2>
        <p>${escapeHtml(report.summary)}</p>
      </div>
      <div class="rto-report-detail-actions">
        <span class="status-pill ${statusClass(report.status)}">${escapeHtml(statusLabel(report.status))}</span>
        <a class="secondary-action" href="/api/rto-reports/${report.id}/csv">CSV</a>
        <a class="secondary-action" href="/api/rto-reports/${report.id}/pdf">PDF</a>
      </div>
    </header>

    <section class="rto-report-metrics" aria-label="Headline metrics">
      ${isDaily
        ? `${dailyMetricBlock("Previous-day registrations", daily?.previousDayRegistrations)}
           ${dailyMetricBlock("Today's EV registrations", daily?.evRegistrations)}
           ${dailyMetricBlock("Today's ICE registrations", daily?.iceRegistrations)}
           ${dailyMetricBlock("Today's EV share", daily?.evShare, "percent")}
           ${dailyMetricBlock("Today's rank", daily?.rank, "rank")}`
        : `${metricBlock("Active EV stock", metrics.stock?.ev, `Net stock change: ${signed(metrics.period?.ev)}`)}
           ${metricBlock("Active ICE stock", metrics.stock?.ice, `Net stock change: ${signed(metrics.period?.ice)}`)}
           ${metricBlock("EV stock share", percent(metrics.stock?.evShare), "Share of the selected stock categories")}
           ${metricBlock("EV stock rank", payload.rto?.cohortRank ? `#${payload.rto.cohortRank}` : "N/A", payload.rto?.previousRank ? `Previous #${payload.rto.previousRank}` : "No prior rank")}`}
    </section>
    <p class="rto-report-quality">${escapeHtml(isDaily
      ? (daily?.reason ?? "Daily values are calculated from consecutive, compatible Public Dashboard monthly-registration observations.")
      : (payload.source?.limitation ?? "Active-stock observations are not daily registration counts. Unchanged stock does not establish source freshness."))}</p>

    ${isDaily ? `
      <section class="rto-report-evidence">
        <div class="rto-report-section-head">
          <div><h3>Source month-to-date registrations</h3><span>Accepted Public Dashboard totals for ${escapeHtml(payload.source?.targetMonth ?? payload.period?.end?.slice(0, 7) ?? "the target month")}; these are source observations, not Daily values</span></div>
        </div>
        <div class="rto-report-metrics">
          ${metricBlock("EV month to date", metrics.sourceMonthToDate?.ev, "Public Dashboard monthly-registration observation")}
          ${metricBlock("ICE month to date", metrics.sourceMonthToDate?.ice, "Public Dashboard monthly-registration observation")}
          ${metricBlock("Combined month to date", metrics.sourceMonthToDate?.total, "EV + ICE across 2W, 3W and 4W")}
        </div>
      </section>
    ` : ""}

    ${warnings.length ? `
      <section class="rto-report-quality">
        <div class="rto-report-section-head"><h3>Data quality</h3></div>
        <ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
      </section>
    ` : ""}

    ${renderFactorContextAvailability(report.factorContext)}
    ${renderApprovedExplanations(explanations)}
    ${state.currentUser?.role === "admin" ? renderDraftExplanations(state.draftExplanations) : ""}

    <section class="rto-report-evidence">
      <div class="rto-report-section-head">
        <div><h3>${isDaily ? "Daily registrations" : "Observed active stock"}</h3><span>${isDaily ? "Verified registrations for each calendar day (IST)" : "EV and ICE snapshot totals; gaps mean no verified observation"}</span></div>
      </div>
      <div class="rto-report-trend">${trendSvg(payload.trend ?? [], isDaily)}</div>
    </section>

    ${isDaily ? `<section class="rto-report-evidence">
      <div class="rto-report-section-head">
        <div><h3>Vehicle categories</h3><span>Daily registration contribution from compatible month-to-date observations</span></div>
      </div>
      <div class="rto-report-category-bars">${categoryBars(categories, true)}</div>
    </section>${renderDailyOemEvidence(payload.oemEvidence)}` : `<section class="rto-report-evidence">
      <div class="rto-report-section-head">
        <div><h3>Vehicle categories</h3><span>${isDaily ? "Daily registration contribution" : "2W, 3W, and 4W stock contribution"}</span></div>
      </div>
      <div class="rto-report-category-bars">${categoryBars(categories, isDaily)}</div>
    </section>

    <section class="rto-report-evidence">
      <div class="rto-report-section-head">
        <div><h3>OEM stock</h3><span>Source top five per fuel and category, plus Other / untracked. N/A means not reported, not zero.</span></div>
        <div class="rto-report-oem-category-filter" role="group" aria-label="OEM vehicle category">
          ${OEM_CATEGORIES.map((category) => `<button type="button" class="${state.oemCategory === category ? "active" : ""}" data-oem-category="${category}" aria-pressed="${state.oemCategory === category}">${category} OEMs</button>`).join("")}
        </div>
      </div>
      <div class="rto-report-table-wrap">
        <table class="rto-report-table">
          <thead><tr><th>OEM</th><th>EV stock</th><th>ICE stock</th><th>Reported stock</th><th>Previous stock</th><th>Net change</th></tr></thead>
          <tbody>${selectedOemRows.length ? selectedOemRows.map((row) => `
            <tr>
              <td>${escapeHtml(row.oem)}</td>
              <td>${fmt(row.stock?.ev)}</td>
              <td>${fmt(row.stock?.ice)}</td>
              <td>${fmt(row.stock?.total)}</td>
              <td>${fmt(row.previousPeriod?.total)}</td>
              <td class="${movementClass(row.change?.total?.absolute)}">${signed(row.change?.total?.absolute)}</td>
            </tr>
          `).join("") : `<tr><td colspan="6" class="result-empty">No OEM observation is available for ${escapeHtml(state.oemCategory)} in this period.</td></tr>`}</tbody>
        </table>
      </div>
    </section>`}

    <footer class="rto-report-source">
      ${isDaily ? `<span>Report date: ${escapeHtml(daily?.date ?? payload.period?.end)} · Asia/Kolkata</span><span>${escapeHtml(payload.source?.freshnessReason ?? "Upstream freshness is unverified.")}</span>` : ""}
      <span>Totals: ${escapeHtml(payload.source?.totalsTable ?? "Unavailable")}</span>
      <span>OEMs: ${escapeHtml(payload.source?.oemTable ?? "Unavailable under the current source contract")}</span>
      <span>Cohort ${escapeHtml(report.cohortHash?.slice(0, 10) ?? "unknown")} | revision ${fmt(report.revision)}</span>
    </footer>
  `;
  for (const button of reportDetail.querySelectorAll("[data-oem-category]")) {
    button.addEventListener("click", () => {
      state.oemCategory = button.dataset.oemCategory;
      renderReportDetail(state.report);
    });
  }
  for (const button of reportDetail.querySelectorAll("[data-factor-review]")) {
    button.addEventListener("click", () => reviewExplanation({
      explanationId: Number(button.dataset.explanationId),
      decision: button.dataset.factorReview,
    }));
  }
}

function renderFactorContextAvailability(context = {}) {
  if (context.status !== "unavailable") return "";
  return `
    <section class="rto-report-quality" aria-live="polite">
      <div class="rto-report-section-head"><h3>Possible-driver context unavailable</h3></div>
      <p>${escapeHtml(context.message ?? "Reviewed context is temporarily unavailable. Active-stock facts remain available.")}</p>
    </section>
  `;
}

function renderApprovedExplanations(explanations = []) {
  if (!explanations.length) return "";
  return `
    <section class="rto-report-evidence rto-factor-context">
      <div class="rto-report-section-head">
        <div><h3>Possible drivers behind the numbers</h3><span>Reviewed context; association is not proof of causation</span></div>
      </div>
      <div class="rto-factor-context-list">
        ${explanations.map((explanation) => factorExplanationCard(explanation)).join("")}
      </div>
    </section>
  `;
}

function renderDraftExplanations(explanations = []) {
  if (!explanations.length) return "";
  return `
    <section class="rto-report-evidence rto-factor-review">
      <div class="rto-report-section-head">
        <div><h3>Context drafts awaiting review</h3><span>Visible only to administrators</span></div>
      </div>
      ${explanations.map((explanation) => `
        <article class="rto-factor-draft">
          <strong>${escapeHtml(explanation.heading ?? explanation.headline ?? explanation.title ?? "Possible driver")}</strong>
          <span class="status-pill">${escapeHtml(factorStatus(explanation))}</span>
          <textarea data-factor-body="${explanation.id}" aria-label="Review explanation text">${escapeHtml(explanation.body ?? explanation.narrative ?? "")}</textarea>
          ${factorSourceList(explanation.citations ?? explanation.sources ?? explanation.documents ?? [])}
          <div class="rto-factor-review-actions">
            <button type="button" class="secondary-action" data-factor-review="approved" data-explanation-id="${explanation.id}">Approve</button>
            <button type="button" class="secondary-action" data-factor-review="needs_more_data" data-explanation-id="${explanation.id}">Needs more data</button>
            <button type="button" class="secondary-action danger-action" data-factor-review="rejected" data-explanation-id="${explanation.id}">Reject</button>
          </div>
        </article>
      `).join("")}
    </section>
  `;
}

function factorExplanationCard(explanation = {}) {
  const limitations = Array.isArray(explanation.limitations) ? explanation.limitations : [];
  return `
    <article class="rto-factor-card">
      <div class="rto-factor-card-head">
        <strong>${escapeHtml(explanation.finalHeading ?? explanation.heading ?? explanation.headline ?? explanation.title ?? "Possible driver")}</strong>
        <span class="status-pill status-ready">${escapeHtml(factorStatus(explanation))}</span>
      </div>
      <p>${escapeHtml(explanation.finalBody ?? explanation.body ?? explanation.narrative ?? explanation.summary ?? "")}</p>
      ${limitations.length ? `<p class="rto-factor-limit">${limitations.map((item) => escapeHtml(item)).join(" ")}</p>` : ""}
      ${factorSourceList(explanation.citations ?? explanation.sources ?? explanation.documents ?? [])}
    </article>
  `;
}

function factorSourceList(sources = []) {
  if (!sources.length) return "";
  return `<ul class="rto-factor-sources">${sources.map((source) => {
    const document = source.document ?? source;
    const href = safeHttpUrl(document.url ?? document.sourceUrl ?? document.canonicalUrl);
    const label =
      source.citationLabel ??
      document.title ??
      document.source?.publisher ??
      document.publisher ??
      `Source ${document.id ?? source.documentId ?? ""}`.trim();
    return href
      ? `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></li>`
      : `<li>${escapeHtml(label)}</li>`;
  }).join("")}</ul>`;
}

async function reviewExplanation({ explanationId, decision }) {
  const textarea = reportDetail.querySelector(`[data-factor-body="${explanationId}"]`);
  const explanation = state.draftExplanations.find((entry) => Number(entry.id) === Number(explanationId));
  if (!explanation) return;
  const originalBody = String(explanation.body ?? explanation.narrative ?? "").trim();
  const editedBody = textarea?.value?.trim() || "";
  const changed = editedBody !== originalBody;
  const reviewDecision = decision === "approved" && changed ? "edited_and_approved" : decision;
  let note = "";
  if (["needs_more_data", "rejected"].includes(reviewDecision)) {
    note = window.prompt(
      reviewDecision === "rejected" ? "Why reject this explanation?" : "What data is missing?",
      "",
    )?.trim() ?? "";
    if (!note) {
      window.alert("Enter a reason to continue.");
      return;
    }
  }
  try {
    await apiJson(`/api/admin/rto-factor-explanations/${explanationId}/review`, {
      method: "POST",
      body: JSON.stringify({
        decision: reviewDecision,
        editedHeading: reviewDecision === "edited_and_approved"
          ? explanation.heading ?? explanation.headline ?? explanation.title ?? "Possible driver"
          : null,
        editedBody: reviewDecision === "edited_and_approved" ? editedBody : null,
        reason: note || null,
      }),
    });
    await selectReport(state.report.id);
  } catch (error) {
    window.alert(`Review failed: ${error.message || "Please try again."}`);
  }
}

function factorStatus(explanation = {}) {
  return String(
    explanation.validationStatus ??
    explanation.validationDecisionStatus ??
    explanation.decisionStatus ??
    explanation.evidenceStatus ??
    explanation.reviewStatus ??
    explanation.status ??
    "reviewed",
  )
    .replaceAll("_", " ");
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""), window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function metricBlock(label, value, comparison) {
  const display = typeof value === "string" ? value : fmt(value);
  return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(display)}</strong><small>${escapeHtml(comparison ?? "")}</small></article>`;
}

function sourceEvidenceMetricBlock(label, total, daily, comparison = "Current cycle") {
  const dailyValue = daily?.value;
  const verified = daily?.status === "available" || daily?.status === "correction";
  const isCorrection = Number(dailyValue) < 0;
  const arrow = isCorrection ? "↓" : "↑";
  const change = verified
    ? `<b class="rto-current-daily-change ${isCorrection ? "is-down" : "is-up"}" aria-label="${escapeHtml(`${arrow} ${signed(dailyValue)} verified today`)}">${arrow} ${escapeHtml(signed(dailyValue))}</b>`
    : "";
  return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(fmt(total))}${change}</strong><small>${escapeHtml(verified ? `${comparison} · verified Daily change` : comparison)}</small></article>`;
}

function dailyMetricBlock(label, field, format = "number") {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (field?.date !== today) label = label.replace("Today's ", "");
  const value = field?.value;
  const display = field?.status === "unavailable" || !Number.isFinite(value)
    ? "Unavailable"
    : format === "percent"
      ? percent(value)
      : format === "rank"
        ? `#${fmt(value)}`
        : signed(value);
  const stateText = field?.status === "correction" ? "Correction preserved" : field?.status === "available" ? "Verified comparison" : field?.reason;
  return metricBlock(label, display, `${field?.date ?? "Selected date"} (IST) · ${stateText ?? "Unavailable"}`);
}

function renderCurrentEvidenceDetail(entry) {
  if (!entry) return renderEmptyDetail("No current evidence matches this search", "Clear the RTO search to see the collected source evidence.");
  const evidenceReadiness = activeEvidenceReadiness();
  const complete = entry.verifiedScopes === 6;
  const daily = entry.daily ?? { status: "unavailable" };
  const dailyAvailable = daily.status === "available" || daily.status === "correction";
  const date = evidenceReadiness?.run?.snapshotDate ?? "Selected date";
  reportDetail.innerHTML = `
    <header class="rto-report-detail-head"><div><span class="panel-kicker">Source evidence · ${escapeHtml(evidenceReadiness?.run?.snapshotDate ?? "")}</span><h2>${escapeHtml(entry.rto)}</h2><p>${escapeHtml(entry.state)} · ${fmt(entry.verifiedScopes)}/6 verified monthly-registration scopes. These are month-to-date source totals, not Daily registrations.</p></div><span class="status-pill ${complete ? "status-ready" : "status-needs-review"}">${complete ? "Verified evidence" : "Partial evidence"}</span></header>
    <section class="rto-report-metrics" aria-label="Month-to-date source totals">
      ${sourceEvidenceMetricBlock("EV registrations", entry.evMonthToDate, { value: daily.ev, status: daily.status })}
      ${sourceEvidenceMetricBlock("ICE registrations", entry.iceMonthToDate, { value: daily.ice, status: daily.status })}
      ${metricBlock("Total registrations", entry.totalMonthToDate, complete ? "EV + ICE combined" : "Partial source coverage")}
      ${metricBlock("Daily total", dailyAvailable ? signed(daily.total) : "Unavailable", dailyAvailable ? `${date} · verified previous-day match` : "Needs a matching previous-day scope")}
    </section>
    <section class="rto-report-quality"><strong>${dailyAvailable ? "Individual Daily value verified" : "Daily value unavailable"}</strong><p>${dailyAvailable ? "EV, ICE, and total Daily changes are calculated from this RTO’s six matching prior-day registration scopes. The full 100-RTO report and rank remain unavailable until the whole cohort is complete." : "This RTO needs six matching prior-day registration scopes before a Daily value can be shown. Missing source scopes are not treated as zero."}</p></section>
    ${renderCurrentFuelDistribution(entry)}
    <section class="rto-report-evidence">
      <div class="rto-report-section-head"><div><h3>Registration trend</h3><span>${state.trendMode === "date" ? "Daily registration history" : "Current-cycle month-to-date registrations by vehicle class"}; click a line or legend item to focus it.</span></div><div class="rto-report-trend-toggle" role="group" aria-label="Trend grouping"><button type="button" class="${state.trendMode === "date" ? "active" : ""}" data-trend-mode="date" aria-pressed="${state.trendMode === "date"}">Date</button><button type="button" class="${state.trendMode === "category" ? "active" : ""}" data-trend-mode="category" aria-pressed="${state.trendMode === "category"}">Vehicle category</button></div></div>
      <div class="rto-report-trend">${trendSvg(currentEvidenceTrend(entry, state.trendMode), true)}</div>
    </section>
  `;
  for (const button of reportDetail.querySelectorAll("[data-trend-focus]")) {
    button.addEventListener("click", () => {
      const focus = button.dataset.trendFocus || null;
      state.trendFocus = state.trendFocus === focus ? null : focus;
      renderCurrentEvidenceDetail(entry);
    });
  }
  for (const button of reportDetail.querySelectorAll("[data-trend-mode]")) {
    button.addEventListener("click", () => {
      state.trendMode = button.dataset.trendMode === "category" ? "category" : "date";
      state.trendFocus = null;
      renderCurrentEvidenceDetail(entry);
    });
  }
}

function currentEvidenceTrend(entry, mode = "date") {
  if (mode === "date") return Array.isArray(entry.trend) ? entry.trend : [];
  const scopes = new Map((entry.scopes ?? []).map((scope) => [`${scope.fuelGroup}/${scope.vehicleCategory}`, Number(scope.total)]));
  return ["2W", "3W", "4W"].map((vehicleCategory) => {
    const ev = scopes.get(`EV/${vehicleCategory}`);
    const ice = scopes.get(`ICE/${vehicleCategory}`);
    return { label: vehicleCategory, ev, ice, total: [ev, ice].every(Number.isFinite) ? ev + ice : null };
  }).filter((row) => Number.isFinite(row.ev) || Number.isFinite(row.ice) || Number.isFinite(row.total));
}

function renderCurrentFuelDistribution(entry) {
  const totals = new Map((entry.scopes ?? []).map((scope) => [`${scope.fuelGroup}/${scope.vehicleCategory}`, Number(scope.total)]));
  const rows = ["2W", "3W", "4W"].map((vehicleCategory) => {
    const ev = totals.get(`EV/${vehicleCategory}`);
    const ice = totals.get(`ICE/${vehicleCategory}`);
    const available = Number.isFinite(ev) || Number.isFinite(ice);
    const total = (Number.isFinite(ev) ? ev : 0) + (Number.isFinite(ice) ? ice : 0);
    const evWidth = total ? (100 * (Number.isFinite(ev) ? ev : 0)) / total : 0;
    const iceWidth = total ? (100 * (Number.isFinite(ice) ? ice : 0)) / total : 0;
    return `
      <div class="rto-current-fuel-row">
        <strong>${vehicleCategory}</strong>
        <div class="rto-current-fuel-content">
          <div class="rto-current-fuel-values"><span class="ev"><i></i><small>EV</small><b>${Number.isFinite(ev) ? fmt(ev) : "Unavailable"}</b></span><span class="ice"><i></i><small>ICE</small><b>${Number.isFinite(ice) ? fmt(ice) : "Unavailable"}</b></span></div>
          ${available ? `<div class="rto-current-fuel-bar" aria-label="${vehicleCategory}: EV ${fmt(ev)}, ICE ${fmt(ice)}"><i class="ev" style="width:${evWidth}%"></i><i class="ice" style="width:${iceWidth}%"></i></div>` : `<span class="rto-current-fuel-unavailable">Both fuel scopes unavailable</span>`}
        </div>
      </div>`;
  }).join("");
  return `
    <section class="rto-report-evidence rto-current-fuel-distribution">
      <div class="rto-report-section-head"><div><h3>Fuel distribution by vehicle class</h3><span>Verified month-to-date registrations. Missing scopes are not treated as zero.</span></div></div>
      <div class="rto-current-fuel-legend"><span><i class="ev"></i>EV</span><span><i class="ice"></i>ICE</span></div>
      <div class="rto-current-fuel-rows">${rows}</div>
    </section>`;
}

function reportEvLabel(report) {
  if (state.cadence === "daily") {
    return Number.isFinite(report.periodEv) ? `Daily EV ${signed(report.periodEv)}` : "Daily registrations unavailable";
  }
  return `EV stock ${fmt(report.mtdEv)}`;
}

function oemRowsForCategory(oems, category, isDaily = false) {
  return oems.flatMap((source) => {
    const row = source.categories?.find((item) => item.vehicleCategory === category);
    const values = isDaily ? row?.period : row?.stock;
    if (!row || ![values?.ev, values?.ice].some(Number.isFinite)) return [];
    return [{ oem: source.oem, ...row }];
  });
}

function categoryBars(categories, isDaily = false) {
  return categories.map((category) => {
    const row = { ...category, period: isDaily ? category.period : category.stock };
    const values = [row.period?.ev, row.period?.ice].filter(Number.isFinite);
    const max = Math.max(1, ...values);
    return `
    <div class="rto-report-category-row" aria-label="${escapeHtml(`${row.vehicleCategory}: EV ${fmt(row.period?.ev)}, ICE ${fmt(row.period?.ice)}`)}">
      <strong>${escapeHtml(row.vehicleCategory)}</strong>
      <div class="rto-report-bar-pair">
        <span><i class="ev" style="width:${barWidth(row.period?.ev, max)}%"></i></span>
        <span><i class="ice" style="width:${barWidth(row.period?.ice, max)}%"></i></span>
      </div>
      <div><span>EV ${fmt(row.period?.ev)}</span><span>ICE ${fmt(row.period?.ice)}</span></div>
    </div>
  `;
  }).join("");
}

function trendSvg(rows, isDaily = false) {
  const usable = rows.filter((row) => Number.isFinite(row.ev) || Number.isFinite(row.ice));
  if (usable.length < 2) return `<p class="result-empty">${isDaily ? "Not enough compatible consecutive monthly-registration observations for a Daily trend." : "Not enough comparable dates."}</p>`;
  const width = 760;
  const height = 268;
  const pad = { top: 22, right: 24, bottom: 42, left: 48 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const fields = ["ev", "ice", "total"];
  const focus = fields.includes(state.trendFocus) ? state.trendFocus : null;
  const visibleFields = focus ? [focus] : fields;
  const values = usable.flatMap((row) => visibleFields.map((field) => row[field])).filter(Number.isFinite);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const tickStep = Math.max(1, Math.ceil((max - min) / 4));
  const yMax = Math.max(tickStep, Math.ceil(max / tickStep) * tickStep);
  const yMin = Math.min(0, Math.floor(min / tickStep) * tickStep);
  const yRange = yMax - yMin || 1;
  const x = (index) => pad.left + (index / Math.max(1, usable.length - 1)) * chartWidth;
  const y = (value) => pad.top + (1 - ((value - yMin) / yRange)) * chartHeight;
  const points = (field) => usable
    .map((row, index) => Number.isFinite(row[field]) ? `${x(index).toFixed(1)},${y(row[field]).toFixed(1)}` : null)
    .filter(Boolean)
    .join(" ");
  const yTicks = [];
  for (let value = yMin; value <= yMax; value += tickStep) {
    yTicks.push(`<line class="trend-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}"></line><text class="trend-y-label" x="${pad.left - 10}" y="${y(value) + 4}" text-anchor="end">${escapeHtml(fmt(value))}</text>`);
  }
  const xLabelIndexes = usable.length <= 10
    ? usable.map((_, index) => index)
    : [...new Set([0, Math.floor((usable.length - 1) / 2), usable.length - 1])];
  const xLabels = xLabelIndexes.map((index) => `<text class="trend-x-label" x="${x(index)}" y="${height - 10}" text-anchor="middle">${escapeHtml(usable[index].label ?? shortDate(usable[index].date))}</text>`).join("");
  const dateHoverGroups = usable.map((row, index) => {
    const pointX = x(index);
    const pointsForDate = [
      Number.isFinite(row.ev) ? { field: "ev", label: "EV registrations", value: row.ev, pointY: y(row.ev) } : null,
      Number.isFinite(row.ice) ? { field: "ice", label: "ICE registrations", value: row.ice, pointY: y(row.ice) } : null,
      Number.isFinite(row.total) ? { field: "total", label: "Total registrations", value: row.total, pointY: y(row.total) } : null,
    ].filter((point) => point && visibleFields.includes(point.field));
    if (!pointsForDate.length) return "";

    const tooltipWidth = 146;
    const tooltipHeight = 38;
    const shouldCombine = pointsForDate.length > 1
      && Math.abs(pointsForDate[0].pointY - pointsForDate[1].pointY) < tooltipHeight + 10;
    const tooltipX = Math.min(width - tooltipWidth - 8, Math.max(8, pointX - tooltipWidth / 2));
    const guideTop = Math.max(pad.top, Math.min(...pointsForDate.map((point) => point.pointY)) - 10);
    const guideBottom = Math.min(pad.top + chartHeight, Math.max(...pointsForDate.map((point) => point.pointY)) + 10);
    const pointMarkup = pointsForDate.map((point) => {
      const valueLabel = `${point.label}: ${fmt(point.value)}`;
      return `<g class="trend-point-group ${point.field}" tabindex="0" role="img" aria-label="${escapeHtml(shortDate(row.date))}, ${escapeHtml(valueLabel)}"><title>${escapeHtml(shortDate(row.date))}: ${escapeHtml(valueLabel)}</title><circle class="trend-point" cx="${pointX}" cy="${point.pointY}" r="5"></circle></g>`;
    }).join("");
    const tooltipMarkup = shouldCombine
      ? `<g class="trend-point-tooltip combined" pointer-events="none"><rect x="${tooltipX}" y="${Math.max(6, guideTop - 62)}" width="${tooltipWidth}" height="62" rx="7"></rect><text class="trend-point-tooltip-date" x="${tooltipX + 10}" y="${Math.max(6, guideTop - 62) + 15}">${escapeHtml(shortDate(row.date))}</text>${pointsForDate.map((point, pointIndex) => `<text class="trend-point-tooltip-value" x="${tooltipX + 10}" y="${Math.max(6, guideTop - 62) + 31 + pointIndex * 16}">${escapeHtml(`${point.label}: ${fmt(point.value)}`)}</text>`).join("")}</g>`
      : pointsForDate.map((point) => {
        const tooltipY = Math.max(6, point.pointY - tooltipHeight - 14);
        const valueLabel = `${point.label}: ${fmt(point.value)}`;
        return `<g class="trend-point-tooltip ${point.field}" pointer-events="none"><rect x="${tooltipX}" y="${tooltipY}" width="${tooltipWidth}" height="${tooltipHeight}" rx="7"></rect><text class="trend-point-tooltip-date" x="${tooltipX + 10}" y="${tooltipY + 15}">${escapeHtml(shortDate(row.date))}</text><text class="trend-point-tooltip-value" x="${tooltipX + 10}" y="${tooltipY + 31}">${escapeHtml(valueLabel)}</text></g>`;
      }).join("");
    return `<g class="trend-date-group" tabindex="-1"><rect class="trend-date-hit" x="${Math.max(pad.left, pointX - 14)}" y="${pad.top}" width="${Math.min(28, width - pad.right - Math.max(pad.left, pointX - 14))}" height="${chartHeight}"></rect><line class="trend-hover-guide" x1="${pointX}" x2="${pointX}" y1="${guideTop}" y2="${guideBottom}"></line>${pointMarkup}${tooltipMarkup}</g>`;
  }).join("");
  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`${focus ? `${focus === "ev" ? "EV" : focus === "ice" ? "ICE" : "Total"} registrations focused` : "EV, ICE, and total registrations"} trend`)}">
      <rect class="trend-chart-bg" x="${pad.left}" y="${pad.top}" width="${chartWidth}" height="${chartHeight}" rx="8"></rect>
      ${yTicks.join("")}
      <line class="trend-axis" x1="${pad.left}" x2="${pad.left}" y1="${pad.top}" y2="${pad.top + chartHeight}"></line>
      <line class="trend-axis" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + chartHeight}" y2="${pad.top + chartHeight}"></line>
      ${fields.map((field) => `<polyline class="trend-${field}${focus && focus !== field ? " is-dimmed" : ""}" points="${points(field)}" data-trend-focus="${field}" tabindex="0" role="button" aria-label="Focus ${field === "ev" ? "EV registrations" : field === "ice" ? "ICE registrations" : "Total registrations"}"></polyline>`).join("")}
      ${dateHoverGroups}
      ${xLabels}
    </svg>
    <div class="rto-report-legend" role="group" aria-label="Trend series focus">
      ${fields.map((field) => `<button type="button" class="${focus === field ? "active" : ""}" data-trend-focus="${field}" aria-pressed="${focus === field}"><i class="${field}"></i>${field === "ev" ? "EV registrations" : field === "ice" ? "ICE registrations" : "Total registrations"}</button>`).join("")}
      ${focus ? `<button type="button" class="trend-reset" data-trend-focus="">Show all</button>` : ""}
    </div>
  `;
}

function renderDailyOemEvidence(evidence = {}) {
  if (evidence.status !== "verified") {
    return `
      <section class="rto-report-evidence" aria-live="polite">
        <div class="rto-report-section-head">
          <div><h3>OEM distribution unavailable</h3><span>Headline Daily registration calculations remain independent of maker evidence</span></div>
          <span class="status-pill status-needs-review">Contract unverified</span>
        </div>
        <p class="result-empty">${escapeHtml(evidence.reason ?? "The monthly maker source contract is not verified for all six RTO segments.")}</p>
      </section>
    `;
  }
  const segments = (evidence.segments ?? []).filter((segment) => segment.vehicleCategory === state.oemCategory);
  return `
    <section class="rto-report-evidence">
      <div class="rto-report-section-head">
        <div><h3>Top-five OEM evidence</h3><span>Partial month-to-date evidence; Other / untracked reconciles each segment to its registration headline</span></div>
        <div class="rto-report-oem-category-filter" role="group" aria-label="OEM vehicle category">
          ${OEM_CATEGORIES.map((category) => `<button type="button" class="${state.oemCategory === category ? "active" : ""}" data-oem-category="${category}" aria-pressed="${state.oemCategory === category}">${category} OEMs</button>`).join("")}
        </div>
      </div>
      <div class="rto-report-table-wrap">
        <table class="rto-report-table">
          <thead><tr><th>Fuel</th><th>Rank</th><th>OEM</th><th>Month-to-date registrations</th><th>Evidence</th></tr></thead>
          <tbody>${segments.flatMap((segment) => [
            ...segment.topFive.map((row) => `<tr><td>${escapeHtml(segment.fuelGroup)}</td><td>#${fmt(row.rank)}</td><td>${escapeHtml(row.name)}</td><td>${fmt(row.count)}</td><td>Source top five</td></tr>`),
            `<tr><td>${escapeHtml(segment.fuelGroup)}</td><td>—</td><td>Other / untracked</td><td>${fmt(segment.otherUntracked)}</td><td>Headline minus top five</td></tr>`,
          ]).join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function delta(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null;
}

function renderEmptyDetail(
  title = "No generated RTO report is selected",
  message = "Choose an available period and RTO to open its report.",
) {
  reportDetail.innerHTML = `
    <div class="rto-report-empty">
      <span class="panel-kicker">Report detail</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderError(message) {
  console.error("RTO report source request failed.", message);
  document.body.classList.add("rto-reports-no-batch", "rto-reports-source-error");
  const readiness = document.querySelector(".rto-report-readiness");
  readiness?.classList.add("is-unavailable");
  document.querySelector("#rtoReportReadinessTitle").textContent = "Report source unavailable";
  document.querySelector("#rtoReportReadinessMetrics").innerHTML = "<span>No report data loaded</span>";
  const readinessStatus = document.querySelector("#rtoReportReadinessStatus");
  readinessStatus.textContent = "Unavailable";
  readinessStatus.className = "status-pill tracked-run-failed";
  for (const tab of document.querySelectorAll(".rto-report-tab")) {
    tab.disabled = true;
    tab.setAttribute("aria-disabled", "true");
  }
  reportDetail.innerHTML = `
    <div class="rto-report-empty rto-report-error atlas-prerequisite">
      <span class="panel-kicker">Source prerequisite</span>
      <h2>RTO reports cannot be loaded right now.</h2>
      <p>Restore database access before using readiness, cohort, or report evidence.</p>
      <a class="secondary-action" href="/rto-reports.html">Retry report source</a>
    </div>
  `;
}

function periodOption(batch) {
  if (batch.cadence === "daily") return longDate(batch.periodEnd);
  if (batch.cadence === "weekly") return `${shortDate(batch.periodStart)} - ${shortDate(batch.periodEnd)}`;
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${batch.periodEnd}T00:00:00Z`));
}

function statusLabel(value) {
  if (value === "ready_with_warnings") return "Ready with warnings";
  if (value === "needs_review") return "Needs review";
  return value ? value[0].toUpperCase() + value.slice(1) : "Unknown";
}

function shortStatus(value) {
  if (value === "ready_with_warnings") return "Warnings";
  if (value === "needs_review") return "Review";
  return "Ready";
}

function statusClass(value) {
  return value ? `status-${value.replaceAll("_", "-")}` : "";
}

function movementClass(value) {
  if (!Number.isFinite(value) || value === 0) return "";
  return value > 0 ? "movement-up" : "movement-down";
}

function changeText(change) {
  if (!change || !Number.isFinite(change.absolute)) return "No prior comparison";
  const percentText = Number.isFinite(change.percent) ? ` (${change.percent > 0 ? "+" : ""}${change.percent.toFixed(1)}%)` : "";
  return `${signed(change.absolute)}${percentText} vs previous`;
}

function signed(value) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value > 0 ? "+" : ""}${fmt(value)}`;
}

function percent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "N/A";
}

function barWidth(value, max) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, (Math.abs(value) / max) * 100)).toFixed(2) : 0;
}

function fmt(value) {
  return Number.isFinite(Number(value)) && value !== null ? new Intl.NumberFormat("en-IN").format(Number(value)) : "N/A";
}

function shortDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function longDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

document.querySelectorAll(".rto-report-tab").forEach((tab) => {
  tab.addEventListener("click", () => selectCadence(tab.dataset.cadence));
});
batchDateInput?.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  openDatePicker();
});
batchDateInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openDatePicker();
});
batchDateInput?.addEventListener("change", () => {
  const currentEvidenceDate = state.cadence === "daily" && state.readiness?.currentCycleEvidence?.length
    ? state.readiness?.run?.snapshotDate
    : null;
  if (batchDateInput.value === currentEvidenceDate) {
    selectCadence("daily");
    return;
  }
  const batch = findBatchForDate(batchDateInput.value);
  if (!batch) {
    if (state.cadence === "daily" && batchDateInput.value) {
      loadHistoricalEvidence(batchDateInput.value);
      return;
    }
    batchDateInput.setCustomValidity(`No ${state.cadence} RTO report exists for this date.`);
    batchDateInput.reportValidity();
    setPeriodInputDate(state.batch);
    return;
  }
  state.currentEvidenceMode = false;
  selectBatch(batch.id);
});

async function loadHistoricalEvidence(date) {
  const requestId = ++state.requestId;
  try {
    const readiness = await apiJson(`/api/rto-reports/evidence?date=${encodeURIComponent(date)}`);
    if (requestId !== state.requestId || state.cadence !== "daily") return;
    renderReadiness(readiness);
    activateEvidence(readiness);
  } catch (error) {
    if (requestId !== state.requestId) return;
    batchDateInput.setCustomValidity(error.message);
    batchDateInput.reportValidity();
    batchDateInput.value = activeEvidenceReadiness()?.run?.snapshotDate ?? "";
  }
}
statusFilter.addEventListener("change", loadReports);
searchInput.addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadReports, 220);
});

initSidebar();
loadInitialState();
