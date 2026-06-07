import { spawn } from "node:child_process";
import process from "node:process";

const PORT = Number(process.env.TEST_PORT || 3101);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PRIVATE_FOUR_WHEELER_CLASSES = [
  "MOTOR CAR",
  "MOTOR CARAVAN",
  "OMNI BUS (PRIVATE USE)",
  "ADAPTED VEHICLE",
  "VINTAGE MOTOR VEHICLE",
];

const checks = [
  {
    label: "single month name",
    query: "EV registrations in Maharashtra in Jan 2024",
    expect: {
      state: "Maharashtra",
      fuelSegment: "EV",
      selectedFuelTypes: ["ELECTRIC(BOV)", "PURE EV"],
      excludedFuelTypes: ["STRONG HYBRID EV", "PLUG-IN HYBRID EV"],
      from: "2024-01",
      to: "2024-01",
      minRows: 1,
    },
  },
  {
    label: "dashboard link month format",
    query: "EV registrations in Maharashtra from 2024-01 to 2024-01",
    expect: {
      state: "Maharashtra",
      fuelSegment: "EV",
      selectedFuelTypes: ["ELECTRIC(BOV)", "PURE EV"],
      from: "2024-01",
      to: "2024-01",
      minRows: 1,
    },
  },
  {
    label: "vehicle class filter",
    query: "diesel fork lift registrations in Maharashtra from Jan 2024 to Jan 2024",
    expect: {
      state: "Maharashtra",
      fuelType: "DIESEL",
      vehicleClass: "FORK LIFT",
      from: "2024-01",
      to: "2024-01",
      minRows: 1,
    },
  },
  {
    label: "fork lift class without inferred category",
    query: "fork lift registrations in Maharashtra in 2024",
    expect: {
      state: "Maharashtra",
      vehicleClass: "FORK LIFT",
      selectedVehicleCategories: [],
      excludedVehicleCategories: ["HEAVY MOTOR VEHICLE"],
      from: "2024-01",
      to: "2024-12",
      total: 294,
      minRows: 24,
    },
  },
  {
    label: "hybrid fuel semantics",
    query: "hybrid registrations in Maharashtra in Jan 2024",
    expect: {
      state: "Maharashtra",
      selectedFuelTypes: ["PETROL/HYBRID", "STRONG HYBRID EV", "PLUG-IN HYBRID EV"],
      excludedFuelTypes: ["ELECTRIC(BOV)", "PURE EV"],
      from: "2024-01",
      to: "2024-01",
      minRows: 1,
    },
  },
  {
    label: "ev cars semantic class",
    query: "EV cars in Haridwar Jan 2024",
    expect: {
      state: "Uttarakhand",
      fuelSegment: "EV",
      selectedFuelTypes: ["ELECTRIC(BOV)", "PURE EV"],
      vehicleClass: "MOTOR CAR",
      from: "2024-01",
      to: "2024-01",
    },
  },
  {
    label: "broad four wheeler private class bundle",
    query: "four wheeler in Delhi Jan 2025",
    expect: {
      state: "Delhi",
      exactVehicleClasses: PRIVATE_FOUR_WHEELER_CLASSES,
      selectedVehicleGroups: [],
      excludedVehicleCategories: ["FOUR WHEELER (Invalid Carriage)"],
      from: "2025-01",
      to: "2025-01",
    },
  },
  {
    label: "private four wheeler class bundle",
    query: "private four wheeler in Maharashtra Jan 2024",
    expect: {
      state: "Maharashtra",
      exactVehicleClasses: PRIVATE_FOUR_WHEELER_CLASSES,
      selectedVehicleGroups: [],
      excludedVehicleCategories: ["FOUR WHEELER (Invalid Carriage)"],
      from: "2024-01",
      to: "2024-01",
    },
  },
  {
    label: "electric two wheelers semantic class",
    query: "electric two wheelers in Delhi Jan 2026",
    expect: {
      state: "Delhi",
      fuelSegment: "EV",
      selectedFuelTypes: ["ELECTRIC(BOV)", "PURE EV"],
      selectedVehicleCategories: ["TWO WHEELER(NT)", "TWO WHEELER(T)"],
      selectedVehicleGroups: [],
      excludedVehicleClasses: ["M-CYCLE/SCOOTER"],
      from: "2026-01",
      to: "2026-01",
    },
  },
  {
    label: "broad three wheeler group",
    query: "three wheeler in Delhi Jan 2025",
    expect: {
      state: "Delhi",
      selectedVehicleCategories: ["THREE WHEELER(NT)", "THREE WHEELER(T)"],
      selectedVehicleGroups: [],
      excludedVehicleClasses: ["E-RICKSHAW(P)", "E-RICKSHAW WITH CART (G)", "THREE WHEELER (PASSENGER)", "THREE WHEELER (GOODS)"],
      from: "2025-01",
      to: "2025-01",
    },
  },
  {
    label: "plain e-rickshaw includes passenger and cart",
    query: "e-rickshaw in Delhi Jan 2025",
    expect: {
      state: "Delhi",
      vehicleClasses: ["E-RICKSHAW(P)", "E-RICKSHAW WITH CART (G)"],
      from: "2025-01",
      to: "2025-01",
    },
  },
  {
    label: "passenger e-rickshaw with filler words",
    query: "E-RICKSHAW that carries passenger registrations in Maharashtra in 2026",
    expect: {
      state: "Maharashtra",
      vehicleClasses: ["E-RICKSHAW(P)"],
      excludedVehicleClasses: ["E-RICKSHAW WITH CART (G)"],
      from: "2026-01",
      to: "2026-06",
    },
  },
  {
    label: "goods e-rickshaw class",
    query: "goods e-rickshaw in Delhi Jan 2025",
    expect: {
      state: "Delhi",
      vehicleClasses: ["E-RICKSHAW WITH CART (G)"],
      excludedVehicleClasses: ["E-RICKSHAW(P)"],
      from: "2025-01",
      to: "2025-01",
    },
  },
  {
    label: "three wheeler goods class",
    query: "three wheeler goods in Delhi Jan 2025",
    expect: {
      state: "Delhi",
      vehicleClasses: ["THREE WHEELER (GOODS)"],
      selectedVehicleGroups: [],
      from: "2025-01",
      to: "2025-01",
    },
  },
  {
    label: "city alias stays conservative",
    query: "Noida petrol registrations in January 2026",
    expect: {
      state: "Uttar Pradesh",
      fuelType: "PETROL",
      from: "2026-01",
      to: "2026-01",
    },
  },
  {
    label: "state name is not forced to RTO",
    query: "Delhi EV registrations in January 2026",
    expect: {
      state: "Delhi",
      fuelSegment: "EV",
      rto: null,
      from: "2026-01",
      to: "2026-01",
      minRows: 1,
    },
  },
  {
    label: "explicit RTO intent still resolves RTO",
    query: "Delhi RTO EV registrations in January 2026",
    expect: {
      state: "Delhi",
      fuelSegment: "EV",
      rtoResolved: true,
      from: "2026-01",
      to: "2026-01",
    },
  },
];

function startServer() {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: "",
      GEMINI_API_KEY: "",
      VAHAN_DISABLE_LIVE_REFRESH: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  return { child, getOutput: () => output };
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return response.json();
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error("health check timed out");
}

async function callQuery(text) {
  const response = await fetch(`${BASE_URL}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: text }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

async function callMapSummary() {
  const response = await fetch(`${BASE_URL}/api/map/summary?from=2025-12&to=2025-12`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

async function callMonthlySalesReport(params) {
  const url = new URL(`${BASE_URL}/api/reports/monthly-sales`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

async function callMonthlySalesPdf(params) {
  const url = new URL(`${BASE_URL}/api/reports/monthly-sales/pdf`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return {
    contentType: response.headers.get("content-type") ?? "",
    byteLength: (await response.arrayBuffer()).byteLength,
  };
}

async function callRtoResolve(params) {
  const url = new URL(`${BASE_URL}/api/metadata/rto-resolve`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertQuery(item, data) {
  const { expect } = item;
  assert(data.liveRefresh === null, `${item.label}: local check should not start live refresh`);
  if (expect.state) assert(data.filters.state === expect.state, `${item.label}: expected state ${expect.state}, got ${data.filters.state}`);
  if (expect.fuelSegment) assert(data.filters.fuelSegment === expect.fuelSegment, `${item.label}: expected fuel segment ${expect.fuelSegment}, got ${data.filters.fuelSegment}`);
  if (expect.fuelType) assert(data.filters.fuelType === expect.fuelType, `${item.label}: expected fuel type ${expect.fuelType}, got ${data.filters.fuelType}`);
  for (const fuelType of expect.selectedFuelTypes ?? []) {
    assert(data.filters.selectedFuelTypes?.includes(fuelType), `${item.label}: expected selected fuel ${fuelType}, got ${data.filters.selectedFuelTypes}`);
  }
  for (const fuelType of expect.excludedFuelTypes ?? []) {
    assert(!data.filters.selectedFuelTypes?.includes(fuelType), `${item.label}: did not expect selected fuel ${fuelType}`);
    assert(!data.rows.some((row) => row.fuel_type === fuelType), `${item.label}: result rows should not include ${fuelType}`);
  }
  if (expect.selectedVehicleGroups) {
    assert(JSON.stringify(data.filters.selectedVehicleGroups ?? []) === JSON.stringify(expect.selectedVehicleGroups), `${item.label}: expected vehicle groups ${expect.selectedVehicleGroups}, got ${data.filters.selectedVehicleGroups}`);
  }
  if (expect.selectedVehicleCategories) {
    assert(JSON.stringify(data.filters.selectedVehicleCategories ?? []) === JSON.stringify(expect.selectedVehicleCategories), `${item.label}: expected vehicle categories ${expect.selectedVehicleCategories}, got ${data.filters.selectedVehicleCategories}`);
  }
  for (const vehicleCategory of expect.excludedVehicleCategories ?? []) {
    assert(!data.filters.vehicleCategories?.includes(vehicleCategory), `${item.label}: did not expect vehicle category ${vehicleCategory}`);
    assert(!data.filters.selectedVehicleCategories?.includes(vehicleCategory), `${item.label}: did not expect selected vehicle category ${vehicleCategory}`);
  }
  if ("rto" in expect) assert(data.filters.rto === expect.rto, `${item.label}: expected rto ${expect.rto}, got ${data.filters.rto}`);
  if (expect.rtoResolved) assert(Boolean(data.filters.rto), `${item.label}: expected a resolved RTO`);
  if (expect.vehicleClass) assert(data.filters.vehicleClasses?.includes(expect.vehicleClass), `${item.label}: expected vehicle class ${expect.vehicleClass}`);
  if (expect.exactVehicleClasses) {
    const actual = [...(data.filters.vehicleClasses ?? [])].sort();
    const expected = [...expect.exactVehicleClasses].sort();
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${item.label}: expected exact vehicle classes ${expected}, got ${actual}`);
  }
  for (const vehicleClass of expect.vehicleClasses ?? []) {
    assert(data.filters.vehicleClasses?.includes(vehicleClass), `${item.label}: expected vehicle class ${vehicleClass}, got ${data.filters.vehicleClasses}`);
  }
  for (const vehicleClass of expect.excludedVehicleClasses ?? []) {
    assert(!data.filters.vehicleClasses?.includes(vehicleClass), `${item.label}: did not expect vehicle class ${vehicleClass}`);
  }
  if (expect.from) assert(data.filters.from === expect.from, `${item.label}: expected from ${expect.from}, got ${data.filters.from}`);
  if (expect.to) assert(data.filters.to === expect.to, `${item.label}: expected to ${expect.to}, got ${data.filters.to}`);
  if (expect.total !== undefined) assert(data.summary.total === expect.total, `${item.label}: expected total ${expect.total}, got ${data.summary.total}`);
  if (expect.minRows) assert(data.rows.length >= expect.minRows, `${item.label}: expected at least ${expect.minRows} row(s), got ${data.rows.length}`);
}

function assertMonthlyReport(label, report, expect = {}) {
  assert(report.kind === "monthly-sales", `${label}: expected monthly-sales report kind`);
  assert(report.period?.month === expect.month, `${label}: expected month ${expect.month}, got ${report.period?.month}`);
  assert(report.fuelSelection?.scope === expect.fuelScope, `${label}: expected fuel scope ${expect.fuelScope}, got ${report.fuelSelection?.scope}`);
  if (expect.fuel) assert(report.fuelSelection?.fuel === expect.fuel, `${label}: expected fuel ${expect.fuel}, got ${report.fuelSelection?.fuel}`);
  const sections = new Map((report.sections ?? []).map((section) => [section.id, section]));
  for (const id of ["overview", "fuel_mix", "category_sales", "twelve_month_trend", "share_trend", "oem_leaders"]) {
    assert(sections.has(id), `${label}: missing section ${id}`);
  }
  const overview = sections.get("overview");
  assert(overview.metrics.total >= (expect.minTotal ?? 1), `${label}: expected report total >= ${expect.minTotal ?? 1}, got ${overview.metrics.total}`);
  assert(Array.isArray(sections.get("twelve_month_trend").chartData), `${label}: expected trend chart data`);
  assert(sections.get("twelve_month_trend").chartData.length === 12, `${label}: expected 12 trend months`);
  assert(Array.isArray(sections.get("fuel_mix").chartData), `${label}: expected fuel mix chart data`);
  assert(Array.isArray(report.dataNotes) && report.dataNotes.length >= 3, `${label}: expected data notes`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 1500);
  });
}

async function main() {
  const server = startServer();
  try {
    const health = await waitForHealth();
    const queryResults = [];
    for (const item of checks) {
      const data = await callQuery(item.query);
      assertQuery(item, data);
      queryResults.push({
        label: item.label,
        status: data.dataStatus,
        rows: data.rows.length,
        total: data.summary.total,
      });
    }

    const map = await callMapSummary();
    assert(map.coverage.availableStates > 0, `map summary: expected saved states, got ${map.coverage.availableStates}`);
    assert(map.liveRefresh === null, "map summary: should not start a live refresh");

    const stateAsLocation = await callRtoResolve({
      state: "Maharashtra",
      rtoText: "Maharashtra",
      locationText: "Maharashtra State",
    });
    assert(stateAsLocation.rto === null, `state cleanup: expected no RTO, got ${stateAsLocation.rto}`);
    assert(stateAsLocation.status === "none", `state cleanup: expected no RTO resolution, got ${stateAsLocation.status}`);

    const monthlyReports = [];
    for (const item of [
      { label: "all-fuel report", params: { month: "2026-01", fuelScope: "all" }, expect: { month: "2026-01", fuelScope: "all", minTotal: 1 } },
      { label: "EV segment report", params: { month: "2026-01", fuelScope: "segment", fuel: "EV" }, expect: { month: "2026-01", fuelScope: "segment", fuel: "EV", minTotal: 1 } },
      { label: "diesel exact report", params: { month: "2026-01", fuelScope: "exact", fuel: "DIESEL" }, expect: { month: "2026-01", fuelScope: "exact", fuel: "DIESEL", minTotal: 1 } },
      { label: "petrol exact report", params: { month: "2026-01", fuelScope: "exact", fuel: "PETROL" }, expect: { month: "2026-01", fuelScope: "exact", fuel: "PETROL", minTotal: 1 } },
      { label: "hybrid segment report", params: { month: "2026-01", fuelScope: "segment", fuel: "HYBRID" }, expect: { month: "2026-01", fuelScope: "segment", fuel: "HYBRID", minTotal: 1 } },
    ]) {
      const report = await callMonthlySalesReport(item.params);
      assertMonthlyReport(item.label, report, item.expect);
      monthlyReports.push({
        label: item.label,
        total: report.sections.find((section) => section.id === "overview")?.metrics?.total ?? 0,
        oemRows: report.coverage.makerRows,
      });
    }

    const monthlyPdf = await callMonthlySalesPdf({ month: "2026-01", fuelScope: "all" });
    assert(/application\/pdf/i.test(monthlyPdf.contentType), `monthly report PDF: expected application/pdf, got ${monthlyPdf.contentType}`);
    assert(monthlyPdf.byteLength > 1000, `monthly report PDF: expected non-empty PDF, got ${monthlyPdf.byteLength} bytes`);

    console.log(JSON.stringify({
      health,
      queries: queryResults,
      map: {
        availableStates: map.coverage.availableStates,
        rowCount: map.coverage.rowCount,
        latestMonth: map.coverage.latestMonth,
      },
      monthlyReports,
      monthlyPdf,
      stateAsLocation,
    }, null, 2));
  } finally {
    await stopServer(server.child);
    const output = server.getOutput();
    if (process.exitCode && output) console.error(output);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
