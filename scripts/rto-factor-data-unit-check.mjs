import assert from "node:assert/strict";
import {
  documentsForRtoFactorNarrative,
  eventTargetForReport,
  loadRtoFactorDecisionInput,
  validationEventFromStoredEvent,
} from "../lib/rto-factor-data.mjs";

const report = {
  id: 501,
  state: "Maharashtra",
  rto: "Pune Central RTO",
  status: "ready",
  batchStatus: "ready",
  sourceRunId: 77,
  sourceSnapshotDate: "2026-07-26",
  periodEnd: "2026-07-26",
  revision: 2,
  sourceChecksum: "a".repeat(64),
  cohortHash: "frozen-100",
  cohortSize: 100,
};
const event = {
  id: 41,
  title: "Maharashtra EV incentive update",
  effectiveStart: "2026-07-13",
  expectedDirection: "increase",
  documents: [
    {
      documentId: 91,
      evidenceRole: "primary",
      document: {
        id: 91,
        title: "Official incentive notice",
        publisher: "Maharashtra Transport Department",
        canonicalUrl: "https://transport.maharashtra.gov.in/notices/ev-incentive",
        sourceTier: "A",
        evidencePolicy: "report_evidence",
        reviewStatus: "approved",
        publishedAt: "2026-07-12T05:00:00.000Z",
        evidenceExcerpt: "The revised incentive applies from 13 July 2026.",
        contentHash: "b".repeat(64),
      },
    },
  ],
  targets: [
    {
      targetRole: "affected",
      geographyScope: "state",
      state: "Maharashtra",
      rto: null,
      oem: null,
      fuelGroup: "EV",
      vehicleCategory: "ALL",
    },
  ],
};

assert.equal(eventTargetForReport(event, report)?.geographyScope, "state");
assert.equal(eventTargetForReport(event, { ...report, state: "Gujarat" }), null);

const validationEvent = validationEventFromStoredEvent({
  event,
  target: event.targets[0],
});
assert.deepEqual(validationEvent.sources, [{ id: 91, tier: "A", verified: true }]);
assert.equal(validationEvent.scopeLevel, "state");
assert.equal(validationEvent.fuelGroup, "EV");
assert.equal(validationEvent.vehicleCategory, null);

const narrativeDocuments = documentsForRtoFactorNarrative(event);
assert.equal(narrativeDocuments[0].url, "https://transport.maharashtra.gov.in/notices/ev-incentive");
assert.equal(narrativeDocuments[0].excerpt, "The revised incentive applies from 13 July 2026.");

const calls = [];
const decisionInput = await loadRtoFactorDecisionInput({
  report,
  event,
  queryImpl: async (sql, values) => {
    calls.push({ sql, values });
    if (/from rto_daily_run_cohort_members\s+where run_id/i.test(sql)) {
      return {
        rows: [
          { state: "Maharashtra", rto: "Pune Central RTO", cohort_rank: 1 },
          { state: "Gujarat", rto: "Ahmedabad RTO", cohort_rank: 2 },
        ],
      };
    }
    return {
      rows: [
        historyRow({ state: "Maharashtra", rto: "Pune Central RTO", date: "2026-07-12", total: 100 }),
        historyRow({ state: "Maharashtra", rto: "Pune Central RTO", date: "2026-07-13", total: 108 }),
        historyRow({ state: "Gujarat", rto: "Ahmedabad RTO", date: "2026-07-12", total: 70 }),
        historyRow({ state: "Gujarat", rto: "Ahmedabad RTO", date: "2026-07-13", total: 72 }),
      ],
    };
  },
});

assert.equal(calls.length, 2);
assert.deepEqual(calls[1].values.slice(3), [["EV"], ["2W", "3W", "4W"]]);
assert.equal(decisionInput.focalRows.filter((row) => row.reportTotal !== null).length, 2);
assert.equal(decisionInput.candidateRows.filter((row) => row.reportTotal !== null).length, 2);
assert.equal(
  decisionInput.focalRows.some((row) =>
    row.snapshotDate === "2026-07-13" &&
    row.vehicleCategory === "3W" &&
    row.scrapeStatus === "missing"),
  true,
);
assert.equal(decisionInput.dataContext.canonicalMetric, "rto_daily_scrape_reports.report_total");
assert.equal(decisionInput.dataContext.batchStatus, "ready");
assert.equal(decisionInput.asOfDate, "2026-07-26");

await assert.rejects(
  loadRtoFactorDecisionInput({
    report,
    event: {
      ...event,
      targets: [{ ...event.targets[0], geographyScope: "national", state: null }],
    },
    queryImpl: async () => ({ rows: [] }),
  }),
  (error) => error.code === "unsupported_geography_scope",
);

console.log("RTO factor data checks passed.");

function historyRow({ state, rto, date, total }) {
  return {
    snapshot_date: date,
    target_month: date.slice(0, 7),
    state,
    rto,
    fuel_group: "EV",
    vehicle_category: "2W",
    status: "success",
    report_total: total,
    filters_confirmed: true,
    explicit_zero: false,
    evidence: {},
  };
}
