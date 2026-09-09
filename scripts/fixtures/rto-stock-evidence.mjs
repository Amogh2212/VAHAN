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
