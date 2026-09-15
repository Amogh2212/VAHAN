import { RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS } from "../../lib/rto-daily-snapshots.mjs";

// Synthetic evidence for offline unit tests only; never used by collection code.
export function withStockEvidence(report) {
  const filters = { stateCode: "UK", rtoCode: "8", ...RTO_DAILY_CATEGORY_FILTERS[report.vehicleCategory], fuels: RTO_DAILY_FUEL_FILTERS[report.fuelGroup], archiveScope: "ACTIVE_ONLY" };
  const topFiveTotal = report.rows.reduce((sum, row) => sum + row.vehicle_count, 0);
  return { ...report, metricKind: "active_stock", source: "vahan-public-dashboard", evidence: {
    filters, topFiveTotal, topMakerRows: report.rows,
    categories: [{ category: filters.vehicleCategories[0], count: report.reportTotal }],
    validation: { contract: "public-stock-v2", mapping: { state: report.state, rto: report.rto, stateCode: "UK", rtoCode: "8", catalogHash: "a".repeat(64) },
      requestHash: "b".repeat(64), responseHash: "c".repeat(64), verifiedAt: "2026-09-09T08:00:00Z", headlineTotal: report.reportTotal,
      sourceRowCount: report.rows.length, topFiveTotal, timePeriod: "2", zeroConfirmed: report.reportTotal === 0 },
  } };
}

export function withRegistrationEvidence(report, {
  requestHash = "b".repeat(64),
  responseHash = "c".repeat(64),
  oemStatus = "unavailable",
  oemReason = "Monthly maker contract is unverified in this fixture.",
} = {}) {
  const rows = report.rows ?? [];
  const filters = {
    stateCode: "UK",
    rtoCode: "8",
    ...RTO_DAILY_CATEGORY_FILTERS[report.vehicleCategory],
    fuels: RTO_DAILY_FUEL_FILTERS[report.fuelGroup],
    archiveScope: "ACTIVE_ONLY",
    calendarType: "3",
    timePeriod: "0",
    targetMonth: report.targetMonth ?? "2026-09",
  };
  const topFiveTotal = rows.reduce((sum, row) => sum + Number(row.vehicle_count), 0);
  const makerRequest = new URL("https://analytics.parivahan.gov.in/analytics/publicdashboard/vahandashboard/monthlyMakerFixture");
  const makerParams = {
    targetMonth: filters.targetMonth,
    calendarType: filters.calendarType,
    timePeriod: filters.timePeriod,
    fromYear: filters.targetMonth.slice(0, 4),
    toYear: filters.targetMonth.slice(0, 4),
    stateCode: filters.stateCode,
    rtoCode: filters.rtoCode,
    archiveTypeAC: "ACTIVE_COMPLIANT",
    archiveTypeANC: "ACTIVE_NON_COMPLIANT",
  };
  for (const [key, value] of Object.entries(makerParams)) makerRequest.searchParams.set(key, value);
  for (const value of filters.vehicleCategories) makerRequest.searchParams.append("vehicleSubCategories[]", value);
  for (const value of filters.vehicleClasses) makerRequest.searchParams.append("vehicleClasses[]", value);
  for (const value of filters.fuels) makerRequest.searchParams.append("vehicleFuels[]", value);
  const makerValidation = {
    contract: "public-registration-mtd-v1",
    targetMonth: filters.targetMonth,
    calendarType: "3",
    timePeriod: "0",
    filters,
    requestUrl: makerRequest.href,
    requestHash: "d".repeat(64),
    responseHash: "e".repeat(64),
    observedAt: report.scrapedAt,
  };
  return {
    ...report,
    rows,
    metricKind: "registration_month_to_date",
    source: "vahan-public-dashboard",
    evidence: {
      filters,
      freshness: { observedAt: report.scrapedAt, sourceReportedAt: null, status: "unconfirmed" },
      oem: {
        status: oemStatus,
        reason: oemStatus === "verified" ? null : oemReason,
        topFiveTotal: oemStatus === "verified" ? topFiveTotal : null,
        otherUntracked: oemStatus === "verified" ? Number(report.reportTotal) - topFiveTotal : null,
        validation: oemStatus === "verified" ? makerValidation : null,
      },
      topFiveTotal: oemStatus === "verified" ? topFiveTotal : null,
      topMakerRows: rows,
      validation: {
        contract: "public-registration-mtd-v1",
        mapping: { state: report.state, rto: report.rto, stateCode: "UK", rtoCode: "8", catalogHash: "a".repeat(64) },
        requestHash,
        responseHash,
        observedAt: report.scrapedAt,
        monthToDateTotal: report.reportTotal,
        sourceRowCount: rows.length,
        timePeriod: "0",
        calendarType: "3",
        targetMonth: report.targetMonth ?? "2026-09",
        zeroConfirmed: report.reportTotal === 0,
      },
    },
  };
}
