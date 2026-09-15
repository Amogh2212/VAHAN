import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildRtoReportPayloads,
  evaluateRtoReportReadinessGates,
  periodValueForSeries,
  RTO_REPORT_EXPECTED_OEM_ROWS_PER_RTO,
  RTO_REPORT_EXPECTED_OEMS,
  reportHistoryStartDate,
  reportPeriod,
  reportPeriodsForSnapshotDate,
  renderRtoReportCsv,
  renderRtoReportHtml,
  rtoReportExportRevision,
  quarantineUnverifiedRtoReport,
} from "../lib/rto-reports.mjs";
import { loadRtoReportWithOptionalFactorContext } from "../lib/rto-report-context.mjs";

assert.equal(RTO_REPORT_EXPECTED_OEMS, 5);
assert.equal(RTO_REPORT_EXPECTED_OEM_ROWS_PER_RTO, 30);
assert.deepEqual(
  evaluateRtoReportReadinessGates({
    run: { status: "success", succeeded_rtos: 99, total_rtos: 100 },
    cohortSize: 100,
    completeRtos: 100,
    comparisonEligibleRtos: 100,
  }),
  {
    reason: "collection_incomplete",
    collectionCompletion: false,
    collectionEligible: false,
    comparisonEligible: true,
    dailyRegistrationEligible: false,
  },
  "complete-looking evidence must not make an unfinished collection usable",
);
assert.equal(
  evaluateRtoReportReadinessGates({
    run: { status: "success", succeeded_rtos: 100, total_rtos: 100 },
    cohortSize: 100,
    completeRtos: 100,
    comparisonEligibleRtos: 99,
  }).dailyRegistrationEligible,
  false,
  "warning-only comparison coverage must not make Daily reports usable",
);
assert.ok(rtoReportExportRevision({ revision: 3 }, "csv") > 3, "old CSV caches must not bypass source quarantine");
assert.ok(rtoReportExportRevision({ revision: 3 }, "pdf") > 3);
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
const responseHashForDate = { "2026-07-22": "a", "2026-07-23": "b", "2026-07-24": "c" };
function registrationEvidence(snapshotDate, fuelGroup, vehicleCategory, { oemStatus = "unavailable" } = {}) {
  const vehicleCategories = vehicleCategory === "2W"
    ? ["TWO WHEELER(NT)", "TWO WHEELER(T)"]
    : vehicleCategory === "3W"
      ? ["THREE WHEELER(NT)", "THREE WHEELER(T)"]
      : ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"];
  return {
    validation: {
      contract: "public-registration-mtd-v1",
      targetMonth: "2026-07",
      requestHash: "1".repeat(64),
      responseHash: responseHashForDate[snapshotDate].repeat(64),
    },
    filters: {
      stateCode: "AA", rtoCode: "1", vehicleCategories, vehicleClasses: [],
      fuels: [fuelGroup === "EV" ? "PURE EV" : "PETROL"], archiveScope: "ACTIVE_ONLY",
      calendarType: "3", timePeriod: "0", targetMonth: "2026-07",
    },
    oem: { status: oemStatus, reason: oemStatus === "verified" ? null : "Maker chart lacks an exact target-month contract." },
  };
}
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
    metric_kind: "registration_month_to_date",
    source: "vahan-public-dashboard",
    scraped_at: `${snapshotDate}T08:00:00.000Z`,
    quality_flags: { sourceEvidence: registrationEvidence(snapshotDate, fuelGroup, vehicleCategory) },
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

assert.equal(daily.periodEv, 30, "Daily EV registrations must use consecutive month-to-date registration observations");
assert.equal(daily.periodIce, 30);
assert.equal(daily.cohortRank, null);
assert.equal(daily.evShare, 50);
assert.equal(daily.status, "ready_with_warnings");
assert.equal(daily.payload.dailyRegistration.previousDayRegistrations.date, "2026-07-23");
assert.equal(daily.payload.dailyRegistration.previousDayRegistrations.value, 50);
assert.equal(daily.payload.dailyRegistration.evRegistrations.date, "2026-07-24");
assert.equal(daily.payload.dailyRegistration.evRegistrations.value, 30);
assert.equal(daily.payload.dailyRegistration.baselineEligible, true);
assert.equal(daily.payload.categories[0].period.ev, 20);
assert.equal(daily.payload.metrics.sourceMonthToDate.ev, 170);
assert.equal(daily.payload.metrics.activeStock.ev, null, "active stock must remain a separately labelled, unavailable metric");
assert.deepEqual(daily.payload.oems, []);
assert.equal(daily.payload.trend.filter((row) => row.complete).length, 2);
assert.match(daily.summary, /30 EV and 30 ICE registrations/);
const dailyHtml = renderRtoReportHtml(daily.payload);
assert.match(dailyHtml, /Previous-day registrations/);
assert.match(dailyHtml, />30</);
const dailyCsv = renderRtoReportCsv(daily);
assert.match(dailyCsv, /previousDayRegistrations/);
assert.match(dailyCsv, /evRegistrations,30,available/);
assert.match(dailyCsv, /sourceMonthToDate.ev,170,source_observation/);
assert.doesNotMatch(dailyCsv, /Example Motors/);
assert.equal(daily.payload.source.requestHashes.length, 6);
assert.equal(daily.payload.source.responseHashes.length, 6);
assert.equal(daily.payload.oemEvidence.status, "unavailable");
assert.match(daily.payload.oemEvidence.reason, /exact target-month contract/i);

const verifiedOemTotals = structuredClone(totalRows);
for (const row of verifiedOemTotals.filter((item) => item.snapshot_date === "2026-07-24")) {
  row.quality_flags.sourceEvidence.oem = { status: "verified", reason: null };
}
const dynamicOemRows = verifiedOemTotals
  .filter((row) => row.snapshot_date === "2026-07-24")
  .flatMap((row) => [
    { maker: `${row.fuel_group} ${row.vehicle_category} Maker A`, count: 2, rank: 1 },
    { maker: `${row.fuel_group} ${row.vehicle_category} Maker B`, count: 1, rank: 2 },
  ].map((maker) => ({
    snapshot_date: row.snapshot_date,
    target_month: row.target_month,
    state: row.state,
    rto: row.rto,
    fuel_group: row.fuel_group,
    vehicle_category: row.vehicle_category,
    oem: maker.maker,
    vehicle_count: maker.count,
    source_rank: maker.rank,
    scrape_status: "success",
  })));
const [verifiedOemDaily] = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"),
  cohort,
  totalRows: verifiedOemTotals,
  oemRows: dynamicOemRows,
});
assert.equal(verifiedOemDaily.payload.oemEvidence.status, "verified");
assert.equal(verifiedOemDaily.payload.oemEvidence.segments.length, 6);
assert.ok(verifiedOemDaily.payload.oemEvidence.segments.every((segment) => segment.topFive.length === 2));
assert.ok(verifiedOemDaily.payload.oemEvidence.segments.every((segment) => segment.topFiveTotal === 3));
for (const segment of verifiedOemDaily.payload.oemEvidence.segments) {
  const headline = verifiedOemTotals.find((row) => row.snapshot_date === "2026-07-24"
    && row.fuel_group === segment.fuelGroup && row.vehicle_category === segment.vehicleCategory);
  assert.equal(segment.otherUntracked + segment.topFiveTotal, headline.report_total, "Other / untracked must reconcile to the segment headline");
}
assert.equal(dynamicOemRows.length, 12, "missing maker positions must stay absent rather than being zero-filled to 30 rows");

const identicalRows = structuredClone(totalRows);
for (const row of identicalRows.filter((item) => item.snapshot_date === "2026-07-24")) {
  row.quality_flags.sourceEvidence.validation.responseHash = "b".repeat(64);
}
const [identicalDaily] = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"), cohort, totalRows: identicalRows,
});
assert.equal(identicalDaily.periodEv, null, "identical cross-day response hashes must never become a zero Daily value");
assert.equal(identicalDaily.payload.dailyRegistration.baselineEligible, false);
assert.match(identicalDaily.payload.dailyRegistration.reason, /identical.*no refresh timestamp/i);

const unchangedTargetRows = structuredClone(totalRows);
const priorTargetByScope = new Map(unchangedTargetRows
  .filter((row) => row.snapshot_date === "2026-07-23")
  .map((row) => [`${row.fuel_group}|${row.vehicle_category}`, row.report_total]));
for (const row of unchangedTargetRows.filter((item) => item.snapshot_date === "2026-07-24")) {
  row.report_total = priorTargetByScope.get(`${row.fuel_group}|${row.vehicle_category}`);
}
const [unchangedTargetDaily] = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"), cohort, totalRows: unchangedTargetRows,
});
assert.equal(unchangedTargetDaily.periodEv, null,
  "different whole-response hashes must not certify zero when the selected month is unchanged");
assert.match(unchangedTargetDaily.payload.dailyRegistration.reason, /target-month registration total is unchanged/i);

const negativeRows = structuredClone(totalRows);
const priorByScope = new Map(negativeRows
  .filter((row) => row.snapshot_date === "2026-07-23")
  .map((row) => [`${row.fuel_group}|${row.vehicle_category}`, row.report_total]));
for (const row of negativeRows.filter((item) => item.snapshot_date === "2026-07-24")) {
  row.report_total = priorByScope.get(`${row.fuel_group}|${row.vehicle_category}`) - (row.fuel_group === "EV" ? 2 : 3);
}
const [negativeDaily] = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"), cohort, totalRows: negativeRows,
});
assert.equal(negativeDaily.periodEv, -6);
assert.equal(negativeDaily.periodIce, -9);
assert.equal(negativeDaily.payload.dailyRegistration.status, "correction");
assert.equal(negativeDaily.payload.dailyRegistration.evRegistrations.status, "correction");
assert.match(negativeDaily.payload.quality.warnings.join(" "), /negative Daily value.*preserved/i);

const missingScopeRows = totalRows.filter((row) => !(row.snapshot_date === "2026-07-23" && row.fuel_group === "EV" && row.vehicle_category === "2W"));
const [missingScopeDaily] = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"), cohort, totalRows: missingScopeRows,
});
assert.equal(missingScopeDaily.periodEv, null);
assert.match(missingScopeDaily.payload.dailyRegistration.reason, /Six accepted registration scopes/);

const duplicateScopeRows = [...totalRows, structuredClone(totalRows.find((row) => row.snapshot_date === "2026-07-24"))];
const [duplicateScopeDaily] = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"), cohort, totalRows: duplicateScopeRows,
});
assert.equal(duplicateScopeDaily.periodEv, null, "duplicate same-date scopes must be unavailable rather than double counted");

const mixedMonthRows = structuredClone(totalRows);
const mixed = mixedMonthRows.find((row) => row.snapshot_date === "2026-07-24" && row.fuel_group === "EV" && row.vehicle_category === "2W");
mixed.target_month = "2026-06";
mixed.quality_flags.sourceEvidence.validation.targetMonth = "2026-06";
mixed.quality_flags.sourceEvidence.filters.targetMonth = "2026-06";
const [mixedMonthDaily] = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"), cohort, totalRows: mixedMonthRows,
});
assert.equal(mixedMonthDaily.periodEv, null);
assert.match(mixedMonthDaily.payload.dailyRegistration.reason, /Invalid or mixed monthly-registration evidence/);

const rolloverRows = totalRows
  .filter((row) => ["2026-07-23", "2026-07-24"].includes(row.snapshot_date))
  .map((source) => {
    const row = structuredClone(source);
    const current = row.snapshot_date === "2026-07-24";
    row.snapshot_date = current ? "2026-08-01" : "2026-07-31";
    row.target_month = current ? "2026-08" : "2026-07";
    row.scraped_at = `${row.snapshot_date}T08:00:00.000Z`;
    row.quality_flags.sourceEvidence.validation.targetMonth = row.target_month;
    row.quality_flags.sourceEvidence.filters.targetMonth = row.target_month;
    row.quality_flags.sourceEvidence.validation.responseHash = (current ? "d" : "e").repeat(64);
    return row;
  });
const [rolloverDaily] = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-08-01"), cohort, totalRows: rolloverRows,
});
assert.equal(rolloverDaily.periodEv, null);
assert.match(rolloverDaily.payload.dailyRegistration.reason, /Month-boundary baseline/);
// Stock rendering remains independently supported for the weekly cadence.
const [weeklyStock] = buildRtoReportPayloads({
  period: reportPeriod("weekly", "2026-07-24"), cohort,
  totalRows: totalRows.map(row => ({ ...row, snapshot_date: row.snapshot_date === "2026-07-23" ? "2026-07-17" : row.snapshot_date })),
  oemRows: oemRows.map(row => ({ ...row, snapshot_date: row.snapshot_date === "2026-07-23" ? "2026-07-17" : row.snapshot_date })),
});
assert.equal(weeklyStock.periodEv, 30);
assert.equal(weeklyStock.mtdEv, 170);

const rankingCohort = Array.from({ length: 100 }, (_, index) => ({ state: `State ${index + 1}`, rto: `RTO ${index + 1}`, cohort_rank: index + 1 }));
const rankingRows = rankingCohort.flatMap((member, memberIndex) =>
  ["2026-07-23", "2026-07-24"].flatMap((snapshotDate, dateIndex) =>
    ["EV", "ICE"].flatMap((fuelGroup) => ["2W", "3W", "4W"].map((vehicleCategory) => ({
      snapshot_date: snapshotDate,
      target_month: "2026-07",
      state: member.state,
      rto: member.rto,
      fuel_group: fuelGroup,
      vehicle_category: vehicleCategory,
      report_total: 1_000 + memberIndex + dateIndex * (fuelGroup === "EV" ? 100 - memberIndex : 10),
      tracked_oem_total: 0,
      untracked_total: 0,
      scrape_status: "success",
      quality_status: "ready",
      metric_kind: "registration_month_to_date",
      source: "vahan-public-dashboard",
      scraped_at: `${snapshotDate}T08:00:00.000Z`,
      quality_flags: { sourceEvidence: registrationEvidence(snapshotDate, fuelGroup, vehicleCategory) },
    })))),
);
const dailyRanking = buildRtoReportPayloads({
  period: reportPeriod("daily", "2026-07-24"),
  cohort: rankingCohort,
  totalRows: rankingRows,
});
assert.equal(rankingRows.length, 1_200, "100 RTOs × six scopes × two consecutive observations must be validated");
assert.equal(dailyRanking.length, 100);
assert.ok(dailyRanking.every((report) => report.payload.dailyRegistration.baselineEligible));
assert.equal(dailyRanking.find((report) => report.rto === "RTO 1").cohortRank, 1, "Daily rank must use today's EV registration change across all 100 RTOs");
assert.equal(dailyRanking.find((report) => report.rto === "RTO 100").cohortRank, 100);

const csv = renderRtoReportCsv({ ...weeklyStock, cadence: "weekly", periodStart: "2026-07-24", periodEnd: "2026-07-24" });
assert.match(csv, /Example Motors/);
assert.match(csv, /Other \/ untracked/);

const html = renderRtoReportHtml(weeklyStock.payload);
assert.match(html, /Dynamic top-maker stock/);
assert.match(html, /VAHAN Public Dashboard/);
assert.match(html, /trend-chart-bg/);
const categoryOemHtml = renderRtoReportHtml({
  ...weeklyStock.payload,
  oems: [
    {
      oem: "Hero MotoCorp",
      categories: [{
        vehicleCategory: "2W",
        period: { ev: 1, ice: 2, total: 3 },
        previousPeriod: { total: 2 },
        stock: { ev: 10, ice: 20, total: 30 },
        change: { total: { absolute: 1 } },
      }],
    },
    {
      oem: "Maruti Suzuki",
      categories: [{
        vehicleCategory: "4W",
        period: { ev: 4, ice: 5, total: 9 },
        previousPeriod: { total: 7 },
        stock: { ev: 40, ice: 50, total: 90 },
        change: { total: { absolute: 2 } },
      }],
    },
  ],
});
assert.equal((categoryOemHtml.match(/<td>Hero MotoCorp<\/td>/g) ?? []).length, 1);
assert.equal((categoryOemHtml.match(/<td>Maruti Suzuki<\/td>/g) ?? []).length, 1);
assert.doesNotMatch(categoryOemHtml, /<td>Hero MotoCorp<\/td><td>3W<\/td>/);
assert.doesNotMatch(categoryOemHtml, /<td>Maruti Suzuki<\/td><td>2W<\/td>/);
const contextHtml = renderRtoReportHtml({
  payload: weeklyStock.payload,
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

const factOnlyReport = { id: 42, revision: 3, payload: { source: { validationContract: "public-stock-v2" }, metrics: { stock: { ev: 12 } } } };
const contextUnavailable = await loadRtoReportWithOptionalFactorContext({
  reportId: 42,
  factorAgentEnabled: true,
  loadReport: async () => factOnlyReport,
  loadApprovedExplanations: async () => { throw new Error("context store unavailable"); },
});
assert.equal(contextUnavailable.payload.metrics.stock.ev, 12, "factor context failure must not remove validated report facts");
assert.deepEqual(contextUnavailable.explanations, []);
assert.equal(contextUnavailable.factorContext.status, "unavailable");
assert.match(contextUnavailable.factorContext.message, /Active-stock facts remain available/);

const contextDisabled = await loadRtoReportWithOptionalFactorContext({
  reportId: 42,
  factorAgentEnabled: false,
  loadReport: async () => factOnlyReport,
  loadApprovedExplanations: async () => { throw new Error("must not be called"); },
});
assert.equal(contextDisabled.factorContext.status, "disabled");

const reportPageSource = fs.readFileSync(new URL("../public/rto-reports.js", import.meta.url), "utf8");
assert.match(reportPageSource, /Possible-driver context unavailable/);
assert.match(reportPageSource, /Active-stock facts remain available/);
assert.match(reportPageSource, /Active EV stock/);
assert.match(reportPageSource, /Active ICE stock/);
assert.match(reportPageSource, /Observed active stock/);
assert.doesNotMatch(reportPageSource, /registrationMetricValue|Fetched MTD; daily N\/A/);
const invalidHistorical = { status: "ready", mtdEv: 1405015, payload: { metrics: { stock: { ev: 1405015 } }, trend: [{ ev: 1405015 }], oems: [{ oem: "Bogus" }] } };
const quarantined = quarantineUnverifiedRtoReport(invalidHistorical);
assert.equal(quarantined.mtdEv, null);
assert.equal(quarantined.status, "needs_review");
assert.deepEqual(quarantined.payload.metrics, {});
assert.deepEqual(quarantined.payload.trend, []);
assert.deepEqual(quarantined.payload.oems, []);
assert.equal(invalidHistorical.mtdEv, 1405015, "quarantine must not mutate archived evidence");
const historicalContext = await loadRtoReportWithOptionalFactorContext({ reportId: 42, factorAgentEnabled: true,
  loadReport: async () => quarantined, loadApprovedExplanations: async () => { throw new Error("must not load invalid historical explanations"); } });
assert.deepEqual(historicalContext.explanations, []);
assert.match(historicalContext.factorContext.message, /unverified/);
const [partialOem] = buildRtoReportPayloads({ period: reportPeriod("weekly", "2026-07-24"), cohort, totalRows,
  oemRows: oemRows.filter(row => row.fuel_group === "EV") });
const partialCategory = partialOem.payload.oems.find(row => row.oem === "Example Motors").categories[0];
assert.ok(partialCategory.stock.ev > 0);
assert.equal(partialCategory.stock.ice, null);
assert.equal(partialCategory.stock.total, null, "missing top-five membership is unknown, not zero ICE stock");
assert.equal(partialCategory.change.total.absolute, null, "different observed OEM scopes must not produce net movement");
assert.match(reportPageSource, /function reportEvLabel/);

console.log("RTO report system checks passed.");
