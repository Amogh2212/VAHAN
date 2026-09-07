import assert from "node:assert/strict";

process.env.DATABASE_URL = "";
process.env.VAHAN_DISABLE_LIVE_REFRESH = "1";
process.env.NODE_ENV = "test";
process.env.TEST_CURRENT_MONTH = "2026-07";

const {
  configuredDashboardQueryRoutingMode,
  dashboardQueryRoutingMetricsSnapshot,
  decodeDashboardGroqQuery,
  queryData,
  resetDashboardAiStateForTests,
  resetDashboardQueryRoutingMetricsForTests,
} = await import("../server.mjs");

assert.equal(configuredDashboardQueryRoutingMode({}), "enforced");
assert.equal(configuredDashboardQueryRoutingMode({ DASHBOARD_QUERY_ROUTING_MODE: "invalid" }), "enforced");
assert.equal(configuredDashboardQueryRoutingMode({ DASHBOARD_QUERY_ROUTING_MODE: "shadow" }), "shadow");
assert.equal(configuredDashboardQueryRoutingMode({ DASHBOARD_QUERY_ROUTING_MODE: "enforced" }), "enforced");

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
    semanticExplanation: "Mapped the unresolved wording to canonical filters.",
    ...overrides,
  };
}

async function expectQueryError(query, expectedCode, dependencies) {
  try {
    await queryData({ query }, dependencies);
    assert.fail(`Expected ${expectedCode}: ${query}`);
  } catch (error) {
    assert.equal(error.details?.code, expectedCode, query);
    return error;
  }
}

resetDashboardQueryRoutingMetricsForTests();
resetDashboardAiStateForTests();

let decoderCalls = 0;
const forbiddenDecoder = async () => {
  decoderCalls += 1;
  throw new Error("The repair provider must not run for this query.");
};
const exactQuery = "Show diesel motor car registrations in Delhi in November 2025.";

const enforcedExact = await queryData(
  { query: exactQuery },
  { aiProvider: () => "groq", decodeAi: forbiddenDecoder, routingMode: "enforced" },
);
assert.equal(decoderCalls, 0);
assert.deepEqual(enforcedExact.filters.selectedFuelTypes, ["DIESEL"]);

const shadowExact = await queryData(
  { query: exactQuery },
  { aiProvider: () => "groq", decodeAi: forbiddenDecoder, routingMode: "shadow" },
);
assert.equal(decoderCalls, 0, "Shadow mode must remain observational and preserve fail-closed execution.");
assert.deepEqual(shadowExact.filters.selectedFuelTypes, ["DIESEL"]);

const safeFuzzy = await queryData(
  { query: "Show petorl vehicle registrations in Maharashtra in January 2025." },
  { aiProvider: () => "groq", decodeAi: forbiddenDecoder, routingMode: "enforced" },
);
assert.equal(decoderCalls, 0);
assert.deepEqual(safeFuzzy.filters.selectedFuelTypes, ["PETROL"]);

await expectQueryError(
  "Show the top five RTOs by CNG taxi registrations in Delhi during 2025",
  "unsupported_dashboard_query",
  { aiProvider: () => "groq", decodeAi: forbiddenDecoder, routingMode: "enforced" },
);
assert.equal(decoderCalls, 0, "Unsupported queries must not reach the provider.");

const unusualQuery = "Show spark-fuel vehicle registrations in Maharashtra in January 2025.";
const repaired = await queryData(
  { query: unusualQuery },
  {
    aiProvider: () => "groq",
    decodeAi: async () => {
      decoderCalls += 1;
      return { filters: repairPlan(), warnings: [] };
    },
    routingMode: "enforced",
  },
);
assert.deepEqual(repaired.filters.selectedFuelTypes, ["PETROL"]);
assert.equal(repaired.filters.correctedByAi, true);

await expectQueryError(
  "Show diesel spark-style vehicle registrations in Maharashtra in January 2025.",
  "dashboard_query_clarification_required",
  {
    aiProvider: () => "groq",
    decodeAi: async () => {
      decoderCalls += 1;
      return { filters: repairPlan(), warnings: [] };
    },
    routingMode: "enforced",
  },
);

await expectQueryError(
  unusualQuery,
  "dashboard_query_clarification_required",
  {
    aiProvider: () => "groq",
    decodeAi: async () => {
      decoderCalls += 1;
      throw new Error("provider internals must not escape");
    },
    routingMode: "enforced",
  },
);

let metrics = dashboardQueryRoutingMetricsSnapshot({ DASHBOARD_QUERY_ROUTING_MODE: "enforced" });
assert.equal(metrics.totalQueries, 7);
assert.deepEqual(metrics.requestsByMode, { shadow: 1, enforced: 6 });
assert.deepEqual(metrics.decisions, { local: 3, repair: 3, reject: 1 });
assert.equal(metrics.outcomes.localDeterministicSuccesses, 3);
assert.equal(metrics.outcomes.groqAssistedSuccesses, 1);
assert.equal(metrics.outcomes.unsupportedRejected, 1);
assert.equal(metrics.outcomes.clarificationRequired, 2);
assert.deepEqual(metrics.fuzzy, { candidates: 1, accepted: 1 });
assert.equal(metrics.groq.repairDemand, 3);
assert.equal(metrics.groq.plansValidated, 2);
assert.equal(metrics.groq.postValidationFailures, 1);
assert.equal(metrics.groq.deterministicComparisons, 2);
assert.equal(metrics.groq.deterministicDisagreements, 1);
assert.equal(metrics.groq.invocations, 0, "Injected decoders are not real Groq network calls.");

const groqEnv = {
  AI_QUERY_PROVIDER: "groq",
  GROQ_API_KEY: "test-only-key",
  GROQ_MODEL: "llama-3.1-8b-instant",
  GROQ_AI_MIN_INTERVAL_MS: "0",
  GROQ_AI_CACHE_TTL_MS: "60000",
  GROQ_AI_RATE_LIMIT_COOLDOWN_MS: "30000",
  GROQ_AI_TIMEOUT_MS: "1000",
};
const noTimeout = () => undefined;
const noHeaders = { get: () => null };

await decodeDashboardGroqQuery("telemetry rate-limit sentinel", undefined, {
  env: groqEnv,
  fetchImpl: async () => ({
    ok: false,
    status: 429,
    headers: { get: (name) => name.toLowerCase() === "retry-after" ? "1" : null },
  }),
  timeoutSignal: noTimeout,
  now: () => 1_000_000,
});

resetDashboardAiStateForTests();
let fetchCalls = 0;
const cachedQuery = "telemetry cache sentinel";
const successfulFetch = async () => {
  fetchCalls += 1;
  return {
    ok: true,
    status: 200,
    headers: noHeaders,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(repairPlan()) } }],
      usage: { total_tokens: 100 },
    }),
  };
};
await decodeDashboardGroqQuery(cachedQuery, undefined, {
  env: groqEnv,
  fetchImpl: successfulFetch,
  timeoutSignal: noTimeout,
  now: () => 2_000_000,
});
await decodeDashboardGroqQuery(cachedQuery, undefined, {
  env: groqEnv,
  fetchImpl: successfulFetch,
  timeoutSignal: noTimeout,
  now: () => 2_000_001,
});
assert.equal(fetchCalls, 1, "A Groq cache hit must not count as another network invocation.");

metrics = dashboardQueryRoutingMetricsSnapshot({ DASHBOARD_QUERY_ROUTING_MODE: "enforced" });
assert.equal(metrics.groq.invocations, 2, "Only the 429 request and first cacheable request reached fetch.");
assert.equal(metrics.groq.quotaRateLimitEvents, 1);
assert.equal(metrics.rates.localDeterministicSuccess, 1);
assert.equal(metrics.rates.fuzzyCorrectionAcceptance, 1);
assert.equal(metrics.rates.postGroqValidationFailure, 0.5);
assert.equal(metrics.rates.deterministicGroqDisagreement, 0.5);

const serializedMetrics = JSON.stringify(metrics);
for (const forbidden of [exactQuery, unusualQuery, cachedQuery, "DIESEL", "PETROL", "Maharashtra"]) {
  assert.equal(serializedMetrics.includes(forbidden), false, `Telemetry leaked query/filter content: ${forbidden}`);
}
function assertAggregateOnly(value) {
  assert.equal(Array.isArray(value), false, "Telemetry must not contain arrays.");
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value)) assertAggregateOnly(child);
}
assertAggregateOnly(metrics);

resetDashboardQueryRoutingMetricsForTests();
const reset = dashboardQueryRoutingMetricsSnapshot({ DASHBOARD_QUERY_ROUTING_MODE: "shadow" });
assert.equal(reset.configuredMode, "shadow");
assert.equal(reset.totalQueries, 0);
assert.deepEqual(reset.decisions, { local: 0, repair: 0, reject: 0 });
assert.deepEqual(reset.fuzzy, { candidates: 0, accepted: 0 });
assert.equal(reset.rates.localDeterministicSuccess, null);

console.log(JSON.stringify({
  passed: true,
  rolloutModes: ["shadow", "enforced"],
  routedQueries: metrics.totalQueries,
  realGroqNetworkInvocations: metrics.groq.invocations,
  quotaRateLimitEvents: metrics.groq.quotaRateLimitEvents,
  clarificationRequired: metrics.outcomes.clarificationRequired,
  rawQueryTelemetry: false,
}, null, 2));
