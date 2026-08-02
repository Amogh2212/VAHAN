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
};

const CATEGORY_OEMS = Object.freeze({
  "2W": ["Hero MotoCorp", "Honda Motorcycle", "TVS Motor (2W)", "Bajaj Auto (2W)", "Suzuki Motorcycle"],
  "3W": ["Bajaj Auto (3W)", "Mahindra Last Mile Mobility", "TVS Motor (3W)", "Piaggio Vehicles", "Atul Auto"],
  "4W": ["Maruti Suzuki", "Tata Motors", "Mahindra & Mahindra", "Hyundai Motor India", "JSW MG Motor India"],
});

const batchDateInput = document.querySelector("#rtoReportBatchDate");
const periodStatus = document.querySelector("#rtoReportPeriodStatus");
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
  if (readiness.eligible) {
    title.textContent = `${readiness.run?.snapshotDate ?? "Current cycle"} ready for reporting`;
    status.textContent = "100 / 100";
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

function selectCadence(cadence) {
  state.cadence = cadence;
  for (const tab of document.querySelectorAll(".rto-report-tab")) {
    const active = tab.dataset.cadence === cadence;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  const matching = batchesForCadence(cadence);
  renderPeriodPicker(matching);
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
        : "Reports appear after all six EV/ICE and 2W/3W/4W queries are complete for every frozen RTO. Each query retains 15 tracked OEMs: 90 OEM rows per RTO and 9,000 per top-100 cycle.",
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
  if (!state.batch) return;
  reportList.innerHTML = `<p class="result-empty">Loading ${escapeHtml(state.cadence)} reports.</p>`;
  const params = new URLSearchParams({ limit: "100" });
  const q = searchInput.value.trim();
  const status = statusFilter.value;
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  try {
    const body = await apiJson(`/api/rto-reports/batches/${state.batch.id}/reports?${params}`);
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
    renderError(error.message);
  }
}

function renderBatch() {
  const strip = document.querySelector("#rtoReportBatchStrip");
  const download = document.querySelector("#rtoReportBatchCsv");
  document.body.classList.toggle("rto-reports-no-batch", !state.batch);
  if (!state.batch) {
    strip.hidden = true;
    download.hidden = true;
    document.querySelector("#rtoReportListMeta").textContent = "No generated batch";
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
  try {
    const [body, draftsBody] = await Promise.all([
      apiJson(`/api/rto-reports/${reportId}`),
      state.currentUser?.role === "admin"
        ? apiJson(`/api/admin/rto-factor-explanations?reportId=${encodeURIComponent(reportId)}&status=draft`)
        : Promise.resolve({ explanations: [] }),
    ]);
    state.report = body.report;
    state.draftExplanations = draftsBody.explanations ?? [];
    renderReportList();
    renderReportDetail(state.report);
  } catch (error) {
    renderError(error.message);
  }
}

function renderReportDetail(report) {
  const payload = report.payload ?? {};
  const metrics = payload.metrics ?? {};
  const categories = payload.categories ?? [];
  const oems = payload.oems ?? [];
  const selectedOemRows = oemRowsForCategory(oems, state.oemCategory);
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
      ${metricBlock("EV registrations", registrationMetricValue(metrics.period?.ev, metrics.mtd?.ev), registrationComparison(metrics.period?.ev, metrics.mtd?.ev, metrics.change?.ev))}
      ${metricBlock("ICE registrations", registrationMetricValue(metrics.period?.ice, metrics.mtd?.ice), registrationComparison(metrics.period?.ice, metrics.mtd?.ice, metrics.change?.ice))}
      ${metricBlock("EV share", registrationMetricValue(percent(metrics.period?.evShare), percent(metrics.mtd?.evShare)), evShareComparison(metrics.period?.evShare, metrics.mtd?.evShare))}
      ${metricBlock("Daily EV rank", payload.rto?.cohortRank ? `#${payload.rto.cohortRank}` : "N/A", payload.rto?.previousRank ? `Previous #${payload.rto.previousRank}` : "No prior rank")}
    </section>

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
        <div><h3>Daily registrations</h3><span>EV and ICE period additions</span></div>
      </div>
      <div class="rto-report-trend">${trendSvg(payload.trend ?? [])}</div>
    </section>

    <section class="rto-report-evidence">
      <div class="rto-report-section-head">
        <div><h3>Vehicle categories</h3><span>2W, 3W, and 4W contribution</span></div>
      </div>
      <div class="rto-report-category-bars">${categoryBars(categories)}</div>
    </section>

    <section class="rto-report-evidence">
      <div class="rto-report-section-head">
        <div><h3>OEM performance</h3><span>The five tracked ${state.oemCategory} OEMs only</span></div>
        <div class="rto-report-oem-category-filter" role="group" aria-label="OEM vehicle category">
          ${Object.keys(CATEGORY_OEMS).map((category) => `<button type="button" class="${state.oemCategory === category ? "active" : ""}" data-oem-category="${category}" aria-pressed="${state.oemCategory === category}">${category} OEMs</button>`).join("")}
        </div>
      </div>
      <div class="rto-report-table-wrap">
        <table class="rto-report-table">
          <thead><tr><th>OEM</th><th>EV</th><th>ICE</th><th>Total</th><th>Previous</th><th>Change</th></tr></thead>
          <tbody>${selectedOemRows.length ? selectedOemRows.map((row) => `
            <tr>
              <td>${escapeHtml(row.oem)}</td>
              <td>${fmt(row.period?.ev)}</td>
              <td>${fmt(row.period?.ice)}</td>
              <td>${fmt(row.period?.total)}</td>
              <td>${fmt(row.previousPeriod?.total)}</td>
              <td class="${movementClass(row.change?.total?.absolute)}">${signed(row.change?.total?.absolute)}</td>
            </tr>
          `).join("") : `<tr><td colspan="6" class="result-empty">No OEM activity is available for ${escapeHtml(state.oemCategory)} in this period.</td></tr>`}</tbody>
        </table>
      </div>
    </section>

    <footer class="rto-report-source">
      <span>Totals: rto_daily_scrape_reports.report_total</span>
      <span>OEMs: rto_daily_snapshots.vehicle_count</span>
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
      <p>${escapeHtml(context.message ?? "Reviewed context is temporarily unavailable. Registration facts remain available.")}</p>
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
    note = window.prompt("Review reason (required):", "")?.trim() ?? "";
    if (!note) {
      window.alert("A review reason is required.");
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
    window.alert(error.message);
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

function reportEvLabel(report) {
  if (report.periodEv === null && Number.isFinite(report.mtdEv)) return `EV MTD ${fmt(report.mtdEv)}`;
  return `EV ${fmt(report.periodEv)}`;
}

function registrationMetricValue(periodValue, mtdValue) {
  if (isUnavailableDisplayValue(periodValue) && !isUnavailableDisplayValue(mtdValue)) return mtdValue;
  return periodValue;
}

function registrationComparison(periodValue, mtdValue, change) {
  if (isUnavailableDisplayValue(periodValue) && !isUnavailableDisplayValue(mtdValue)) {
    return `Fetched MTD; daily N/A`;
  }
  return changeText(change);
}

function evShareComparison(periodValue, mtdValue) {
  if (isUnavailableDisplayValue(periodValue) && !isUnavailableDisplayValue(mtdValue)) {
    return "Fetched MTD; daily N/A";
  }
  return `MTD ${percent(mtdValue)}`;
}

function isUnavailableDisplayValue(value) {
  return value === null || value === undefined || value === "N/A";
}

function oemRowsForCategory(oems, category) {
  const byOem = new Map(oems.map((oem) => [oem.oem, oem]));
  return (CATEGORY_OEMS[category] ?? []).map((oem) => {
    const source = byOem.get(oem);
    return {
      oem,
      ...(source?.categories?.find((item) => item.vehicleCategory === category) ?? {
        period: {},
        previousPeriod: {},
        change: {},
      }),
    };
  });
}

function categoryBars(categories) {
  return categories.map((row) => {
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

function trendSvg(rows) {
  const usable = rows.filter((row) => Number.isFinite(row.ev) || Number.isFinite(row.ice));
  if (usable.length < 2) return `<p class="result-empty">Not enough comparable dates.</p>`;
  const width = 760;
  const height = 268;
  const pad = { top: 22, right: 24, bottom: 42, left: 48 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const values = usable.flatMap((row) => [row.ev, row.ice]).filter(Number.isFinite);
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
  const xLabels = xLabelIndexes.map((index) => `<text class="trend-x-label" x="${x(index)}" y="${height - 10}" text-anchor="middle">${escapeHtml(shortDate(usable[index].date))}</text>`).join("");
  const dateHoverGroups = usable.map((row, index) => {
    const pointX = x(index);
    const pointsForDate = [
      Number.isFinite(row.ev) ? { field: "ev", label: "EV", value: row.ev, pointY: y(row.ev) } : null,
      Number.isFinite(row.ice) ? { field: "ice", label: "ICE", value: row.ice, pointY: y(row.ice) } : null,
    ].filter(Boolean);
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
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily EV and ICE registration trend">
      <rect class="trend-chart-bg" x="${pad.left}" y="${pad.top}" width="${chartWidth}" height="${chartHeight}" rx="8"></rect>
      ${yTicks.join("")}
      <line class="trend-axis" x1="${pad.left}" x2="${pad.left}" y1="${pad.top}" y2="${pad.top + chartHeight}"></line>
      <line class="trend-axis" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + chartHeight}" y2="${pad.top + chartHeight}"></line>
      <polyline class="trend-ev" points="${points("ev")}"></polyline>
      <polyline class="trend-ice" points="${points("ice")}"></polyline>
      ${dateHoverGroups}
      ${xLabels}
    </svg>
    <div class="rto-report-legend"><span><i class="ev"></i>EV</span><span><i class="ice"></i>ICE</span></div>
  `;
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
  const batch = findBatchForDate(batchDateInput.value);
  if (!batch) {
    batchDateInput.setCustomValidity(`No ${state.cadence} RTO report exists for this date.`);
    batchDateInput.reportValidity();
    setPeriodInputDate(state.batch);
    return;
  }
  selectBatch(batch.id);
});
statusFilter.addEventListener("change", loadReports);
searchInput.addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadReports, 220);
});

initSidebar();
loadInitialState();
