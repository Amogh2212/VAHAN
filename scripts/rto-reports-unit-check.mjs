import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildRtoReportPayloads,
  periodValueForSeries,
  RTO_REPORT_EXPECTED_OEM_ROWS_PER_RTO,
  RTO_REPORT_EXPECTED_OEMS,
  reportHistoryStartDate,
  reportPeriod,
  reportPeriodsForSnapshotDate,
  renderRtoReportCsv,
  renderRtoReportHtml,
  rtoReportCategoryOemRows,
  rtoReportExportRevision,
} from "../lib/rto-reports.mjs";
import { loadRtoReportWithOptionalFactorContext } from "../lib/rto-report-context.mjs";

assert.equal(RTO_REPORT_EXPECTED_OEMS, 15);
assert.equal(RTO_REPORT_EXPECTED_OEM_ROWS_PER_RTO, 90);
assert.equal(rtoReportExportRevision({ revision: 3 }, "csv"), 3);
assert.ok(rtoReportExportRevision({ revision: 3 }, "pdf") > 3);
const categoryOemRows = rtoReportCategoryOemRows();
assert.equal(categoryOemRows.length, 15);
assert.ok(
  categoryOemRows.some((row) => row.vehicle_category === "4W" && row.oem === "Mahindra & Mahindra"),
  "4W reconciliation should include Mahindra & Mahindra",
);
assert.ok(
  !categoryOemRows.some((row) => row.vehicle_category === "4W" && row.oem === "Mahindra Last Mile Mobility"),
  "4W reconciliation must not include 3W-only Mahindra Last Mile Mobility rows",
);

const weeklySeries = new Map([
  ["2026-06-28", { value: 90 }],
  ["2026-06-30", { value: 110 }],
  ["2026-07-05", { value: 25 }],
]);
assert.equal(
  periodValueForSeries(weeklySeries, reportPeriod("weekly", "2026-07-05")),
  45,
  "a week crossing month-end must add month-segment boundary differences",
);
assert.deepEqual(
  reportPeriodsForSnapshotDate("2026-05-31").map((period) => period.cadence),
  ["daily", "weekly", "monthly"],
  "a Sunday month-end must generate all three cadences",
);
assert.deepEqual(
  reportPeriodsForSnapshotDate("2026-07-24").map((period) => period.cadence),
  ["daily"],
);
assert.equal(reportHistoryStartDate("2026-07-24"), "2026-07-10");

const cohort = [{ state: "Alpha", rto: "Alpha RTO", cohort_rank: 1 }];
const totalsByDate = {
  "2026-07-22": [90, 20, 10, 560, 90, 70],
  "2026-07-23": [100, 25, 15, 580, 95, 75],
  "2026-07-24": [120, 30, 20, 600, 100, 80],
};
const totalRows = Object.entries(totalsByDate).flatMap(([snapshotDate, values]) =>
  [
    ["EV", "2W"],
    ["EV", "3W"],
    ["EV", "4W"],
    ["ICE", "2W"],
    ["ICE", "3W"],
    ["ICE", "4W"],
  ].map(([fuelGroup, vehicleCategory], index) => ({
    snapshot_date: snapshotDate,
    target_month: "2026-07",
    state: "Alpha",
    rto: "Alpha RTO",
    fuel_group: fuelGroup,
    vehicle_category: vehicleCategory,
    report_total: values[index],
    tracked_oem_total: Math.max(0, values[index] - 5),
    untracked_total: 5,
    scrape_status: "success",
    quality_status: "ready",
    quality_flags: {},
  })));

const oemRows = ["2026-07-22", "2026-07-23", "2026-07-24"].flatMap((snapshotDate, dateIndex) =>
  [
    ["EV", "2W", 40 + dateIndex * 5],
    ["EV", "3W", 5 + dateIndex],
    ["EV", "4W", 3 + dateIndex],
    ["ICE", "2W", 200 + dateIndex * 10],
    ["ICE", "3W", 30 + dateIndex * 2],
    ["ICE", "4W", 20 + dateIndex * 2],
  ].map(([fuelGroup, vehicleCategory, vehicleCount]) => ({
    snapshot_date: snapshotDate,
    target_month: "2026-07",
    state: "Alpha",
    rto: "Alpha RTO",
    fuel_group: fuelGroup,
    vehicle_category: vehicleCategory,
    oem: "Example Motors",
    vehicle_count: vehicleCount,
    scrape_status: "success",
  })));

const [daily] = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"),
  cohort,
  totalRows,
  oemRows,
  generatedAt: new Date("2026-07-24T18:00:00.000Z"),
});

assert.equal(daily.periodEv, 30, "daily EV additions must be current MTD minus prior-day MTD");
assert.equal(daily.periodIce, 30);
assert.equal(daily.mtdEv, 170);
assert.equal(daily.cohortRank, 1);
assert.equal(daily.payload.categories.find((row) => row.vehicleCategory === "2W").period.ev, 20);
assert.ok(daily.payload.oems.some((row) => row.oem === "Example Motors"));
assert.ok(daily.payload.oems.some((row) => row.oem === "Other / untracked"));
assert.match(daily.summary, /30 EV and 30 ICE/);

const correctionRows = totalRows.map((row) =>
  row.snapshot_date === "2026-07-24" && row.fuel_group === "EV"
    ? { ...row, report_total: row.report_total - 40 }
    : row,
);
const [correctionDaily] = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"),
  cohort,
  totalRows: correctionRows,
});
assert.equal(correctionDaily.periodEv, null, "negative daily corrections must not be shown as registrations");
assert.equal(correctionDaily.payload.metrics.period.ev, null);
assert.equal(correctionDaily.payload.metrics.change.ev.absolute, null);
assert.match(correctionDaily.payload.quality.warnings.join(" "), /daily EV registrations are unavailable/);

const [incompleteDaily] = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"),
  cohort,
  totalRows: totalRows.filter((row) => row.snapshot_date === "2026-07-24"),
  oemRows: oemRows.filter((row) => row.snapshot_date === "2026-07-24"),
});
assert.match(incompleteDaily.summary, /unavailable daily additions/);
assert.match(incompleteDaily.summary, /Month-to-date totals are 170 EV and 780 ICE/);
assert.match(incompleteDaily.payload.quality.warnings.join(" "), /previous-day MTD boundary is missing/);
const incompleteHtml = renderRtoReportHtml(incompleteDaily.payload);
assert.match(incompleteHtml, /Fetched MTD; daily addition unavailable/);
assert.match(incompleteHtml, /<strong>170<\/strong>/);
assert.match(incompleteHtml, /<strong>780<\/strong>/);

const [unavailableDaily] = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"),
  cohort,
  totalRows: [],
  oemRows: [],
});
assert.equal(unavailableDaily.currentCoverage, false);
assert.equal(unavailableDaily.payload.quality.currentCoverage, false);
assert.match(unavailableDaily.payload.quality.warnings.join(" "), /shown as unavailable/);

const rankingCohort = [
  { state: "Alpha", rto: "Alpha RTO", cohort_rank: 1 },
  { state: "Beta", rto: "Beta RTO", cohort_rank: 2 },
];
const rankingRows = rankingCohort.flatMap((member, memberIndex) =>
  ["2026-07-23", "2026-07-24"].flatMap((snapshotDate, dateIndex) =>
    ["EV", "ICE"].flatMap((fuelGroup) => ["2W", "3W", "4W"].map((vehicleCategory) => ({
      snapshot_date: snapshotDate,
      target_month: "2026-07",
      state: member.state,
      rto: member.rto,
      fuel_group: fuelGroup,
      vehicle_category: vehicleCategory,
      report_total: memberIndex === 0 ? 100 + dateIndex * 20 : 1_000 + dateIndex * 5,
      tracked_oem_total: 0,
      untracked_total: 0,
      scrape_status: "success",
      quality_status: "ready",
      quality_flags: {},
    })))),
);
const dailyRanking = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"),
  cohort: rankingCohort,
  totalRows: rankingRows,
});
assert.equal(dailyRanking.find((report) => report.state === "Alpha").cohortRank, 1);
assert.equal(dailyRanking.find((report) => report.state === "Beta").cohortRank, 2);

const csv = renderRtoReportCsv({ ...daily, cadence: "daily", periodStart: "2026-07-24", periodEnd: "2026-07-24" });
assert.match(csv, /Example Motors/);
assert.match(csv, /Other \/ untracked/);

const html = renderRtoReportHtml(daily.payload);
assert.match(html, /OEM performance/);
assert.match(html, /rto_daily_scrape_reports\.report_total/);
assert.match(html, /trend-chart-bg/);
const categoryOemHtml = renderRtoReportHtml({
  ...daily.payload,
  oems: [
    {
      oem: "Hero MotoCorp",
      categories: ["2W", "3W", "4W"].map((vehicleCategory) => ({
        vehicleCategory,
        period: { ev: 1, ice: 2, total: 3 },
        previousPeriod: { total: 2 },
        change: { total: { absolute: 1 } },
      })),
    },
    {
      oem: "Maruti Suzuki",
      categories: ["2W", "3W", "4W"].map((vehicleCategory) => ({
        vehicleCategory,
        period: { ev: 4, ice: 5, total: 9 },
        previousPeriod: { total: 7 },
        change: { total: { absolute: 2 } },
      })),
    },
  ],
});
assert.equal((categoryOemHtml.match(/<td>Hero MotoCorp<\/td>/g) ?? []).length, 1);
assert.equal((categoryOemHtml.match(/<td>Maruti Suzuki<\/td>/g) ?? []).length, 1);
assert.doesNotMatch(categoryOemHtml, /<td>Hero MotoCorp<\/td><td>3W<\/td>/);
assert.doesNotMatch(categoryOemHtml, /<td>Maruti Suzuki<\/td><td>2W<\/td>/);
const contextHtml = renderRtoReportHtml({
  payload: daily.payload,
  explanations: [{
    finalHeading: "Official campaign aligned with the observed movement",
    finalBody: "Registrations moved above the matched peer trend after the cited campaign. This is an association, not proof of causation.",
    validationDecisionStatus: "supported_association",
    limitations: ["A short observation window remains."],
    citations: [{
      documentId: 1,
      citationLabel: "Official source",
      document: {
        id: 1,
        title: "Official source",
        canonicalUrl: "https://example.com/source",
        source: { publisher: "Example Transport Authority", sourceTier: "A" },
      },
    }],
  }],
});
assert.match(contextHtml, /Possible drivers behind the numbers/);
assert.match(contextHtml, /association, not proof of causation/);
assert.match(contextHtml, /https:\/\/example\.com\/source/);

const factOnlyReport = { id: 42, revision: 3, payload: { metrics: { mtd: { ev: 12 } } } };
const contextUnavailable = await loadRtoReportWithOptionalFactorContext({
  reportId: 42,
  factorAgentEnabled: true,
  loadReport: async () => factOnlyReport,
  loadApprovedExplanations: async () => { throw new Error("context store unavailable"); },
});
assert.equal(contextUnavailable.payload.metrics.mtd.ev, 12, "factor context failure must not remove validated report facts");
assert.deepEqual(contextUnavailable.explanations, []);
assert.equal(contextUnavailable.factorContext.status, "unavailable");
assert.match(contextUnavailable.factorContext.message, /Registration facts remain available/);

const contextDisabled = await loadRtoReportWithOptionalFactorContext({
  reportId: 42,
  factorAgentEnabled: false,
  loadReport: async () => factOnlyReport,
  loadApprovedExplanations: async () => { throw new Error("must not be called"); },
});
assert.equal(contextDisabled.factorContext.status, "disabled");

const reportPageSource = fs.readFileSync(new URL("../public/rto-reports.js", import.meta.url), "utf8");
assert.match(reportPageSource, /Possible-driver context unavailable/);
assert.match(reportPageSource, /Registration facts remain available/);
assert.match(reportPageSource, /function registrationComparison/);
assert.match(reportPageSource, /function reportEvLabel/);
assert.match(reportPageSource, /Fetched MTD; daily N\/A/);

console.log("RTO report system checks passed.");
