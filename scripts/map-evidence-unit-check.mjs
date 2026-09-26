import assert from "node:assert/strict";
import { auditMapStateEvidence, MAP_EV_FUEL_CONTEXT } from "../lib/map-evidence.mjs";

const row = (month, fuel_type, vehicle_count, extra = {}) => ({
  year: 2026, month, state: "Uttar Pradesh", rto: "All Vahan4 Running Office",
  fuel_filter: "ALL", vehicle_category_filter: "ALL", norms_filter: "ALL", vehicle_class_filter: "ALL",
  fuel_type, vehicle_count, scraped_at: "2026-02-02T12:00:00.000Z", ...extra,
});

const rows = [
  row(1, "ALL", 100), row(1, "ELECTRIC(BOV)", 10), row(1, "PURE EV", 5),
  row(1, "STRONG HYBRID EV", 3),
  row(1, "ALL", 70, { rto: "Noida" }), row(1, "ELECTRIC(BOV)", 9, { rto: "Noida" }),
  row(2, "ALL", 120),
];
const options = { states: ["Uttar Pradesh"], now: new Date("2026-02-02T12:01:00.000Z") };
const [incomplete] = auditMapStateEvidence(rows, { ...options, from: "2026-01", to: "2026-02" });
assert.equal(incomplete.status, "incomplete");
assert.equal(incomplete.total, null);
assert.equal(incomplete.evTotal, null);
assert.deepEqual(incomplete.missingMonths.map((item) => item.month), ["2026-02"]);
assert.equal(incomplete.months[0].ev, 15, "RTO and hybrid rows must not inflate battery EV totals");

rows.push(row(2, "ELECTRIC(BOV)", 12, { fuel_filter: MAP_EV_FUEL_CONTEXT }));
rows.push(row(2, "PURE EV", 6, { fuel_filter: MAP_EV_FUEL_CONTEXT }));
const [complete] = auditMapStateEvidence(rows, { ...options, from: "2026-01", to: "2026-02" });
assert.equal(complete.status, "complete");
assert.equal(complete.total, 220);
assert.equal(complete.evTotal, 33);

const [impossible] = auditMapStateEvidence([
  row(2, "ALL", 120),
  row(2, "ELECTRIC(BOV)", 130, { fuel_filter: MAP_EV_FUEL_CONTEXT }),
  row(2, "PURE EV", 6, { fuel_filter: MAP_EV_FUEL_CONTEXT }),
], { ...options, from: "2026-02", to: "2026-02" });
assert.deepEqual(impossible.missingMonths[0].issues, ["ev_exceeds_total"]);

const [stale] = auditMapStateEvidence([
  row(9, "ALL", 100, { scraped_at: "2026-09-07T12:00:00.000Z" }),
  row(9, "ELECTRIC(BOV)", 10, { scraped_at: "2026-09-26T12:00:00.000Z" }),
  row(9, "PURE EV", 5, { scraped_at: "2026-09-26T12:00:00.000Z" }),
], { states: ["Uttar Pradesh"], from: "2026-09", to: "2026-09", now: new Date("2026-09-26T13:00:00.000Z") });
assert(stale.missingMonths[0].issues.includes("scope_timestamp_mismatch"));
assert(stale.missingMonths[0].issues.includes("stale_current_month"));

const [duplicate] = auditMapStateEvidence([
  row(1, "ALL", 100), row(1, "ALL", 101),
  row(1, "ELECTRIC(BOV)", 10), row(1, "PURE EV", 5),
], { ...options, from: "2026-01", to: "2026-01" });
assert(duplicate.missingMonths[0].issues.includes("duplicate_total_scope"));

const filteredRows = [
  row(1, "ALL", 30, { vehicle_class_filter: "MOTOR CAR" }),
  row(1, "ELECTRIC(BOV)", 3, { vehicle_class_filter: "MOTOR CAR" }),
  row(1, "PURE EV", 2, { vehicle_class_filter: "MOTOR CAR" }),
];
const [filtered] = auditMapStateEvidence(filteredRows, {
  ...options, from: "2026-01", to: "2026-01", context: { vehicle_class_filter: "MOTOR CAR" },
});
assert.equal(filtered.evTotal, 5);
assert.equal(filtered.total, 30);
console.log("Map evidence checks passed.");
