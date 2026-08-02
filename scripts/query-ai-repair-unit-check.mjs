import assert from "node:assert/strict";
import { buildRtoCatalogFromRows } from "../lib/rto-resolver.mjs";

process.env.DATABASE_URL = "";
process.env.VAHAN_DISABLE_LIVE_REFRESH = "1";
process.env.NODE_ENV = "test";
process.env.TEST_CURRENT_MONTH = "2026-07";

const {
  interpretDashboardQuery,
  queryData,
  validateDashboardAiRepair,
  validateFinalDashboardFilters,
} = await import("../server.mjs");

const vocabulary = Object.freeze({
  fuelTypes: ["DIESEL", "PETROL", "ELECTRIC(BOV)", "PURE EV"],
  vehicleGroups: ["TWO WHEELER", "THREE WHEELER"],
  vehicleClasses: ["MOTOR CAR", "BUS"],
  vehicleCategories: ["LIGHT MOTOR VEHICLE", "TWO WHEELER(NT)", "TWO WHEELER(T)"],
  norms: ["BHARAT STAGE IV", "BHARAT STAGE VI"],
});
const rows = [
  { state: "Karnataka", rto: "KA-01 Bengaluru Central" },
  { state: "Karnataka", rto: "KA-02 Bengaluru West" },
  { state: "Karnataka", rto: "KA-03 Mangalore Central" },
];
const catalog = buildRtoCatalogFromRows(rows);

function plan(overrides = {}) {
  return {
    aiProvider: "Groq",
    supported: true,
    selectedFuelTypes: [],
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
    semanticExplanation: "Proposed canonical dashboard filters only.",
    ...overrides,
  };
}

function validate(raw, query = "Show spark-fuel vehicle registrations in Maharashtra in January 2025.") {
  return validateDashboardAiRepair(raw, {
    query,
    interpretation: interpretDashboardQuery(query),
    vocabulary,
    catalog,
    rows,
  });
}

const valid = validate(plan({ selectedFuelTypes: ["petrol"] }));
assert.equal(valid.valid, true, JSON.stringify(valid.issues));
assert.deepEqual(valid.filters.selectedFuelTypes, ["PETROL"]);
assert.equal(valid.filters.state, "Maharashtra");

const invalidMixedLabel = validate(plan({ selectedFuelTypes: ["PETROL", "MADE UP FUEL"] }));
assert.equal(invalidMixedLabel.valid, false);
assert.equal(invalidMixedLabel.filters, null, "One invalid label must reject the entire repair.");
assert.ok(invalidMixedLabel.issues.includes("selectedFuelTypes_contains_unknown_label"));

const exactFuelQuery = "Show diesel spark-fuel vehicle registrations in Maharashtra in January 2025.";
const exactFuelConflict = validate(plan({ selectedFuelTypes: ["PETROL"] }), exactFuelQuery);
assert.equal(exactFuelConflict.valid, false);
assert.ok(exactFuelConflict.issues.includes("selectedFuelTypes_conflicts_with_exact_deterministic_match"));
assert.equal(validate(plan({ selectedFuelTypes: ["DIESEL"] }), exactFuelQuery).valid, true);

const exactClassQuery = "Show motor car mystery-type registrations in Maharashtra in January 2025.";
const exactClassConflict = validate(plan({ selectedVehicleClasses: ["BUS"] }), exactClassQuery);
assert.equal(exactClassConflict.valid, false);
assert.ok(exactClassConflict.issues.includes("selectedVehicleClasses_conflicts_with_exact_deterministic_match"));

const exactLocationQuery = "Show mystery-fuel vehicle registrations in Delhi in January 2025.";
const exactLocationConflict = validate(plan({ state: "Karnataka" }), exactLocationQuery);
assert.equal(exactLocationConflict.valid, false);
assert.ok(exactLocationConflict.issues.includes("state_conflicts_with_exact_deterministic_location"));

const exactDateConflict = validate(plan({ from: "2025-02", to: "2025-02" }));
assert.equal(exactDateConflict.valid, false);
assert.ok(exactDateConflict.issues.includes("from_conflicts_with_exact_deterministic_date"));
assert.ok(exactDateConflict.issues.includes("to_conflicts_with_exact_deterministic_date"));

for (const [raw, issue] of [
  [plan({ selectedVehicleGroups: "TWO WHEELER" }), "selectedVehicleGroups_must_be_an_array"],
  [plan({ semanticConfidence: 0.4 }), "repair_confidence_too_low_or_missing"],
  [plan({ semanticConfidence: undefined }), "repair_confidence_too_low_or_missing"],
  [plan({ supported: false }), "repair_must_explicitly_support_query"],
  [plan({ state: "Invented State" }), "state_is_not_an_official_dashboard_state"],
  [plan({ total: 12345 }), "repair_must_not_supply_registration_facts"],
  [plan({ selectedFuelTypes: ["PETROL"], excludedFuelTypes: ["PETROL"] }), "fuel_is_both_selected_and_excluded"],
  [plan({ selectedVehicleGroups: ["TWO WHEELER"], selectedVehicleClasses: ["MOTOR CAR"] }), "broad_vehicle_group_conflicts_with_explicit_vehicle_filter"],
]) {
  const result = validate(raw);
  assert.equal(result.valid, false, issue);
  assert.ok(result.issues.includes(issue), `${issue}: ${result.issues}`);
}

const repairedRtoQuery = "Show mystery-fuel vehicle registrations around garden city in January 2025.";
const repairedRto = validate(plan({
  state: "Karnataka",
  rtoText: "KA-01 Bengaluru Central",
  locationText: "KA-01 Bengaluru Central",
  locationType: "rto",
}), repairedRtoQuery);
assert.equal(repairedRto.valid, true, JSON.stringify(repairedRto.issues));
assert.equal(repairedRto.filters.state, "Karnataka");
assert.equal(repairedRto.filters.rto, "KA-01 Bengaluru Central");

const ambiguousRto = validate(plan({
  state: "Karnataka",
  rtoText: "Central",
  locationText: "Central",
  locationType: "rto",
}), repairedRtoQuery);
assert.equal(ambiguousRto.valid, false);
assert.ok(ambiguousRto.issues.includes("rto_repair_is_ambiguous"));

const finalInvalid = validateFinalDashboardFilters({
  selectedFuelTypes: ["PETROL", "ELECTRIC(BOV)"],
  excludedFuelTypes: [],
  selectedVehicleGroups: [],
  excludedVehicleGroups: [],
  selectedVehicleClasses: [],
  excludedVehicleClasses: [],
  selectedVehicleCategories: [],
  excludedVehicleCategories: [],
  selectedNorms: [],
  excludedNorms: [],
  vehicleClasses: [],
  vehicleCategories: [],
  norms: [],
  fuelFilters: [],
  state: "Maharashtra",
  from: "2025-01",
  to: "2025-01",
}, vocabulary);
assert.equal(finalInvalid.valid, false);
assert.ok(finalInvalid.issues.includes("selected_fuels_mix_battery_and_non_battery_meanings"));

let rejectedRepairCalls = 0;
async function clarificationFor(query, filters) {
  try {
    await queryData(
      { query },
      {
        aiProvider: () => "groq",
        decodeAi: async () => {
          rejectedRepairCalls += 1;
          return { filters, warnings: [] };
        },
      },
    );
    assert.fail("An invalid repair must not execute data retrieval.");
  } catch (error) {
    assert.equal(error.statusCode, 422);
    assert.equal(error.details?.code, "dashboard_query_clarification_required");
    assert.equal(error.details?.routingReason, "repair_validation_failed");
  }
}

await clarificationFor(
  "Show spark-fuel vehicle registrations in Maharashtra in January 2025.",
  plan({ selectedFuelTypes: ["PETROL", "MADE UP FUEL"] }),
);
await clarificationFor(exactFuelQuery, plan({ selectedFuelTypes: ["PETROL"] }));
assert.equal(rejectedRepairCalls, 2);

console.log(JSON.stringify({
  passed: true,
  strictRepairCases: 17,
  invalidRepairApiCases: rejectedRepairCalls,
  resolvedRto: repairedRto.filters.rto,
}, null, 2));
