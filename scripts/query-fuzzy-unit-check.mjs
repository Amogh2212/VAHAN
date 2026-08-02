import assert from "node:assert/strict";
import { inspectDashboardFuzzyMatch, interpretDashboardQuery } from "../server.mjs";

const BATTERY_EV = ["ELECTRIC(BOV)", "PURE EV"];
const TWO_WHEELER = ["TWO WHEELER(NT)", "TWO WHEELER(T)"];

function interpretation(query) {
  return interpretDashboardQuery(`Show ${query} registrations in Maharashtra in January 2025.`);
}

const petrolTypo = interpretation("petorl vehicle");
assert.deepEqual(petrolTypo.filters.selectedFuelTypes, ["PETROL"]);
assert.deepEqual(petrolTypo.unknownTokens, []);
assert.ok(petrolTypo.fuzzyMatches.some((match) => (
  match.text === "petorl" &&
  match.matchedAlias === "petrol" &&
  match.canonicalValues.includes("PETROL") &&
  match.distance === 2
)));

const electricTypo = interpretation("electirc vehicle");
assert.deepEqual(electricTypo.filters.selectedFuelTypes, BATTERY_EV);
assert.deepEqual(electricTypo.unknownTokens, []);
assert.deepEqual(
  [...new Set(electricTypo.fuzzyMatches.filter((match) => match.text === "electirc").flatMap((match) => match.canonicalValues))].sort(),
  [...BATTERY_EV].sort(),
);

const subjectTypo = interpretDashboardQuery("Show vehicals registrations in Maharashtra in January 2025.");
assert.deepEqual(subjectTypo.unknownTokens, []);
assert.ok(subjectTypo.fuzzyMatches.some((match) => match.dimension === "subject" && match.text === "vehicals"));

const motorCarTypo = interpretation("motar car");
assert.deepEqual(motorCarTypo.filters.selectedVehicleClasses, ["MOTOR CAR"]);
assert.deepEqual(motorCarTypo.unknownTokens, []);
assert.ok(motorCarTypo.fuzzyMatches.some((match) => match.text === "motar" && match.matchedAlias === "motor"));

const twoWheelerTypo = interpretation("two wheelr vehicle");
assert.deepEqual(twoWheelerTypo.filters.selectedVehicleCategories, TWO_WHEELER);
assert.ok(twoWheelerTypo.fuzzyMatches.some((match) => match.text === "two wheelr"));

for (const [source, state] of [["Maharastra", "Maharashtra"], ["Karnatak", "Karnataka"], ["Karnatka", "Karnataka"]]) {
  const result = interpretDashboardQuery(`Show vehicle registrations in ${source} in January 2025.`);
  assert.equal(result.filters.state, state, `${source} should resolve to ${state}`);
  assert.deepEqual(result.unknownTokens, []);
}

const safeCityTypo = interpretDashboardQuery("Show vehicle registrations in Bangalor in January 2025.");
assert.equal(safeCityTypo.filters.state, "Karnataka");
assert.equal(safeCityTypo.filters.rto, "bengaluru");
assert.deepEqual(safeCityTypo.unknownTokens, []);
assert.ok(safeCityTypo.fuzzyMatches.some((match) => (
  match.text === "bangalor" && match.matchedAlias === "bangalore" && match.candidateGap === 1
)));

const ambiguousLocation = interpretDashboardQuery("Show vehicle registrations in xangalore in January 2025.");
assert.equal(ambiguousLocation.filters.state, null);
assert.equal(ambiguousLocation.filters.rto, null);
const locationConflict = ambiguousLocation.conflicts.find((conflict) => conflict.code === "ambiguous_fuzzy_match");
assert.ok(locationConflict);
assert.ok(locationConflict.values.some((value) => value.includes("bangalore")));
assert.ok(locationConflict.values.some((value) => value.includes("mangalore")));

const ambiguousClass = inspectDashboardFuzzyMatch("ambulence bulldoser", "vehicleClass");
assert.deepEqual(ambiguousClass.matches, []);
assert.deepEqual(
  ambiguousClass.ambiguity.candidates.flatMap((candidate) => candidate.canonicalValues).sort(),
  ["AMBULANCE", "BULLDOZER"],
);

for (const [word, field] of [["patrol", "selectedFuelTypes"], ["better", "selectedFuelTypes"], ["batter", "selectedFuelTypes"], ["forklike", "selectedVehicleClasses"], ["scooted", "selectedVehicleClasses"]]) {
  const result = interpretation(`${word} vehicle`);
  assert.deepEqual(result.filters[field] ?? [], [], `${word} must not create ${field}`);
  assert.ok(result.unknownTokens.includes(word), `${word} must remain unresolved`);
}

for (const token of ["EVV", "CNH", "BS7", "3x", "MHH", "MH-1Z"]) {
  const result = interpretation(`${token} vehicle`);
  assert.deepEqual(result.fuzzyMatches, [], `${token} must be protected from fuzzy matching`);
}

const exactRto = interpretDashboardQuery("Show MH-12 vehicle registrations in January 2025.");
assert.equal(exactRto.filters.state, "Maharashtra");
assert.equal(exactRto.filters.rto, "MH-12");

const exactWins = interpretation("petrol petorl vehicle");
assert.deepEqual(exactWins.filters.selectedFuelTypes, ["PETROL"]);
assert.ok(!exactWins.fuzzyMatches.some((match) => match.dimension === "fuel"));

const exactLocationWins = interpretDashboardQuery("Show vehicle registrations in Delhi near Bangalor in January 2025.");
assert.equal(exactLocationWins.filters.state, "Delhi");
assert.equal(exactLocationWins.filters.rto, null);
assert.ok(!exactLocationWins.fuzzyMatches.some((match) => match.dimension === "location"));

console.log(JSON.stringify({
  passed: true,
  approvedCorrections: 9,
  ambiguityCases: 2,
  falsePositiveGuards: 5,
  protectedTokenCases: 6,
}, null, 2));
