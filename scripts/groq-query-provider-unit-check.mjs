import assert from "node:assert/strict";
import {
  dashboardGroqQuotaStateForTests,
  combineSemanticPlan,
  decodeDashboardAiQuery,
  normalizeDashboardAiFilters,
  parseGroqResetMilliseconds,
  resetDashboardAiStateForTests,
} from "../server.mjs";
import { groqPauseFromWarnings } from "./query-filter-oracle-audit.mjs";

const vocabulary = Object.freeze({
  fuelTypes: ["DIESEL", "ELECTRIC(BOV)"],
  vehicleGroups: ["FOUR WHEELER"],
  vehicleClasses: ["MOTOR CAR"],
  vehicleCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
  norms: ["BHARAT STAGE VI"],
});

const env = {
  AI_QUERY_PROVIDER: "groq",
  GROQ_API_KEY: "test-key",
  GROQ_MODEL: "llama-3.1-8b-instant",
  GROQ_AI_MIN_INTERVAL_MS: "30000",
  GROQ_AI_CACHE_TTL_MS: "86400000",
};
const fourWheelerPlan = {
  supported: true,
  semanticIntent: "Four wheeler registrations",
  selectedFuelTypes: [],
  selectedVehicleGroups: [],
  selectedVehicleClasses: [],
  selectedVehicleCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
  selectedNorms: [],
  excludedFuelTypes: [],
  excludedVehicleGroups: [],
  excludedVehicleClasses: [],
  excludedVehicleCategories: [],
  excludedNorms: [],
  state: "Delhi",
  locationType: "state",
  from: "2025-01",
  to: "2025-01",
  metric: "registrations",
  semanticConfidence: 0.95,
  semanticExplanation: "Mapped 4W to the exact VAHAN light-vehicle categories.",
};

function headers(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get: (name) => normalized.get(String(name).toLowerCase()) ?? null };
}

function successfulResponse({
  plan = fourWheelerPlan,
  totalTokens = 100,
  rateHeaders = {},
} = {}) {
  return {
    ok: true,
    status: 200,
    headers: headers(rateHeaders),
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(plan) } }],
      usage: { total_tokens: totalTokens },
    }),
  };
}

assert.equal(parseGroqResetMilliseconds("2m59.56s", 0), 179_560);
assert.equal(parseGroqResetMilliseconds("7.66s", 0), 7_660);
assert.equal(parseGroqResetMilliseconds("1h2m3s", 0), 3_723_000);
assert.equal(parseGroqResetMilliseconds("not-a-duration", 0), 0);
assert.deepEqual(
  groqPauseFromWarnings(
    ["Groq token quota reserve is active until 2026-07-30T12:00:00.000Z; local rules were used."],
    Date.parse("2026-07-30T11:00:00.000Z"),
  ),
  {
    kind: "token",
    resetAt: Date.parse("2026-07-30T12:00:00.000Z"),
    warning: "Groq token quota reserve is active until 2026-07-30T12:00:00.000Z; local rules were used.",
  },
);
assert.equal(groqPauseFromWarnings(["Groq query decoding was unavailable; local rules were used."]), null);

resetDashboardAiStateForTests();
let calls = 0;
let requestedTimeout = null;
const decoded = await decodeDashboardAiQuery("4 wheeler registrations in Delhi", vocabulary, {
  env,
  now: () => 1_000,
  timeoutSignal: (timeoutMs) => {
    requestedTimeout = timeoutMs;
    return new AbortController().signal;
  },
  fetchImpl: async (url, request) => {
    calls += 1;
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer test-key");
    const body = JSON.parse(request.body);
    assert.equal(body.model, "llama-3.1-8b-instant");
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.match(body.messages[1].content, /Required mapping:.*LIGHT MOTOR VEHICLE, LIGHT PASSENGER VEHICLE/s);
    assert.match(body.messages[1].content, /Allowed vehicle category labels: LIGHT MOTOR VEHICLE, LIGHT PASSENGER VEHICLE/);
    return successfulResponse();
  },
});
assert.equal(calls, 1);
assert.equal(requestedTimeout, 10_000);
assert.equal(decoded.filters?.aiProvider, "Groq");
const normalized = normalizeDashboardAiFilters(decoded.filters, vocabulary);
assert.equal(normalized?.aiProvider, "Groq");
assert.deepEqual(normalized?.selectedVehicleCategories, ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"]);
const enforcedFourWheeler = combineSemanticPlan("4 wheeler registrations", {
  fuelSegment: null,
  fuelType: null,
  fuelFilters: [],
  vehicleCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
  vehicleClasses: [],
  norms: [],
}, {
  ...normalized,
  selectedVehicleClasses: ["MOTOR CAR"],
  selectedVehicleCategories: [],
}, vocabulary);
assert.deepEqual(enforcedFourWheeler.selectedVehicleCategories, ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"]);
assert.deepEqual(enforcedFourWheeler.selectedVehicleClasses, []);

const cached = await decodeDashboardAiQuery("4 wheeler registrations in Delhi", vocabulary, {
  env,
  now: () => 2_000,
  fetchImpl: async () => { throw new Error("Cached query must not fetch."); },
});
assert.equal(cached.filters?.aiProvider, "Groq");
assert.equal(calls, 1);

resetDashboardAiStateForTests();
let coolingCalls = 0;
const successfulFetch = async () => {
  coolingCalls += 1;
  return successfulResponse();
};
await decodeDashboardAiQuery("first query", vocabulary, { env: { ...env, GROQ_AI_CACHE_TTL_MS: "0" }, now: () => 1_000, fetchImpl: successfulFetch });
const cooling = await decodeDashboardAiQuery("second query", vocabulary, { env: { ...env, GROQ_AI_CACHE_TTL_MS: "0" }, now: () => 1_001, fetchImpl: successfulFetch });
assert.equal(cooling.filters, null);
assert.match(cooling.warnings.join(" "), /cooling down/i);
assert.equal(coolingCalls, 1);

resetDashboardAiStateForTests();
let requestReserveCalls = 0;
const requestReserveFetch = async () => {
  requestReserveCalls += 1;
  return successfulResponse({
    rateHeaders: {
      "x-ratelimit-remaining-requests": "1",
      "x-ratelimit-reset-requests": "2m",
      "x-ratelimit-remaining-tokens": "10000",
      "x-ratelimit-reset-tokens": "1s",
    },
  });
};
await decodeDashboardAiQuery("request reserve one", vocabulary, {
  env: { ...env, GROQ_AI_CACHE_TTL_MS: "0" },
  now: () => 1_000,
  fetchImpl: requestReserveFetch,
});
assert.equal(dashboardGroqQuotaStateForTests().remainingRequests, 1);
const requestReserveBlocked = await decodeDashboardAiQuery("request reserve two", vocabulary, {
  env: { ...env, GROQ_AI_CACHE_TTL_MS: "0" },
  now: () => 31_001,
  fetchImpl: requestReserveFetch,
});
assert.equal(requestReserveBlocked.filters, null);
assert.match(requestReserveBlocked.warnings.join(" "), /quota reserve/i);
assert.match(requestReserveBlocked.warnings.join(" "), /1970-01-01T00:02:01\.000Z/);
assert.equal(requestReserveCalls, 1);
const requestReserveReset = await decodeDashboardAiQuery("request reserve after reset", vocabulary, {
  env: { ...env, GROQ_AI_CACHE_TTL_MS: "0" },
  now: () => 121_001,
  fetchImpl: async () => {
    requestReserveCalls += 1;
    return successfulResponse();
  },
});
assert.equal(requestReserveReset.filters?.aiProvider, "Groq", JSON.stringify({
  result: requestReserveReset,
  quota: dashboardGroqQuotaStateForTests(),
}));
assert.equal(requestReserveCalls, 2);

resetDashboardAiStateForTests();
let tokenReserveCalls = 0;
const tokenReserveFetch = async () => {
  tokenReserveCalls += 1;
  return successfulResponse({
    totalTokens: 100,
    rateHeaders: {
      "x-ratelimit-remaining-requests": "100",
      "x-ratelimit-reset-requests": "1h",
      "x-ratelimit-remaining-tokens": "124",
      "x-ratelimit-reset-tokens": "2m",
    },
  });
};
await decodeDashboardAiQuery("token reserve one", vocabulary, {
  env: { ...env, GROQ_AI_CACHE_TTL_MS: "0" },
  now: () => 1_000,
  fetchImpl: tokenReserveFetch,
});
assert.equal(dashboardGroqQuotaStateForTests().lastTotalTokens, 100);
const tokenReserveBlocked = await decodeDashboardAiQuery("token reserve two", vocabulary, {
  env: { ...env, GROQ_AI_CACHE_TTL_MS: "0" },
  now: () => 31_001,
  fetchImpl: tokenReserveFetch,
});
assert.equal(tokenReserveBlocked.filters, null);
assert.match(tokenReserveBlocked.warnings.join(" "), /quota reserve/i);
assert.match(tokenReserveBlocked.warnings.join(" "), /1970-01-01T00:02:01\.000Z/);
assert.equal(tokenReserveCalls, 1);
const tokenReserveReset = await decodeDashboardAiQuery("token reserve after reset", vocabulary, {
  env: { ...env, GROQ_AI_CACHE_TTL_MS: "0" },
  now: () => 121_001,
  fetchImpl: async () => {
    tokenReserveCalls += 1;
    return successfulResponse();
  },
});
assert.equal(tokenReserveReset.filters?.aiProvider, "Groq");
assert.equal(tokenReserveCalls, 2);

resetDashboardAiStateForTests();
let releaseFirstFetch;
let concurrentCalls = 0;
const firstFetchPending = new Promise((resolve) => {
  releaseFirstFetch = resolve;
});
const concurrentFetch = async () => {
  concurrentCalls += 1;
  await firstFetchPending;
  return successfulResponse();
};
const firstConcurrent = decodeDashboardAiQuery("concurrent first", vocabulary, {
  env: { ...env, GROQ_AI_CACHE_TTL_MS: "0" },
  now: () => 1_000,
  fetchImpl: concurrentFetch,
});
const secondConcurrent = await decodeDashboardAiQuery("concurrent second", vocabulary, {
  env: { ...env, GROQ_AI_CACHE_TTL_MS: "0" },
  now: () => 1_000,
  fetchImpl: concurrentFetch,
});
assert.equal(secondConcurrent.filters, null);
assert.match(secondConcurrent.warnings.join(" "), /cooling down/i);
assert.equal(concurrentCalls, 1);
releaseFirstFetch();
assert.equal((await firstConcurrent).filters?.aiProvider, "Groq");

resetDashboardAiStateForTests();
const rateLimited = await decodeDashboardAiQuery("rate limited query", vocabulary, {
  env,
  now: () => 10_000,
  fetchImpl: async () => ({ ok: false, status: 429, headers: headers({ "retry-after": "60" }) }),
});
assert.equal(rateLimited.filters, null);
assert.match(rateLimited.warnings.join(" "), /rate-limited/i);
assert.match(rateLimited.warnings.join(" "), /1970-01-01T00:05:10\.000Z/);
assert.equal(groqPauseFromWarnings(rateLimited.warnings, 10_000)?.kind, "rate_limit");
const blocked = await decodeDashboardAiQuery("next query", vocabulary, {
  env,
  now: () => 11_000,
  fetchImpl: async () => { throw new Error("Rate-limited provider must not retry."); },
});
assert.equal(blocked.filters, null);
assert.match(blocked.warnings.join(" "), /rate-limited/i);
assert.match(blocked.warnings.join(" "), /1970-01-01T00:05:10\.000Z/);

console.log("Groq dashboard query provider unit checks passed.");
