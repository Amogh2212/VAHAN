import assert from "node:assert/strict";
import { dashboardPayload } from "../server.mjs";
import { registrationFuelBreakdown, selectRegistrationAnswerRows } from "../lib/registration-answer-evidence.mjs";

// Measured Noida UP16 evidence from the 4 October 2026 source/cache comparison.
const aggregates = [17615, 13474, 14302, 14614, 14696, 14179, 16241, 15592, 17289, 963];
const olderDetail = [17602, 13474, 14281, 14596, 14589, 13787, 833];
const filters = { state: "Uttar Pradesh", rto: "Noida - UP16", from: "2026-01", to: "2026-10" };
const base = {
  year: 2026, state: filters.state, rto: filters.rto, fuel_segment: "NON_EV",
  fuel_filter: "ALL", vehicle_category_filter: "ALL", norms_filter: "ALL", vehicle_class_filter: "ALL",
};
const totalRows = aggregates.map((vehicle_count, index) => ({ ...base, month: index + 1, fuel_type: "ALL", vehicle_count, scraped_at: "2026-10-04T12:58:25.174Z" }));
const detailedRows = olderDetail.map((vehicle_count, index) => ({ ...base, month: index + 1, fuel_type: "PETROL", vehicle_count, scraped_at: "2026-07-03T00:00:00Z" }));
const overlapping = [...totalRows, ...detailedRows];
assert.equal(overlapping.reduce((sum, row) => sum + row.vehicle_count, 0), 228127, "fixture must reproduce the reported double-counted total");
for (const preFiltered of [false, true]) {
  for (const rows of [overlapping, [...overlapping].reverse(), [...detailedRows, ...totalRows, ...totalRows]]) {
    for (const liveRefresh of [null, { status: "complete", requiredMonths: ["2026-10"] }]) {
      const payload = dashboardPayload({ filters, rows, missingMonths: [], preFiltered, liveRefresh });
      assert.equal(payload.summary.total, 138965, "CSV, database and refresh responses must share the same non-overlapping total");
      assert.deepEqual(payload.trend.map((item) => item.count), aggregates);
      assert.equal(payload.summary.monthlyAverage, 13897);
      assert.equal(payload.summary.peakMonthCount, 17615);
      assert.equal(payload.rows.length, 10);
      assert.deepEqual(payload.fuelBreakdown, [], "older fuel snapshots must not be presented as the fresh period's composition");
    }
  }
}
const oldTotal = { ...totalRows[0], scraped_at: "2026-09-01T00:00:00Z", vehicle_count: 17500 };
assert.equal(selectRegistrationAnswerRows([oldTotal, totalRows[0], detailedRows[0]])[0].vehicle_count, 17615);
assert.equal(selectRegistrationAnswerRows([oldTotal, { ...totalRows[0], fuel_type: "all", fuel_segment: "ALL" }]).length, 1, "an aggregate is one scope total regardless of case or the scraper's segment label");
assert.deepEqual(selectRegistrationAnswerRows(selectRegistrationAnswerRows(overlapping)), selectRegistrationAnswerRows(overlapping), "normalization must be idempotent");
const partialDetails = [{ ...detailedRows[0], vehicle_count: 10 }];
assert.equal(selectRegistrationAnswerRows([...partialDetails, totalRows[0]])[0].vehicle_count, 17615, "partial fuel coverage must never replace an authoritative total");
const detailsOnly = [
  { ...base, month: 1, fuel_type: "PETROL", vehicle_count: 10 },
  { ...base, month: 1, fuel_type: "DIESEL", vehicle_count: 20 },
];
assert.equal(selectRegistrationAnswerRows(detailsOnly).reduce((sum, row) => sum + row.vehicle_count, 0), 30);
assert.deepEqual(registrationFuelBreakdown(detailsOnly), [{ fuelType: "DIESEL", count: 20 }, { fuelType: "PETROL", count: 10 }]);
assert.deepEqual(registrationFuelBreakdown([...detailsOnly, totalRows[1]]), [], "mixed monthly coverage must not look like a complete-period fuel split");
assert.deepEqual(registrationFuelBreakdown([totalRows[0]], [{ fuelType: "PETROL", count: 17615 }]), [{ fuelType: "PETROL", count: 17615 }]);
assert.deepEqual(registrationFuelBreakdown([totalRows[0]], [{ fuelType: "PETROL", count: 17602 }]), [], "separate fuel evidence must reconcile exactly to the displayed total");
assert.deepEqual(registrationFuelBreakdown([totalRows[0]], [{ fuelType: "ALL", count: 17615 }]), []);
const scopedRows = [totalRows[0],
  { ...detailedRows[0], vehicle_category_filter: "MOTOR CAR" },
  { ...detailedRows[0], state: "Maharashtra", rto: "PUNE - MH12" },
  { ...detailedRows[0], rto: "GHAZIABAD - UP14" },
];
assert.equal(selectRegistrationAnswerRows(scopedRows).length, 4, "selection must preserve different offices and exact filter contexts");
const aliases = selectRegistrationAnswerRows([totalRows[0], { ...detailedRows[0], rto: "Noida - UP16( 13-NOV-2017 )" }]);
assert.equal(aliases.length, 1, "legacy and current labels must use the same office identity");
const explicit = dashboardPayload({ filters: { ...filters, from: "2026-01", to: "2026-01", selectedFuelTypes: ["PETROL"], fuelFilters: ["PETROL"] }, rows: [totalRows[0], ...detailsOnly.map((row) => ({ ...row, fuel_filter: "PETROL" }))], missingMonths: [] });
assert.equal(explicit.summary.total, 10, "explicit fuel queries must preserve their exact scope");
console.log("Registration answer evidence checks passed: exact Noida regression, CSV/database/refresh parity, duplicate/order invariance, partial detail, scope separation and truthful fuel charts.");
