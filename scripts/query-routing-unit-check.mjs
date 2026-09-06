import assert from "node:assert/strict";
import fs from "node:fs";

process.env.DATABASE_URL = "";
process.env.PUBLIC_DASHBOARD_DISABLE_LIVE_REFRESH = "1";
process.env.NODE_ENV = "test";
process.env.TEST_CURRENT_MONTH = "2026-07";

const {
  classifyDashboardQueryRouting,
  interpretDashboardQuery,
  queryData,
} = await import("../server.mjs");

const corpus = JSON.parse(fs.readFileSync(new URL("../data/query-tests/dashboard-query-contract-v1.json", import.meta.url), "utf8"));
const routingMismatches = [];
for (const item of corpus.cases.filter((candidate) => candidate.activationPhase <= 4)) {
  const interpretation = interpretDashboardQuery(item.query);
  const routing = classifyDashboardQueryRouting(item.query, interpretation);
  const valid = item.routing.policy === "local_required"
    ? routing.state === "local"
    : item.routing.policy === "local_reject"
      ? routing.state === "reject"
      : routing.state !== "reject";
  if (!valid) routingMismatches.push({ caseId: item.caseId, policy: item.routing.policy, routing });
}
assert.deepEqual(routingMismatches, [], "Cumulative Phase 1-4 routing policies must remain valid.");

for (const item of corpus.cases.filter((candidate) => candidate.activationPhase === 5)) {
  const routing = classifyDashboardQueryRouting(item.query, interpretDashboardQuery(item.query));
  assert.equal(routing.state, "repair", `${item.caseId} should require one repair call.`);
}

const embeddedStateCode = interpretDashboardQuery("grouped vehicle registrations in Jan 2024");
assert.equal(embeddedStateCode.filters.state, null, "UP must not match inside grouped.");
assert.equal(
  classifyDashboardQueryRouting("grouped vehicle registrations in Jan 2024", embeddedStateCode).state,
  "repair",
  "An unresolved word must not silently broaden into an all-location total.",
);

let decoderCalls = 0;
const forbiddenDecoder = async () => {
  decoderCalls += 1;
  throw new Error("The decoder must not be called for this route.");
};
const groqDependencies = { aiProvider: () => "groq", decodeAi: forbiddenDecoder };

const exact = await queryData(
  { query: "Show diesel motor car registrations in Delhi in November 2025." },
  groqDependencies,
);
assert.equal(decoderCalls, 0);
assert.deepEqual(exact.filters.selectedFuelTypes, ["DIESEL"]);
assert.deepEqual(exact.filters.selectedVehicleClasses, ["MOTOR CAR"]);
assert.equal(exact.filters.aiProvider ?? null, null);

const safeTypo = await queryData(
  { query: "Show petorl vehicle registrations in Maharashtra in January 2025." },
  groqDependencies,
);
assert.equal(decoderCalls, 0);
assert.deepEqual(safeTypo.filters.selectedFuelTypes, ["PETROL"]);

const relativeDate = await queryData(
  { query: "EV registrations in Maharashtra last month" },
  groqDependencies,
);
assert.equal(decoderCalls, 0, "A deterministic relative date must not call AI.");
assert.equal(relativeDate.filters.from, "2026-06");
assert.equal(relativeDate.filters.to, "2026-06");

async function expectedError(query, expectedStatus, expectedCode, dependencies = groqDependencies) {
  try {
    await queryData({ query }, dependencies);
    assert.fail(`Expected ${expectedCode}: ${query}`);
  } catch (error) {
    assert.equal(error.statusCode, expectedStatus, query);
    assert.equal(error.details?.code, expectedCode, query);
    return error;
  }
}

await expectedError(
  "Compare vehicle registrations in Maharashtra in January 2025 versus February 2025.",
  422,
  "unsupported_dashboard_query",
);
await expectedError(
  "Show EV diesel registrations in Maharashtra in January 2025.",
  422,
  "conflicting_fuels",
);
await expectedError(
  "Show vehicle registrations in Maharashtra in January 2099.",
  400,
  "date_conflict",
);
assert.equal(decoderCalls, 0, "Unsupported, conflicting, and future queries must not call AI.");

await expectedError(
  "Show vehicle registrations in xangalore in January 2025.",
  422,
  "dashboard_query_clarification_required",
  { aiProvider: () => "none", decodeAi: forbiddenDecoder },
);
assert.equal(decoderCalls, 0);

const unusualQuery = "Show spark-fuel vehicle registrations in Maharashtra in January 2025.";
let repairCalls = 0;
await expectedError(
  unusualQuery,
  422,
  "dashboard_query_clarification_required",
  {
    aiProvider: () => "groq",
    decodeAi: async () => {
      repairCalls += 1;
      return { filters: null, warnings: ["Repair provider unavailable."] };
    },
  },
);
assert.equal(repairCalls, 1, "A recoverable query may call the provider at most once.");

const repaired = await queryData(
  { query: unusualQuery },
  {
    aiProvider: () => "groq",
    decodeAi: async () => {
      repairCalls += 1;
      return {
        filters: {
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
          semanticExplanation: "Mapped the unusual fuel wording to PETROL.",
        },
        warnings: [],
      };
    },
  },
);
assert.equal(repairCalls, 2);
assert.deepEqual(repaired.filters.selectedFuelTypes, ["PETROL"]);
assert.equal(repaired.filters.aiProvider, "Groq");
assert.equal(repaired.filters.correctedByAi, true);
assert.ok(repaired.warnings.some((warning) => /helped interpret/i.test(warning)));
assert.equal(
  repaired.summary.total,
  repaired.rows.reduce((sum, row) => sum + Number(row.vehicle_count), 0),
  "AI repairs may choose filters, but totals must remain data-derived.",
);

console.log(JSON.stringify({
  passed: true,
  corpusRoutingCases: corpus.cases.filter((candidate) => candidate.activationPhase <= 5).length,
  exactProviderCalls: decoderCalls,
  repairProviderCalls: repairCalls,
  repairedTotal: repaired.summary.total,
}, null, 2));
