import { spawn } from "node:child_process";
import process from "node:process";

const PORT = Number(process.env.TEST_PORT || 3101);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FOUR_WHEELER_SIDE_FILTERS = ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"];

const checks = [
  {
    label: "shared-year month range",
    query: "EV registrations in Maharashtra from Jan to Mar 2024",
    expect: { state: "Maharashtra", fuelSegment: "EV", from: "2024-01", to: "2024-03", minRows: 1 },
  },
  {
    label: "calendar quarter",
    query: "EV registrations in Maharashtra in Q4 2024",
    expect: { state: "Maharashtra", fuelSegment: "EV", from: "2024-10", to: "2024-12", minRows: 1 },
  },
  {
    label: "Indian fiscal year",
    query: "EV registrations in Maharashtra in FY 2023-24",
    expect: { state: "Maharashtra", fuelSegment: "EV", from: "2023-04", to: "2024-03", minRows: 1 },
  },
  {
    label: "relative previous month",
    query: "EV registrations in Maharashtra last month",
    expect: { state: "Maharashtra", fuelSegment: "EV", from: "2026-05", to: "2026-05", minRows: 1 },
  },
  {
    label: "relative last three months",
    query: "EV registrations in Maharashtra for the last 3 months",
    expect: { state: "Maharashtra", fuelSegment: "EV", from: "2026-04", to: "2026-06", minRows: 1 },
  },
  {
    label: "explicit compact RTO code",
    query: "EV registrations at RTO UP16 in Jan 2026",
    expect: { state: "Uttar Pradesh", fuelSegment: "EV", rtoResolved: true, rtoIncludes: "UP16", from: "2026-01", to: "2026-01" },
  },
  {
    label: "uncatalogued explicit RTO code does not broaden to state totals",
    query: "Show vehicle registrations at DL-01 RTO during February 2025",
    expect: { state: "Delhi", rto: null, rtoSearch: "DL-01", from: "2025-02", to: "2025-02", total: 0 },
  },
  {
    label: "non-EV negation excludes battery electric fuels",
    query: "non-EV registrations in Maharashtra in Jan 2024",
    expect: {
      state: "Maharashtra",
      fuelSegment: "NON_EV",
      appliedExcludedFuelTypes: ["ELECTRIC(BOV)", "PURE EV"],
      from: "2024-01",
      to: "2024-01",
      minRows: 1,
    },
  },
  {
    label: "excluding diesel applies an exclusion",
    query: "vehicle registrations excluding diesel in Maharashtra in Jan 2024",
    expect: {
      state: "Maharashtra",
      appliedExcludedFuelTypes: ["DIESEL"],
      from: "2024-01",
      to: "2024-01",
      minRows: 1,
    },
  },
  {
    label: "EV excluding hybrids keeps battery electric and excludes hybrids",
    query: "EV registrations excluding hybrids in Maharashtra in Jan 2024",
    expect: {
      state: "Maharashtra",
      fuelSegment: "EV",
      selectedFuelTypes: ["ELECTRIC(BOV)", "PURE EV"],
      appliedExcludedFuelTypes: ["STRONG HYBRID EV", "PLUG-IN HYBRID EV"],
      from: "2024-01",
      to: "2024-01",
      minRows: 1,
    },
  },
  {
    label: "except buses subtracts the bus vehicle-class context",
    query: "all vehicle registrations except buses in Haryana in Jan 2026",
    expect: {
      state: "Haryana",
      appliedExcludedVehicleClasses: ["BUS"],
      from: "2026-01",
      to: "2026-01",
      total: 103628,
      minRows: 1,
    },
  },
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
    label: "misspelled fuel and vehicle class",
    query: "petorl motar car registrations in Maharashtra in Jan 2024",
    expect: {
      state: "Maharashtra",
      fuelType: "PETROL",
      vehicleClass: "MOTOR CAR",
      from: "2024-01",
      to: "2024-01",
    },
  },
  {
    label: "misspelled electric fuel family",
    query: "electirc cars in Haridwar Jan 2024",
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
    label: "fork lift class without inferred category",
    query: "fork lift registrations in Maharashtra in 2024",
    expect: {
      state: "Maharashtra",
      vehicleClass: "FORK LIFT",
      selectedVehicleCategories: [],
      excludedVehicleCategories: ["HEAVY MOTOR VEHICLE"],
      from: "2024-01",
      to: "2024-12",
      minTotal: 1,
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
    label: "lpg fuel semantics",
    query: "Find the registration count of BS IV LPG three-wheelers in Rajasthan in July 2024.",
    expect: {
      state: "Rajasthan",
      selectedFuelTypes: ["LPG ONLY", "PETROL/LPG", "PETROL(E20)/LPG"],
      selectedVehicleCategories: ["THREE WHEELER(NT)", "THREE WHEELER(T)"],
      selectedNorms: ["BHARAT STAGE IV"],
      from: "2024-07",
      to: "2024-07",
      total: 0,
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
    label: "passenger cars intersect motor car with LMV",
    query: "Show the registration count of BS VI diesel passenger cars in Maharashtra in February 2026.",
    expect: {
      state: "Maharashtra",
      fuelType: "DIESEL",
      selectedFuelTypes: ["DIESEL"],
      vehicleClass: "MOTOR CAR",
      selectedVehicleCategories: ["LIGHT MOTOR VEHICLE"],
      selectedNorms: ["BHARAT STAGE VI"],
      from: "2026-02",
      to: "2026-02",
      status: "complete",
      minRows: 1,
    },
  },
  {
    label: "broad four wheeler applies light vehicle side filters only",
    query: "four wheeler in Delhi Jan 2025",
    expect: {
      state: "Delhi",
      selectedVehicleCategories: FOUR_WHEELER_SIDE_FILTERS,
      exactVehicleClasses: [],
      selectedVehicleGroups: [],
      excludedVehicleCategories: ["FOUR WHEELER (Invalid Carriage)"],
      from: "2025-01",
      to: "2025-01",
    },
  },
  {
    label: "private four wheeler applies light vehicle side filters only",
    query: "private four wheeler in Maharashtra Jan 2024",
    expect: {
      state: "Maharashtra",
      selectedVehicleCategories: FOUR_WHEELER_SIDE_FILTERS,
      exactVehicleClasses: [],
      selectedVehicleGroups: [],
      excludedVehicleCategories: ["FOUR WHEELER (Invalid Carriage)"],
      from: "2024-01",
      to: "2024-01",
    },
  },
  {
    label: "4w abbreviation applies light vehicle side filters only",
    query: "4w registrations in Maharashtra Jan 2026",
    expect: {
      state: "Maharashtra",
      selectedVehicleCategories: FOUR_WHEELER_SIDE_FILTERS,
      exactVehicleClasses: [],
      selectedVehicleGroups: [],
      from: "2026-01",
      to: "2026-01",
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
    label: "2w abbreviation applies two wheeler side filters",
    query: "2w registration in Noida in 2026",
    expect: {
      state: "Uttar Pradesh",
      rtoResolved: true,
      selectedVehicleCategories: ["TWO WHEELER(NT)", "TWO WHEELER(T)"],
      selectedVehicleGroups: [],
      from: "2026-01",
      to: "2026-06",
    },
  },
  {
    label: "light motor vehicle category",
    query: "light motor vehicle registrations in Maharashtra in 2026",
    expect: {
      state: "Maharashtra",
      selectedVehicleCategories: ["LIGHT MOTOR VEHICLE"],
      excludedVehicleCategories: ["HEAVY MOTOR VEHICLE"],
      from: "2026-01",
      to: "2026-06",
      minTotal: 1,
      minRows: 96,
      categoryRowsOnly: true,
    },
  },
  {
    label: "medium motor vehicle category",
    query: "medium motor vehicle registrations in Maharashtra in 2026",
    expect: {
      state: "Maharashtra",
      selectedVehicleCategories: ["MEDIUM MOTOR VEHICLE"],
      excludedVehicleCategories: ["LIGHT MOTOR VEHICLE"],
      from: "2026-01",
      to: "2026-06",
      status: "complete",
      minRows: 1,
      categoryRowsOnly: true,
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
    label: "passenger auto rickshaw uses transport passenger filters",
    query: "auto rickshaws used for transport of passengers in Delhi Jan 2025",
    expect: {
      state: "Delhi",
      selectedVehicleCategories: ["THREE WHEELER(T)"],
      excludedVehicleCategories: ["THREE WHEELER(NT)"],
      vehicleClasses: ["THREE WHEELER (PASSENGER)"],
      excludedVehicleClasses: ["THREE WHEELER (GOODS)", "E-RICKSHAW(P)", "E-RICKSHAW WITH CART (G)"],
      selectedVehicleGroups: [],
      from: "2025-01",
      to: "2025-01",
    },
  },
  {
    label: "goods auto rickshaw uses goods class",
    query: "goods auto rickshaw in Delhi Jan 2025",
    expect: {
      state: "Delhi",
      selectedVehicleCategories: ["THREE WHEELER(T)"],
      excludedVehicleCategories: ["THREE WHEELER(NT)"],
      vehicleClasses: ["THREE WHEELER (GOODS)"],
      excludedVehicleClasses: ["THREE WHEELER (PASSENGER)"],
      selectedVehicleGroups: [],
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

const errorChecks = [
  {
    label: "unknown word containing a state code fails closed",
    query: "grouped vehicle registrations in Jan 2024",
    status: 422,
    message: /could not safely map that wording/i,
  },
  {
    label: "multiple states fail closed",
    query: "EV registrations in Maharashtra and Delhi in Jan 2024",
    status: 422,
    message: /multiple locations/i,
  },
  {
    label: "conflicting city and state fail closed",
    query: "EV registrations in Noida, Maharashtra in Jan 2024",
    status: 422,
    message: /multiple locations|belongs to Uttar Pradesh, not Maharashtra/i,
  },
  {
    label: "multiple RTO codes fail closed",
    query: "Compare RTO UP16 and MH01 in Jan 2024",
    status: 422,
    message: /multiple RTO codes/i,
  },
  {
    label: "reversed dates fail closed",
    query: "EV registrations in Maharashtra from Dec 2024 to Jan 2024",
    status: 400,
    message: /date range is reversed/i,
  },
  {
    label: "reversed year ranges fail closed",
    query: "EV registrations in Maharashtra from 2025 to 2024",
    status: 400,
    message: /year range is reversed/i,
  },
  {
    label: "future-only dates fail closed",
    query: "EV registrations in Maharashtra in Jan 2027",
    status: 400,
    message: /starts in the future/i,
  },
  {
    label: "comparison intent fails closed",
    query: "Compare petrol and diesel car registrations in Delhi during 2025",
    status: 422,
    message: /comparisons are not supported/i,
  },
  {
    label: "ranking intent fails closed",
    query: "Show the top five RTOs by CNG taxi registrations in Delhi during 2025",
    status: 422,
    message: /rankings and top-or-bottom requests are not supported/i,
  },
  {
    label: "unsupported breakdown fails closed",
    query: "Show state-wise petrol car registration counts in Jan 2026",
    status: 422,
    message: /grouped breakdown is not supported/i,
  },
  {
    label: "OEM subject fails closed",
    query: "Show Tata Motors registrations in Maharashtra in Jan 2026",
    status: 422,
    message: /subject is not available/i,
  },
  {
    label: "forecast intent fails closed",
    query: "Forecast EV registrations in Delhi for 2027",
    status: 422,
    message: /analytical metric is not supported/i,
  },
  {
    label: "causal question fails closed",
    query: "Why did EV registrations increase in Maharashtra in 2025",
    status: 422,
    message: /analytical metric is not supported|causal or explanatory questions cannot be answered/i,
  },
  {
    label: "unrelated question fails closed",
    query: "What is the weather in Delhi",
    status: 422,
    message: /subject is not available/i,
  },
  {
    label: "location-only question fails closed",
    query: "Tell me about Maharashtra in 2025",
    status: 422,
    message: /does not identify a supported vehicle-registration subject/i,
  },
];

function startServer() {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "test",
      TEST_CURRENT_MONTH: "2026-06",
      DATABASE_URL: "",
      AI_QUERY_PROVIDER: "none",
      FACTOR_AGENT_PROVIDER: "none",
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      OLLAMA_QUERY_MODEL: "qwen3:4b",
      OLLAMA_FACTOR_MODEL: "qwen3:4b",
      OLLAMA_TIMEOUT_MS: "10000",
      GEMINI_API_KEY: "",
      GROQ_API_KEY: "",
      PUBLIC_DASHBOARD_DISABLE_LIVE_REFRESH: "1",
      RATE_LIMIT_STORE: "memory",
      EXPENSIVE_RATE_LIMIT_MAX: "10000",
      EXPENSIVE_RATE_LIMIT_GLOBAL_MAX: "10000",
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

async function callQueryError(text) {
  const response = await fetch(`${BASE_URL}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: text }),
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function callMapQueryError(text) {
  const response = await fetch(`${BASE_URL}/api/map/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: text }),
  });
  const body = await response.json();
  return { status: response.status, body };
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
  if (expect.liveRefreshStatus) {
    assert(data.liveRefresh?.status === expect.liveRefreshStatus, `${item.label}: expected live refresh ${expect.liveRefreshStatus}, got ${data.liveRefresh?.status}`);
  } else {
    assert(data.liveRefresh === null, `${item.label}: local check should not start live refresh`);
  }
  if (expect.status) assert(data.dataStatus === expect.status, `${item.label}: expected status ${expect.status}, got ${data.dataStatus}`);
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
  for (const fuelType of expect.appliedExcludedFuelTypes ?? []) {
    assert(data.filters.excludedFuelTypes?.includes(fuelType), `${item.label}: expected excluded fuel ${fuelType}, got ${data.filters.excludedFuelTypes}`);
    assert(!data.filters.selectedFuelTypes?.includes(fuelType), `${item.label}: excluded fuel ${fuelType} must not also be selected`);
    assert(!data.rows.some((row) => row.fuel_type === fuelType), `${item.label}: result rows should exclude ${fuelType}`);
  }
  if (expect.selectedVehicleGroups) {
    assert(JSON.stringify(data.filters.selectedVehicleGroups ?? []) === JSON.stringify(expect.selectedVehicleGroups), `${item.label}: expected vehicle groups ${expect.selectedVehicleGroups}, got ${data.filters.selectedVehicleGroups}`);
  }
  if (expect.selectedVehicleCategories) {
    assert(JSON.stringify(data.filters.selectedVehicleCategories ?? []) === JSON.stringify(expect.selectedVehicleCategories), `${item.label}: expected vehicle categories ${expect.selectedVehicleCategories}, got ${data.filters.selectedVehicleCategories}`);
    if (expect.categoryRowsOnly && expect.selectedVehicleCategories.length) {
      for (const vehicleCategory of expect.selectedVehicleCategories) {
        assert(data.rows.some((row) => row.vehicle_category_filter === vehicleCategory), `${item.label}: expected result rows for vehicle category ${vehicleCategory}`);
      }
      assert(
        data.rows.every((row) => expect.selectedVehicleCategories.includes(row.vehicle_category_filter)),
        `${item.label}: result rows should only include selected vehicle categories ${expect.selectedVehicleCategories}`,
      );
    }
  }
  if (expect.selectedNorms) {
    assert(JSON.stringify(data.filters.selectedNorms ?? []) === JSON.stringify(expect.selectedNorms), `${item.label}: expected norms ${expect.selectedNorms}, got ${data.filters.selectedNorms}`);
    if (data.rows.length) {
      for (const norm of expect.selectedNorms) {
        assert(data.rows.some((row) => row.norms_filter === norm), `${item.label}: expected result rows for norm ${norm}`);
      }
    }
  }
  for (const vehicleCategory of expect.excludedVehicleCategories ?? []) {
    assert(!data.filters.vehicleCategories?.includes(vehicleCategory), `${item.label}: did not expect vehicle category ${vehicleCategory}`);
    assert(!data.filters.selectedVehicleCategories?.includes(vehicleCategory), `${item.label}: did not expect selected vehicle category ${vehicleCategory}`);
  }
  if ("rto" in expect) assert(data.filters.rto === expect.rto, `${item.label}: expected rto ${expect.rto}, got ${data.filters.rto}`);
  if (expect.rtoSearch) assert(data.filters.rtoSearch === expect.rtoSearch, `${item.label}: expected RTO search ${expect.rtoSearch}, got ${data.filters.rtoSearch}`);
  if (expect.rtoResolved) assert(Boolean(data.filters.rto), `${item.label}: expected a resolved RTO`);
  if (expect.rtoIncludes) assert(String(data.filters.rto ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase().includes(expect.rtoIncludes.toLowerCase()), `${item.label}: expected RTO containing ${expect.rtoIncludes}, got ${data.filters.rto}`);
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
  for (const vehicleClass of expect.appliedExcludedVehicleClasses ?? []) {
    assert(data.filters.excludedVehicleClasses?.includes(vehicleClass), `${item.label}: expected excluded vehicle class ${vehicleClass}, got ${data.filters.excludedVehicleClasses}`);
    assert(!data.filters.vehicleClasses?.includes(vehicleClass), `${item.label}: excluded vehicle class ${vehicleClass} must not also be selected`);
  }
  if (expect.from) assert(data.filters.from === expect.from, `${item.label}: expected from ${expect.from}, got ${data.filters.from}`);
  if (expect.to) assert(data.filters.to === expect.to, `${item.label}: expected to ${expect.to}, got ${data.filters.to}`);
  if (expect.total !== undefined) assert(data.summary.total === expect.total, `${item.label}: expected total ${expect.total}, got ${data.summary.total}`);
  if (expect.minTotal !== undefined) assert(data.summary.total >= expect.minTotal, `${item.label}: expected total >= ${expect.minTotal}, got ${data.summary.total}`);
  if (expect.minRows) assert(data.rows.length >= expect.minRows, `${item.label}: expected at least ${expect.minRows} row(s), got ${data.rows.length}`);
}

function assertMonthlyReport(label, report, expect = {}) {
  assert(report.kind === "monthly-sales", `${label}: expected monthly-sales report kind`);
  assert(report.period?.month === expect.month, `${label}: expected month ${expect.month}, got ${report.period?.month}`);
  assert(report.fuelSelection?.scope === expect.fuelScope, `${label}: expected fuel scope ${expect.fuelScope}, got ${report.fuelSelection?.scope}`);
  if (expect.fuel) assert(report.fuelSelection?.fuel === expect.fuel, `${label}: expected fuel ${expect.fuel}, got ${report.fuelSelection?.fuel}`);
  if (expect.locationType) assert(report.locationScope?.type === expect.locationType, `${label}: expected location type ${expect.locationType}, got ${report.locationScope?.type}`);
  if (expect.locationState) assert(report.locationScope?.state === expect.locationState, `${label}: expected location state ${expect.locationState}, got ${report.locationScope?.state}`);
  if (expect.locationRto) assert(report.locationScope?.rto === expect.locationRto, `${label}: expected location RTO ${expect.locationRto}, got ${report.locationScope?.rto}`);
  const sections = new Map((report.sections ?? []).map((section) => [section.id, section]));
  for (const id of ["overview", "fuel_mix", "category_sales", "twelve_month_trend", "share_trend", "oem_leaders"]) {
    assert(sections.has(id), `${label}: missing section ${id}`);
  }
  const overview = sections.get("overview");
  const categorySales = sections.get("category_sales");
  const oemLeaders = sections.get("oem_leaders");
  const categoryIds = (categorySales.chartData ?? []).map((item) => item.id);
  const expectedCategoryIds = ["two_wheeler", "three_wheeler", "four_wheeler_private"];
  assert(JSON.stringify(categoryIds) === JSON.stringify(expectedCategoryIds), `${label}: expected category sales ids ${expectedCategoryIds}, got ${categoryIds}`);
  const oemIds = (oemLeaders.chartData ?? []).map((item) => item.id);
  assert(JSON.stringify(oemIds) === JSON.stringify(expectedCategoryIds), `${label}: expected OEM category ids ${expectedCategoryIds}, got ${oemIds}`);
  for (const group of oemLeaders.chartData ?? []) {
    assert(Array.isArray(group.brands), `${label}: OEM group ${group.id} should include brand rows`);
    assert(group.brands.length === 5, `${label}: OEM group ${group.id} should include exactly five brands`);
  }
  const twoWheelerOem = oemLeaders.chartData?.find((item) => item.id === "two_wheeler");
  const threeWheelerOem = oemLeaders.chartData?.find((item) => item.id === "three_wheeler");
  assert(twoWheelerOem?.vehicle_category_filter === "TWO WHEELER(NT)|TWO WHEELER(T)", `${label}: 2W OEM group should use two wheeler T/NT filter`);
  assert(threeWheelerOem?.vehicle_category_filter === "THREE WHEELER(NT)|THREE WHEELER(T)", `${label}: 3W OEM group should use three wheeler T/NT filter`);
  assert(twoWheelerOem?.brands?.some((brand) => brand.name === "Bajaj Auto"), `${label}: 2W OEM group should include Bajaj Auto`);
  assert(threeWheelerOem?.brands?.some((brand) => brand.name === "Bajaj Auto"), `${label}: 3W OEM group should include Bajaj Auto`);
  assert(
    twoWheelerOem?.status !== "missing" || twoWheelerOem?.brands?.every((brand) => Number(brand.count ?? 0) === 0),
    `${label}: missing 2W OEM rows must not fall back to unfiltered maker totals`,
  );
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
      let data;
      try {
        data = await callQuery(item.query);
      } catch (error) {
        error.message = `${item.label}: ${error.message}`;
        throw error;
      }
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
      { label: "state location report", params: { month: "2026-01", fuelScope: "all", location: "Maharashtra" }, expect: { month: "2026-01", fuelScope: "all", locationType: "state", locationState: "Maharashtra", minTotal: 1 } },
      { label: "RTO location report", params: { month: "2026-06", fuelScope: "all", location: "haridwar" }, expect: { month: "2026-06", fuelScope: "all", locationType: "rto", locationState: "Uttarakhand", locationRto: "haridwar", minTotal: 1 } },
    ]) {
      const report = await callMonthlySalesReport(item.params);
      assertMonthlyReport(item.label, report, item.expect);
      monthlyReports.push({
        label: item.label,
        total: report.sections.find((section) => section.id === "overview")?.metrics?.total ?? 0,
        oemRows: report.coverage.makerRows,
      });
    }
    for (const item of errorChecks) {
      const result = await callQueryError(item.query);
      assert(result.status === item.status, `${item.label}: expected HTTP ${item.status}, got ${result.status}`);
      assert(item.message.test(result.body.error ?? ""), `${item.label}: unexpected error "${result.body.error}"`);
      queryResults.push({ label: item.label, status: `HTTP ${result.status}`, rows: 0, total: 0 });
    }
    for (const item of [
      errorChecks.find((check) => check.label === "multiple states fail closed"),
      errorChecks.find((check) => check.label === "reversed year ranges fail closed"),
    ]) {
      const result = await callMapQueryError(item.query);
      assert(result.status === item.status, `map ${item.label}: expected HTTP ${item.status}, got ${result.status}`);
      assert(item.message.test(result.body.error ?? ""), `map ${item.label}: unexpected error "${result.body.error}"`);
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
