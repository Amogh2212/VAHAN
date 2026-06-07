const form = document.querySelector("#monthlyReportForm");
const reportMonth = document.querySelector("#reportMonth");
const fuelScope = document.querySelector("#fuelScope");
const reportFuel = document.querySelector("#reportFuel");
const loadReportBtn = document.querySelector("#loadReportBtn");
const output = document.querySelector("#monthlyReport");
const warnings = document.querySelector("#reportWarnings");
const pdfLink = document.querySelector("#downloadReportPdf");
const appFrame = document.querySelector(".app-frame");
const sidebarTrigger = document.querySelector("#sidebarTrigger");
const featureSidebar = document.querySelector("#featureSidebar");

const fmt = new Intl.NumberFormat("en-IN");
const monthFmt = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function displayMonth(value) {
  const [year, month] = String(value).split("-").map(Number);
  if (!year || !month) return value ?? "";
  return monthFmt.format(new Date(year, month - 1, 1));
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "NA";
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(Number(value) * 100)}%`;
}

function formatDelta(value) {
  const number = Math.round(Number(value) || 0);
  return `${number > 0 ? "+" : ""}${fmt.format(number)}`;
}

function queryParams() {
  const params = new URLSearchParams();
  if (reportMonth.value) params.set("month", reportMonth.value);
  params.set("fuelScope", fuelScope.value || "all");
  if (fuelScope.value !== "all" && reportFuel.value.trim()) {
    params.set("fuel", reportFuel.value.trim());
  }
  return params;
}

function setWarnings(items = []) {
  const uniqueItems = [...new Set(items.filter(Boolean))].slice(0, 8);
  warnings.hidden = !uniqueItems.length;
  warnings.innerHTML = uniqueItems
    .map((item) => `<div class="warning-toast"><span>${escapeHtml(item)}</span></div>`)
    .join("");
}

function renderMetricGrid(metrics = {}) {
  return `
    <div class="monthly-report-metrics">
      <article><span>Total</span><strong>${fmt.format(metrics.total ?? 0)}</strong></article>
      <article><span>Previous month</span><strong>${fmt.format(metrics.previousTotal ?? 0)}</strong></article>
      <article><span>Change</span><strong>${formatDelta(metrics.delta ?? 0)}</strong></article>
      <article><span>Market share</span><strong>${formatPercent(metrics.marketShare)}</strong></article>
    </div>
  `;
}

function renderBars(items = [], labelKey = "label") {
  if (!items.length) return `<p class="result-empty">No data available for this section.</p>`;
  const max = Math.max(1, ...items.map((item) => Number(item.count ?? item.currentCount ?? 0)));
  return `
    <div class="monthly-report-bars">
      ${items.slice(0, 14).map((item) => {
        const label = item[labelKey] ?? item.fuelType ?? item.title ?? item.month ?? item.maker ?? "Item";
        const count = Number(item.count ?? item.currentCount ?? 0);
        return `
          <div class="monthly-report-bar">
            <span>${escapeHtml(labelKey === "month" ? displayMonth(label) : label)}</span>
            <i><b style="width:${Math.max(2, (count / max) * 100)}%"></b></i>
            <strong>${fmt.format(count)}</strong>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderShareRows(items = []) {
  if (!items.length) return `<p class="result-empty">No share data available.</p>`;
  return `
    <div class="monthly-report-table-wrap">
      <table class="monthly-report-table">
        <thead><tr><th>Label</th><th>Current share</th><th>Current count</th></tr></thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${escapeHtml(item.label)}</td>
              <td>${formatPercent(item.currentShare)}</td>
              <td>${fmt.format(item.currentCount ?? 0)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSection(section) {
  let body = "";
  if (section.id === "overview") {
    body = renderMetricGrid(section.metrics);
  } else if (section.id === "twelve_month_trend") {
    body = renderBars(section.chartData, "month");
  } else if (section.id === "share_trend") {
    body = renderShareRows(section.chartData);
  } else if (section.id === "oem_leaders") {
    body = renderBars(section.chartData, "maker");
  } else {
    body = renderBars(section.chartData, section.id === "fuel_mix" ? "fuelType" : "title");
  }

  const sectionWarnings = section.warnings?.length
    ? `<div class="monthly-report-section-warning">${section.warnings.map(escapeHtml).join("<br>")}</div>`
    : "";

  return `
    <article class="panel monthly-report-section" id="section-${escapeHtml(section.id)}">
      <div class="panel-head">
        <div>
          <p class="eyebrow">${escapeHtml(section.chartType ?? "section")}</p>
          <h2>${escapeHtml(section.title)}</h2>
        </div>
      </div>
      <p class="monthly-report-narrative">${escapeHtml(section.narrative ?? "")}</p>
      ${body}
      ${sectionWarnings}
    </article>
  `;
}

function renderReport(report) {
  reportMonth.value = report.period.month;
  const params = queryParams();
  pdfLink.href = `/api/reports/monthly-sales/pdf?${params.toString()}`;
  pdfLink.removeAttribute("aria-disabled");

  output.innerHTML = `
    <section class="monthly-report-hero panel">
      <div>
        <p class="eyebrow">Generated report</p>
        <h1>${escapeHtml(report.title)}</h1>
        <p>${escapeHtml(report.source.label)}. Latest loaded month: ${escapeHtml(report.source.latestLoadedMonth ?? "not available")}.</p>
      </div>
      <div class="monthly-report-coverage">
        <span>${fmt.format(report.coverage.states)} states</span>
        <span>${fmt.format(report.coverage.currentScopeRows)} matching rows</span>
        <span>${fmt.format(report.coverage.categorySectionsAvailable)} / ${fmt.format(report.coverage.categorySectionsTotal)} segment sections</span>
      </div>
    </section>
    ${report.sections.map(renderSection).join("")}
    <section class="panel monthly-report-section">
      <div class="panel-head"><h2>Data notes</h2></div>
      <ul class="monthly-report-notes">
        ${report.dataNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
      </ul>
    </section>
  `;

  setWarnings(report.sections.flatMap((section) => section.warnings ?? []));
}

async function loadReport() {
  const params = queryParams();
  output.innerHTML = `<p class="result-empty">Generating monthly report...</p>`;
  setWarnings([]);
  loadReportBtn.disabled = true;
  loadReportBtn.textContent = "Generating...";
  try {
    const response = await fetch(`/api/reports/monthly-sales?${params.toString()}`);
    const report = await response.json();
    if (!response.ok) throw new Error(report.error ?? `Report failed: ${response.status}`);
    renderReport(report);
  } catch (error) {
    output.innerHTML = `<p class="result-empty">${escapeHtml(error.message)}</p>`;
    pdfLink.href = "#";
    pdfLink.setAttribute("aria-disabled", "true");
  } finally {
    loadReportBtn.disabled = false;
    loadReportBtn.textContent = "Generate report";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadReport();
});

fuelScope.addEventListener("change", () => {
  const needsFuel = fuelScope.value !== "all";
  reportFuel.disabled = !needsFuel;
  if (!needsFuel) reportFuel.value = "";
});

if (appFrame && sidebarTrigger && featureSidebar) {
  let closeSidebarTimer = null;
  const openSidebar = () => {
    clearTimeout(closeSidebarTimer);
    appFrame.classList.add("sidebar-open");
    sidebarTrigger.setAttribute("aria-expanded", "true");
  };
  const closeSidebar = () => {
    closeSidebarTimer = setTimeout(() => {
      if (sidebarTrigger.matches(":hover, :focus-visible") || featureSidebar.matches(":hover") || featureSidebar.contains(document.activeElement)) return;
      appFrame.classList.remove("sidebar-open");
      sidebarTrigger.setAttribute("aria-expanded", "false");
    }, 120);
  };
  sidebarTrigger.setAttribute("aria-haspopup", "true");
  sidebarTrigger.setAttribute("aria-expanded", "false");
  sidebarTrigger.addEventListener("mouseenter", openSidebar);
  sidebarTrigger.addEventListener("focus", openSidebar);
  sidebarTrigger.addEventListener("mouseleave", closeSidebar);
  sidebarTrigger.addEventListener("blur", closeSidebar);
  featureSidebar.addEventListener("mouseenter", openSidebar);
  featureSidebar.addEventListener("mouseleave", closeSidebar);
}

fuelScope.dispatchEvent(new Event("change"));
loadReport();
