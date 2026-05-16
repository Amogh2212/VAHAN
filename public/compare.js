const fmt = new Intl.NumberFormat("en-IN");

const modeHelp = document.querySelector("#modeHelp");
const compareHint = document.querySelector("#compareHint");
const compareForm = document.querySelector("#compareForm");
const compareBtn = document.querySelector("#compareBtn");
const leftQuery = document.querySelector("#leftQuery");
const rightQuery = document.querySelector("#rightQuery");
const monthModeBtn = document.querySelector("#monthMode");
const locationModeBtn = document.querySelector("#locationMode");
const deltaSummary = document.querySelector("#deltaSummary");
const leftResultMeta = document.querySelector("#leftResultMeta");
const rightResultMeta = document.querySelector("#rightResultMeta");
const doubleBarChart = document.querySelector("#doubleBarChart");

const modeConfig = {
  month: {
    help: "Use the same state or RTO in both queries and change only the month or date range.",
    hint: "Example: compare EV registrations in Maharashtra for Jan 2024 and Feb 2024.",
    left: "EV registrations in Maharashtra from Jan 2024 to Jan 2024",
    right: "EV registrations in Maharashtra from Feb 2024 to Feb 2024",
  },
  location: {
    help: "Use two different states or RTOs for the same month, so the location difference is obvious.",
    hint: "Example: compare EV registrations in Gujarat and Karnataka for Jan 2024.",
    left: "EV registrations in Gujarat from Jan 2024 to Jan 2024",
    right: "EV registrations in Karnataka from Jan 2024 to Jan 2024",
  },
};

let currentMode = "month";
let leftDirty = false;
let rightDirty = false;

function setText(id, value) {
  const el = document.querySelector(`#${id}`);
  if (el) el.textContent = value;
}

function extractBracketMeta(query) {
  const match = query.match(/in\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+)/i);
  if (!match) return "";
  const [, location, from, to] = match;
  return ` [${location.trim()} | ${from.trim()} - ${to.trim()}]`;
}

function setMode(nextMode) {
  currentMode = nextMode;
  monthModeBtn.classList.toggle("active", nextMode === "month");
  locationModeBtn.classList.toggle("active", nextMode === "location");
  monthModeBtn.setAttribute("aria-pressed", String(nextMode === "month"));
  locationModeBtn.setAttribute("aria-pressed", String(nextMode === "location"));
  modeHelp.textContent = modeConfig[nextMode].help;
  compareHint.textContent = modeConfig[nextMode].hint;
  if (!leftDirty) leftQuery.value = modeConfig[nextMode].left;
  if (!rightDirty) rightQuery.value = modeConfig[nextMode].right;
}

function formatChange(value) {
  if (value === null) return "n/a";
  return `${value > 0 ? "+" : ""}${fmt.format(value)}`;
}

function formatPct(value) {
  if (value === null) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function renderBars(target, items, emptyText) {
  const el = document.querySelector(target);
  if (!items.length) {
    el.innerHTML = `<p class="compare-empty">${emptyText}</p>`;
    return;
  }
  const max = Math.max(1, ...items.map((item) => item.count));
  el.innerHTML = items
    .map(
      (item) => `
        <div class="bar">
          <span>${item.month ?? item.fuelType}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(item.count / max) * 100}%"></span></span>
          <strong>${fmt.format(item.count)}</strong>
        </div>
      `,
    )
    .join("");
}

function renderFuel(target, items, emptyText) {
  const el = document.querySelector(target);
  if (!items.length) {
    el.innerHTML = `<p class="compare-empty">${emptyText}</p>`;
    return;
  }
  el.innerHTML = items
    .map(
      (item) => `
        <div class="fuel-item">
          <span>${item.fuelType}</span>
          <strong>${fmt.format(item.count)}</strong>
        </div>
      `,
    )
    .join("");
}

function renderDoubleBars(leftData, rightData) {
  const leftTrend = new Map(leftData.trend.map((item) => [item.month, item.count]));
  const rightTrend = new Map(rightData.trend.map((item) => [item.month, item.count]));
  const months = [...new Set([...leftTrend.keys(), ...rightTrend.keys()])].sort((a, b) => a.localeCompare(b));

  if (!months.length) {
    doubleBarChart.innerHTML = '<p class="compare-empty">No monthly comparison data is available for these queries.</p>';
    return;
  }

  const max = Math.max(
    1,
    ...months.flatMap((month) => [leftTrend.get(month) ?? 0, rightTrend.get(month) ?? 0]),
  );

  doubleBarChart.innerHTML = `
    <div class="double-bar-legend">
      <span><i class="legend-swatch left"></i>Left query</span>
      <span><i class="legend-swatch right"></i>Right query</span>
    </div>
    <div class="double-bar-list">
      ${months
        .map((month) => {
          const leftCount = leftTrend.get(month) ?? 0;
          const rightCount = rightTrend.get(month) ?? 0;
          const leftWidth = (leftCount / max) * 100;
          const rightWidth = (rightCount / max) * 100;

          return `
            <div class="double-bar-row">
              <div class="double-bar-label">${month}</div>
              <div class="double-bar-pair">
                <div class="double-bar-track">
                  <span class="double-bar-fill left" style="width:${leftWidth}%"></span>
                </div>
                <strong>${fmt.format(leftCount)}</strong>
              </div>
              <div class="double-bar-pair">
                <div class="double-bar-track">
                  <span class="double-bar-fill right" style="width:${rightWidth}%"></span>
                </div>
                <strong>${fmt.format(rightCount)}</strong>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSide(prefix, query, data, status = "Ready") {
  setText(`${prefix}Status`, status);
  setText(`${prefix}QueryLabel`, `${query}${extractBracketMeta(query)}`);
  setText(`${prefix}ResultMeta`, extractBracketMeta(query));
  setText(`${prefix}Total`, fmt.format(data.summary.total));
  setText(`${prefix}Average`, fmt.format(data.summary.monthlyAverage));
  setText(`${prefix}Peak`, data.summary.peakMonth ? `${data.summary.peakMonth}` : "-");
  setText(`${prefix}Rows`, fmt.format(data.rows.length));
  renderBars(`#${prefix}Trend`, data.trend, "No monthly trend for this query.");
  renderFuel(`#${prefix}Fuel`, data.fuelBreakdown, "No fuel breakdown for this query.");
}

async function fetchQuery(query) {
  const response = await fetch("/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    throw new Error(`Query failed: ${response.status}`);
  }
  return response.json();
}

function computeDelta(left, right) {
  const diff = right.summary.total - left.summary.total;
  const pct = left.summary.total === 0
    ? null
    : ((diff / left.summary.total) * 100);
  return { diff, pct };
}

async function runCompare(event) {
  event.preventDefault();
  compareBtn.disabled = true;
  compareBtn.textContent = "Comparing...";
  deltaSummary.textContent = "Loading both queries...";
  doubleBarChart.innerHTML = '<p class="compare-empty">Building comparison chart...</p>';

  const left = leftQuery.value.trim();
  const right = rightQuery.value.trim();

  try {
    const [leftData, rightData] = await Promise.all([fetchQuery(left), fetchQuery(right)]);
    renderSide("left", left, leftData, "Loaded");
    renderSide("right", right, rightData, "Loaded");
    renderDoubleBars(leftData, rightData);

    const { diff, pct } = computeDelta(leftData, rightData);
    deltaSummary.innerHTML = `
      <div><strong>Difference:</strong> ${formatChange(diff)} registrations</div>
      <div><strong>Change:</strong> ${formatPct(pct)}</div>
      <div><strong>Left:</strong> ${fmt.format(leftData.summary.total)} total</div>
      <div><strong>Right:</strong> ${fmt.format(rightData.summary.total)} total</div>
    `;
  } catch (error) {
    deltaSummary.textContent = error.message;
    doubleBarChart.innerHTML = `<p class="compare-empty">${error.message}</p>`;
    setText("leftStatus", "Error");
    setText("rightStatus", "Error");
  } finally {
    compareBtn.disabled = false;
    compareBtn.textContent = "Compare";
  }
}

monthModeBtn.addEventListener("click", () => setMode("month"));
locationModeBtn.addEventListener("click", () => setMode("location"));
leftQuery.addEventListener("input", () => {
  leftDirty = true;
});
rightQuery.addEventListener("input", () => {
  rightDirty = true;
});
compareForm.addEventListener("submit", runCompare);

setMode("month");
runCompare(new Event("submit"));
