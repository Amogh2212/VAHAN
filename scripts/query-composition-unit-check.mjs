import assert from "node:assert/strict";
import { interpretDashboardQuery } from "../server.mjs";

const wordOrderQueries = [
  "BS VI diesel motor cars in Delhi during November 2025.",
  "Delhi November 2025 BS VI motor car diesel registrations.",
  "Give me diesel BS VI motor car registrations for Delhi in Nov 2025.",
];

function canonicalSnapshot(interpretation) {
  const filters = interpretation.filters;
  return {
    state: filters.state,
    rto: filters.rto,
    from: filters.from,
    to: filters.to,
    selectedFuelTypes: filters.selectedFuelTypes,
    selectedVehicleGroups: filters.selectedVehicleGroups,
    selectedVehicleClasses: filters.selectedVehicleClasses,
    selectedVehicleCategories: filters.selectedVehicleCategories,
    selectedNorms: filters.selectedNorms,
    excludedFuelTypes: filters.excludedFuelTypes,
  };
}

const expectedWordOrderSnapshot = {
  state: "Delhi",
  rto: null,
  from: "2025-11",
  to: "2025-11",
  selectedFuelTypes: ["DIESEL"],
  selectedVehicleGroups: [],
  selectedVehicleClasses: ["MOTOR CAR"],
  selectedVehicleCategories: [],
  selectedNorms: ["BHARAT STAGE VI"],
  excludedFuelTypes: [],
};

for (const query of wordOrderQueries) {
  const interpretation = interpretDashboardQuery(query);
  assert.deepEqual(canonicalSnapshot(interpretation), expectedWordOrderSnapshot, `Word-order composition failed: ${query}`);
  assert.deepEqual(interpretation.conflicts, [], `Unexpected conflict: ${query}`);
  assert.deepEqual(interpretation.unknownTokens, [], `Unexpected unknown token: ${query}`);
  assert.equal(interpretation.confidence, 1, `Exact query must have diagnostic confidence 1: ${query}`);
}

const requiredFields = [
  "filters",
  "recognizedTokens",
  "ignoredTokens",
  "unknownTokens",
  "fuzzyMatches",
  "conflicts",
  "evidence",
  "confidence",
];
const fullInterpretation = interpretDashboardQuery(wordOrderQueries[0]);
assert.deepEqual(Object.keys(fullInterpretation), requiredFields);
for (const field of ["recognizedTokens", "ignoredTokens", "unknownTokens", "fuzzyMatches", "conflicts", "evidence"]) {
  assert.ok(Array.isArray(fullInterpretation[field]), `${field} must be an array.`);
}
assert.ok(fullInterpretation.evidence.some((item) => item.dimension === "location" && item.canonicalValues.includes("Delhi")));
assert.ok(fullInterpretation.evidence.some((item) => item.dimension === "date" && item.canonicalValues.includes("2025-11")));
assert.ok(fullInterpretation.evidence.some((item) => item.dimension === "fuel" && item.canonicalValues.includes("DIESEL")));
assert.ok(fullInterpretation.evidence.some((item) => item.dimension === "vehicleClass" && item.canonicalValues.includes("MOTOR CAR")));
assert.ok(fullInterpretation.evidence.some((item) => item.dimension === "norm" && item.canonicalValues.includes("BHARAT STAGE VI")));

const conflictCases = [
  {
    query: "Show EV diesel registrations in Maharashtra in January 2025.",
    code: "conflicting_fuels",
    statusCode: 422,
  },
  {
    query: "Show car and bus registrations in Maharashtra in January 2025.",
    code: "conflicting_vehicle_classes",
    statusCode: 422,
  },
  {
    query: "Show petrol registrations excluding petrol in Maharashtra in January 2025.",
    code: "included_and_excluded",
    statusCode: 422,
  },
  {
    query: "Show vehicle registrations excluding two-wheelers in Maharashtra in January 2025.",
    code: "unsupported_broad_group_exclusion",
    statusCode: 400,
  },
  {
    query: "Show vehicle registrations in Pune and Mumbai during January 2025.",
    code: "location_conflict",
    statusCode: 422,
  },
];

for (const item of conflictCases) {
  const conflict = interpretDashboardQuery(item.query).conflicts.find((candidate) => candidate.code === item.code);
  assert.ok(conflict, `Expected ${item.code}: ${item.query}`);
  assert.equal(conflict.statusCode, item.statusCode, `Unexpected status for ${item.code}.`);
}

const partialFuelExclusion = interpretDashboardQuery("Show EV registrations excluding PURE EV in Delhi in January 2025.");
assert.deepEqual(partialFuelExclusion.conflicts, [], "A subset exclusion must not become a contradiction.");
assert.deepEqual(partialFuelExclusion.filters.selectedFuelTypes, ["ELECTRIC(BOV)"], "Exclusions must apply after positive filters.");
assert.deepEqual(partialFuelExclusion.filters.excludedFuelTypes, ["PURE EV"]);

const refinedGroupExclusion = interpretDashboardQuery("Show registrations excluding two-wheeler transport in Delhi in January 2025.");
assert.ok(!refinedGroupExclusion.conflicts.some((item) => item.code === "unsupported_broad_group_exclusion"));
assert.deepEqual(refinedGroupExclusion.filters.excludedVehicleCategories, ["TWO WHEELER(T)"]);

const explicitClassPrecedence = interpretDashboardQuery("Show motor car two-wheeler registrations in Delhi in January 2025.");
assert.deepEqual(explicitClassPrecedence.filters.selectedVehicleGroups, [], "Explicit class/category filters must suppress broad group inference.");
assert.deepEqual(explicitClassPrecedence.filters.selectedVehicleClasses, ["MOTOR CAR"]);

const numericDate = interpretDashboardQuery("Show vehicle registrations in Delhi in 2025-01.");
assert.deepEqual(numericDate.unknownTokens, [], "A numeric month must be fully recognized.");
assert.equal(numericDate.filters.from, "2025-01");
assert.equal(numericDate.filters.to, "2025-01");

const fuzzyEvidence = interpretDashboardQuery("Show petorl motor car registrations in Delhi in January 2025.");
assert.equal(fuzzyEvidence.fuzzyMatches.length, 1);
assert.equal(fuzzyEvidence.fuzzyMatches[0].text, "petorl", "Fuzzy evidence must preserve the original normalized source token.");
assert.deepEqual(fuzzyEvidence.fuzzyMatches[0].canonicalValues, ["PETROL"]);

const exactBeatsFuzzy = interpretDashboardQuery("Show petrol petorl motor car registrations in Delhi in January 2025.");
assert.deepEqual(exactBeatsFuzzy.fuzzyMatches, [], "An exact vocabulary match must suppress fuzzy fallback in the same dimension.");
assert.deepEqual(exactBeatsFuzzy.filters.selectedFuelTypes, ["PETROL"]);

const compoundExclusionCases = [
  {
    query: "Show vehicle registrations without plug in hybrid in Delhi in January 2025.",
    field: "excludedFuelTypes",
    expected: ["PLUG-IN HYBRID EV"],
  },
  {
    query: "Show vehicle registrations without trailer for personal use in Delhi in January 2025.",
    field: "excludedVehicleClasses",
    expected: ["TRAILER FOR PERSONAL USE"],
  },
  {
    query: "Show vehicle registrations without motorcycle used for hire in Delhi in January 2025.",
    field: "excludedVehicleClasses",
    expected: ["MOTOR CYCLE/SCOOTER-USED FOR HIRE"],
  },
];

for (const item of compoundExclusionCases) {
  const interpretation = interpretDashboardQuery(item.query);
  assert.deepEqual(interpretation.conflicts, [], `Unexpected conflict: ${item.query}`);
  assert.deepEqual(interpretation.filters[item.field], item.expected, `Compound exclusion was truncated: ${item.query}`);
}

console.log(JSON.stringify({
  passed: true,
  wordOrderCases: wordOrderQueries.length,
  conflictCases: conflictCases.length,
  compoundExclusionCases: compoundExclusionCases.length,
  evidenceDimensions: [...new Set(fullInterpretation.evidence.map((item) => item.dimension))].sort(),
}, null, 2));
