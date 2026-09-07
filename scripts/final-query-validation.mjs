import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

process.env.DATABASE_URL = "";
process.env.VAHAN_DISABLE_LIVE_REFRESH = "1";
process.env.NODE_ENV = "test";
process.env.TEST_CURRENT_MONTH = "2026-06";
process.env.AI_QUERY_PROVIDER = "none";
process.env.DASHBOARD_QUERY_ROUTING_MODE = "enforced";

const {
  classifyDashboardQueryRouting,
  dashboardQueryRoutingMetricsSnapshot,
  interpretDashboardQuery,
  queryData,
  resetDashboardQueryRoutingMetricsForTests,
} = await import("../server.mjs");

const OUTPUT_PATH = path.resolve("output", "final-validation", "query-validation.json");

function repairPlan(overrides = {}) {
  return {
    aiProvider: "Groq",
    supported: true,
    selectedFuelTypes: ["PETROL"],
    selectedVehicleGroups: [],
    selectedVehicleClasses: [],
    selectedVehicleCategories: [],
    selectedNorms: [],
    excludedFuelTypes: [],
    excludedVehicleGroups: [],
    excludedVehicleClasses: [],
    excludedVehicleCategories: [],
    excludedNorms: [],
    state: "Maharashtra",
    from: "2025-01",
    to: "2025-01",
    metric: "registrations",
    semanticConfidence: 0.95,
    semanticExplanation: "Mapped unresolved wording to an allowlisted fuel.",
    ...overrides,
  };
}

function appliedFilters(filters) {
  return {
    state: filters.state ?? null,
    rto: filters.rto ?? null,
    from: filters.from ?? null,
    to: filters.to ?? null,
    fuelSegment: filters.fuelSegment ?? null,
    selectedFuelTypes: filters.selectedFuelTypes ?? [],
    selectedVehicleGroups: filters.selectedVehicleGroups ?? [],
    selectedVehicleClasses: filters.selectedVehicleClasses ?? [],
    selectedVehicleCategories: filters.selectedVehicleCategories ?? [],
    selectedNorms: filters.selectedNorms ?? [],
    excludedFuelTypes: filters.excludedFuelTypes ?? [],
    excludedVehicleGroups: filters.excludedVehicleGroups ?? [],
    excludedVehicleClasses: filters.excludedVehicleClasses ?? [],
    excludedVehicleCategories: filters.excludedVehicleCategories ?? [],
    excludedNorms: filters.excludedNorms ?? [],
    aiProvider: filters.aiProvider ?? null,
    correctedByAi: filters.correctedByAi === true,
  };
}

function sampleRows(rows) {
  return rows.slice(0, 3).map((row) => ({
    year: row.year,
    month: row.month,
    state: row.state,
    rto: row.rto,
    fuelType: row.fuel_type,
    vehicleCategory: row.vehicle_category_filter,
    norm: row.norms_filter,
    vehicleClass: row.vehicle_class_filter,
    vehicleCount: Number(row.vehicle_count),
  }));
}

function assertExpectedFilters(actual, expected = {}) {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value, `Expected filter ${key}=${JSON.stringify(value)}, got ${JSON.stringify(actual[key])}`);
  }
}

async function successCase(definition) {
  const interpretation = interpretDashboardQuery(definition.query);
  const routing = classifyDashboardQueryRouting(definition.query, interpretation);
  assert.equal(routing.state, definition.expectedRouting, `${definition.id}: unexpected routing state`);
  const result = await queryData(
    { query: definition.query },
    definition.dependencies ?? { aiProvider: () => "none", routingMode: "enforced" },
  );
  const filters = appliedFilters(result.filters);
  const computedTotal = result.rows.reduce((sum, row) => sum + Number(row.vehicle_count), 0);
  assert.equal(result.summary.total, computedTotal, `${definition.id}: aggregation differs from fetched rows`);
  assert.equal(result.summary.total, definition.expectedTotal, `${definition.id}: unexpected total`);
  assert.equal(result.rows.length, definition.expectedRows, `${definition.id}: unexpected fetched row count`);
  assertExpectedFilters(filters, definition.expectedFilters);
  return {
    id: definition.id,
    objective: definition.objective,
    request: { method: "POST", path: "/api/query", body: { query: definition.query } },
    routing: { state: routing.state, reason: routing.reason, providerAllowed: routing.state === "repair" },
    expected: {
      total: definition.expectedTotal,
      rowCount: definition.expectedRows,
      filters: definition.expectedFilters,
    },
    actual: {
      dataStatus: result.dataStatus,
      rowCount: result.rows.length,
      filters,
      fetchedRowSample: sampleRows(result.rows),
      calculation: {
        formula: "sum(fetched rows.vehicle_count)",
        computedTotal,
        reportedTotal: result.summary.total,
        equal: computedTotal === result.summary.total,
      },
      reportOutput: {
        summary: result.summary,
        warningCount: result.warnings.length,
        liveRefresh: result.liveRefresh,
      },
    },
    status: "Passed",
  };
}

async function errorCase(definition) {
  const interpretation = interpretDashboardQuery(definition.query);
  const routing = classifyDashboardQueryRouting(definition.query, interpretation);
  assert.equal(routing.state, definition.expectedRouting, `${definition.id}: unexpected routing state`);
  let caught = null;
  try {
    await queryData(
      { query: definition.query },
      definition.dependencies ?? { aiProvider: () => "none", routingMode: "enforced" },
    );
  } catch (error) {
    caught = error;
  }
  assert(caught, `${definition.id}: expected an error`);
  assert.equal(caught.statusCode, definition.expectedStatus, `${definition.id}: unexpected status`);
  assert.equal(caught.details?.code, definition.expectedCode, `${definition.id}: unexpected error code`);
  return {
    id: definition.id,
    objective: definition.objective,
    request: { method: "POST", path: "/api/query", body: { query: definition.query } },
    routing: { state: routing.state, reason: routing.reason, providerAllowed: routing.state === "repair" },
    expected: { httpStatus: definition.expectedStatus, errorCode: definition.expectedCode },
    actual: {
      httpStatus: caught.statusCode,
      errorCode: caught.details?.code,
      routingReason: caught.details?.routingReason ?? routing.reason,
      message: caught.message,
      dataFetched: false,
      totalProduced: false,
    },
    status: "Passed",
  };
}

resetDashboardQueryRoutingMetricsForTests();

const successes = [];
for (const definition of [
  {
    id: "exact-multi-axis",
    objective: "Apply geography, month, fuel, passenger-car intersection, and emission norm together.",
    query: "Show BS VI diesel passenger cars in Maharashtra in February 2026.",
    expectedRouting: "local",
    expectedTotal: 8775,
    expectedRows: 1,
    expectedFilters: {
      state: "Maharashtra",
      from: "2026-02",
      to: "2026-02",
      selectedFuelTypes: ["DIESEL"],
      selectedVehicleClasses: ["MOTOR CAR"],
      selectedVehicleCategories: ["LIGHT MOTOR VEHICLE"],
      selectedNorms: ["BHARAT STAGE VI"],
    },
  },
  {
    id: "safe-multiple-typos",
    objective: "Correct approved fuel and vehicle-class typos without calling AI.",
    query: "petorl motar car registrations in Maharashtra in Jan 2024",
    expectedRouting: "local",
    expectedTotal: 19812,
    expectedRows: 1,
    expectedFilters: {
      state: "Maharashtra",
      from: "2024-01",
      to: "2024-01",
      selectedFuelTypes: ["PETROL"],
      selectedVehicleClasses: ["MOTOR CAR"],
      aiProvider: null,
    },
  },
  {
    id: "compound-exclusion",
    objective: "Apply non-EV negation as exact battery-electric exclusions.",
    query: "non-EV registrations in Maharashtra in Jan 2024",
    expectedRouting: "local",
    expectedTotal: 236163,
    expectedRows: 15,
    expectedFilters: {
      state: "Maharashtra",
      fuelSegment: "NON_EV",
      excludedFuelTypes: ["ELECTRIC(BOV)", "PURE EV"],
      from: "2024-01",
      to: "2024-01",
    },
  },
  {
    id: "relative-date-range",
    objective: "Resolve a clear relative three-month period locally.",
    query: "EV registrations in Maharashtra for the last 3 months",
    expectedRouting: "local",
    expectedTotal: 63783,
    expectedRows: 4,
    expectedFilters: {
      state: "Maharashtra",
      fuelSegment: "EV",
      from: "2026-04",
      to: "2026-06",
    },
  },
  {
    id: "validated-ai-repair",
    objective: "Allow AI to fill one unresolved fuel dimension while keeping totals data-derived.",
    query: "Show spark-fuel vehicle registrations in Maharashtra in January 2025.",
    expectedRouting: "repair",
    expectedTotal: 184902,
    expectedRows: 1,
    expectedFilters: {
      state: "Maharashtra",
      selectedFuelTypes: ["PETROL"],
      from: "2025-01",
      to: "2025-01",
      aiProvider: "Groq",
      correctedByAi: true,
    },
    dependencies: {
      aiProvider: () => "groq",
      decodeAi: async () => ({ filters: repairPlan(), warnings: [] }),
      routingMode: "enforced",
    },
  },
]) {
  successes.push(await successCase(definition));
}

const errors = [];
for (const definition of [
  {
    id: "unsupported-comparison",
    objective: "Reject a comparison without calling AI or returning an ordinary total.",
    query: "Compare petrol and diesel car registrations in Delhi during 2025",
    expectedRouting: "reject",
    expectedStatus: 422,
    expectedCode: "unsupported_dashboard_query",
  },
  {
    id: "multiple-location-conflict",
    objective: "Reject two explicit states instead of broadening the location.",
    query: "EV registrations in Maharashtra and Delhi in Jan 2024",
    expectedRouting: "reject",
    expectedStatus: 422,
    expectedCode: "location_conflict",
  },
  {
    id: "ambiguous-fuzzy-location",
    objective: "Request clarification when a misspelling is equally close to two cities.",
    query: "Show vehicle registrations in xangalore in January 2025.",
    expectedRouting: "repair",
    expectedStatus: 422,
    expectedCode: "dashboard_query_clarification_required",
  },
  {
    id: "provider-unavailable",
    objective: "Request clarification when repair is required but the provider is unavailable.",
    query: "Show spark-fuel vehicle registrations in Maharashtra in January 2025.",
    expectedRouting: "repair",
    expectedStatus: 422,
    expectedCode: "dashboard_query_clarification_required",
    dependencies: {
      aiProvider: () => "groq",
      decodeAi: async () => { throw new Error("simulated provider outage"); },
      routingMode: "enforced",
    },
  },
  {
    id: "ai-exact-conflict",
    objective: "Reject an AI fuel proposal that contradicts exact deterministic evidence.",
    query: "Show diesel spark-style vehicle registrations in Maharashtra in January 2025.",
    expectedRouting: "repair",
    expectedStatus: 422,
    expectedCode: "dashboard_query_clarification_required",
    dependencies: {
      aiProvider: () => "groq",
      decodeAi: async () => ({ filters: repairPlan(), warnings: [] }),
      routingMode: "enforced",
    },
  },
  {
    id: "future-date-conflict",
    objective: "Reject a future-only range before any provider or data query.",
    query: "EV registrations in Maharashtra in Jan 2027",
    expectedRouting: "reject",
    expectedStatus: 400,
    expectedCode: "date_conflict",
  },
]) {
  errors.push(await errorCase(definition));
}

const telemetry = dashboardQueryRoutingMetricsSnapshot();
const telemetryJson = JSON.stringify(telemetry);
for (const item of [...successes, ...errors]) {
  assert.equal(
    telemetryJson.includes(item.request.body.query),
    false,
    `Aggregate telemetry leaked raw query ${item.id}`,
  );
}

const report = {
  generatedAt: new Date().toISOString(),
  objective: "Final cross-phase validation of the deterministic-first VAHAN dashboard query system.",
  configuration: {
    storage: "CSV fixture with separate read-only database reconciliation",
    liveRefreshDisabled: true,
    routingMode: "enforced",
    realExternalAiCalls: 0,
    simulatedAiPlansUsedOnlyForValidation: true,
  },
  summary: {
    passed: true,
    successCases: successes.length,
    errorCases: errors.length,
    aggregationChecksPassed: successes.length,
    rawQueryTelemetry: false,
  },
  successes,
  errors,
  aggregateTelemetry: telemetry,
};

await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  passed: report.summary.passed,
  output: OUTPUT_PATH,
  successCases: report.summary.successCases,
  errorCases: report.summary.errorCases,
  aggregationChecksPassed: report.summary.aggregationChecksPassed,
  rawQueryTelemetry: report.summary.rawQueryTelemetry,
}, null, 2));
