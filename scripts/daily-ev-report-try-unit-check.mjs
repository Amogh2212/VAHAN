import assert from "node:assert/strict";
import {
  buildDailyEvReportSet,
  renderDailyEvReportHtml,
  selectLatestEligibleRun,
  slugifyPathSegment,
} from "../lib/daily-ev-report-try.mjs";

const COMBOS = [
  ["EV", "2W"],
  ["EV", "3W"],
  ["EV", "4W"],
  ["ICE", "2W"],
  ["ICE", "3W"],
  ["ICE", "4W"],
];

function reportRows(runId, state, rto, totals, options = {}) {
  return COMBOS.map(([fuelGroup, vehicleCategory], index) => ({
    run_id: runId,
    state,
    rto,
    fuel_group: fuelGroup,
    vehicle_category: vehicleCategory,
    status: options.status ?? "success",
    report_total: totals[index],
    source_row_count: 3,
    filters_confirmed: options.filtersConfirmed ?? true,
    scraped_at: "2026-07-17T12:00:00.000Z",
  }));
}

const latest = selectLatestEligibleRun([
  { id: "3", snapshot_date: "2026-07-18", target_month: "2026-07", status: "running", started_at: "2026-07-18T00:00:00.000Z" },
  { id: "2", snapshot_date: "2026-07-17", target_month: "2026-07", status: "partial", started_at: "2026-07-17T00:00:00.000Z" },
  { id: "1", snapshot_date: "2026-07-16", target_month: "2026-07", status: "success", started_at: "2026-07-16T00:00:00.000Z" },
]);
assert.equal(latest.snapshotDate, "2026-07-17", "default selection must skip running cycles");

const configRows = [
  { state: "Alpha", rto: "Alpha 1", enabled: true },
  { state: "Alpha", rto: "Alpha 2", enabled: true },
  { state: "Beta", rto: "Beta 1", enabled: true },
  { state: "Beta", rto: "Beta 2", enabled: true },
  { state: "Gamma", rto: "Gamma 1", enabled: true },
  { state: "Gamma", rto: "Gamma 2", enabled: true },
];

const currentRows = [
  ...reportRows("2", "Alpha", "Alpha 1", [100, 20, 30, 500, 100, 50]),
  ...reportRows("2", "Alpha", "Alpha 2", [50, 5, 5, 100, 20, 20]).slice(0, 5),
  ...reportRows("2", "Beta", "Beta 1", [70, 5, 5, 200, 50, 2_000_001]),
  ...reportRows("2", "Beta", "Beta 2", [50, 10, 0, 300, 100, 100]),
];

const previousRows = [
  ...reportRows("1", "Alpha", "Alpha 1", [80, 20, 20, 500, 100, 50]),
  ...reportRows("1", "Beta", "Beta 1", [60, 5, 5, 200, 50, 100]),
  ...reportRows("1", "Beta", "Beta 2", [30, 10, 0, 300, 100, 100]),
];

const set = buildDailyEvReportSet({
  run: {
    id: "2",
    snapshot_date: "2026-07-17",
    target_month: "2026-07",
    status: "partial",
    total_rtos: 6,
    succeeded_rtos: 3,
    failed_rtos: 0,
  },
  previousRun: {
    id: "1",
    snapshot_date: "2026-07-16",
    target_month: "2026-07",
    status: "success",
    total_rtos: 6,
    succeeded_rtos: 3,
    failed_rtos: 0,
  },
  configRows,
  currentRows,
  previousRows,
  minStateCoveragePct: 50,
  anomalyReportTotalMax: 1_000_000,
  generatedAt: new Date("2026-07-17T18:00:00.000Z"),
});

assert.equal(set.reports.india.coverage.completedRtos, 3, "India report should count only complete RTOs");
assert.equal(set.reports.india.coverage.expectedRtos, 6);
assert.equal(set.reports.india.status, "needs_review", "India report should need review when anomaly rows exist");
assert.equal(set.reports.india.quality.anomalyRows, 1);
assert.equal(set.reports.india.totals.ev, 290);
assert.equal(set.reports.india.totals.ice, 1400, "anomaly ICE row should be excluded from headline totals");
assert.equal(set.reports.india.movement.evDelta, 60);
assert.equal(set.reports.india.movement.comparableRtos, 3);

assert.deepEqual(set.reports.states.map((report) => report.state).sort(), ["Alpha", "Beta"]);
assert.equal(set.skipped.length, 1);
assert.equal(set.skipped[0].state, "Gamma");
assert.equal(set.skipped[0].reason, "coverage_below_threshold");

const alpha = set.reports.states.find((report) => report.state === "Alpha");
const beta = set.reports.states.find((report) => report.state === "Beta");
assert.equal(alpha.coverage.coveragePct, 50);
assert.equal(alpha.status, "partial");
assert.equal(beta.status, "needs_review");
assert.equal(beta.totals.ice, 750, "state anomaly row should be excluded but the state report should still generate");

const html = renderDailyEvReportHtml(beta);
assert.match(html, /Comparable Daily Movement/);
assert.match(html, /report_total_above_sanity_limit/);
assert.equal(slugifyPathSegment("Jammu & Kashmir"), "jammu-and-kashmir");

console.log("Daily EV report try-run checks passed.");
