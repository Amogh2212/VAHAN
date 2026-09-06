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
const activeCases = corpus.cases.filter((item) => item.activationPhase <= 5);
const routed = activeCases.map((item) => {
  const interpretation = interpretDashboardQuery(item.query);
  return { item, interpretation, routing: classifyDashboardQueryRouting(item.query, interpretation) };
});

const exactCanonical = routed.filter(({ item }) => (
  item.routing.policy === "local_required" &&
  item.coverage.surface.includes("canonical") &&
  !item.coverage.surface.includes("approved_typo")
));
assert.ok(exactCanonical.length > 0);
assert.deepEqual(
  exactCanonical.filter(({ routing }) => routing.state !== "local").map(({ item, routing }) => ({ caseId: item.caseId, routing })),
  [],
  "100% of exact canonical queries must route locally.",
);

const unsupported = routed.filter(({ item }) => item.routing.policy === "local_reject");
assert.ok(unsupported.length > 0);
assert.deepEqual(
  unsupported.filter(({ routing }) => routing.state !== "reject").map(({ item, routing }) => ({ caseId: item.caseId, routing })),
  [],
  "100% of unsupported/unsafe queries must avoid AI and reject locally.",
);

const approvedSurface = routed.filter(({ item }) => item.routing.policy === "local_required" && (
  item.coverage.surface.some((surface) => ["approved_typo", "alias", "normalization", "word_order"].includes(surface)) ||
  item.coverage.combination === "legacy_50"
));
const approvedLocal = approvedSurface.filter(({ routing }) => routing.state === "local");
const deterministicCoverage = approvedSurface.length ? approvedLocal.length / approvedSurface.length : 0;
assert.ok(deterministicCoverage >= 0.95, `Approved spelling/shorthand/paraphrase coverage was ${(deterministicCoverage * 100).toFixed(1)}%.`);

for (const axis of ["G", "D", "F", "V", "N", "X"]) {
  assert.ok(activeCases.some((item) => item.coverage.axes.includes(axis)), `Missing supported dimension ${axis}.`);
}
assert.ok(activeCases.some((item) => item.coverage.combination === "pair"));
assert.ok(activeCases.some((item) => item.coverage.combination === "triple"));
assert.ok(activeCases.some((item) => item.coverage.combination === "full"));
assert.ok(activeCases.some((item) => item.coverage.surface.includes("multiple_typos")));
assert.ok(activeCases.some((item) => item.coverage.surface.includes("word_order")));
assert.ok(activeCases.some((item) => item.coverage.surface.includes("contradiction")));
assert.ok(activeCases.some((item) => item.coverage.surface.includes("unsupported_intent")));

const unusualQuery = "Show spark-fuel vehicle registrations in Maharashtra in January 2025.";
const providerFailures = [
  { label: "429", result: { filters: null, warnings: ["Groq is temporarily rate-limited."] } },
  { label: "timeout", result: { filters: null, warnings: ["Groq query decoding timed out."] } },
  { label: "malformed_json", result: { filters: null, warnings: ["Groq returned an invalid filter plan."] } },
  { label: "unavailable", result: { filters: null, warnings: ["Groq query decoding was unavailable."] } },
  {
    label: "low_confidence",
    result: {
      filters: {
        aiProvider: "Groq",
        supported: true,
        selectedFuelTypes: ["PETROL"],
        semanticConfidence: 0.4,
        metric: "registrations",
      },
      warnings: [],
    },
  },
  {
    label: "provider_rejected",
    result: {
      filters: {
        aiProvider: "Groq",
        supported: false,
        semanticConfidence: 0.95,
        metric: "registrations",
      },
      warnings: [],
    },
  },
];

let failureCalls = 0;
for (const scenario of providerFailures) {
  try {
    await queryData(
      { query: unusualQuery },
      {
        aiProvider: () => "groq",
        decodeAi: async () => {
          failureCalls += 1;
          return scenario.result;
        },
      },
    );
    assert.fail(`${scenario.label} must not fall back to a low-confidence result.`);
  } catch (error) {
    assert.equal(error.statusCode, 422, scenario.label);
    assert.equal(error.details?.code, "dashboard_query_clarification_required", scenario.label);
  }
}
assert.equal(failureCalls, providerFailures.length, "Each repair path must call its provider at most once.");

let exactCalls = 0;
const exactWhileDown = await queryData(
  { query: "Show BS VI diesel motor car registrations in Delhi in November 2025." },
  {
    aiProvider: () => "groq",
    decodeAi: async () => {
      exactCalls += 1;
      return { filters: null, warnings: ["Provider unavailable."] };
    },
  },
);
assert.equal(exactCalls, 0, "Exact queries must remain available while the provider is down.");
assert.equal(exactWhileDown.filters.aiProvider ?? null, null);
assert.equal(
  exactWhileDown.summary.total,
  exactWhileDown.rows.reduce((sum, row) => sum + Number(row.vehicle_count), 0),
);

console.log(JSON.stringify({
  passed: true,
  activeContractCases: activeCases.length,
  exactCanonicalLocalRate: exactCanonical.length ? 1 : 0,
  unsupportedLocalRejectRate: unsupported.length ? 1 : 0,
  approvedDeterministicRate: Number(deterministicCoverage.toFixed(4)),
  providerFailureCases: providerFailures.length,
  providerCallsForExactQuery: exactCalls,
}, null, 2));
