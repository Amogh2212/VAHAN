import assert from "node:assert/strict";
import {
  mtdRowsToDailyIncrements,
  normalizeRtoFactorEvent,
  RTO_FACTOR_ELIGIBLE_SOURCE_TIERS,
  RTO_FACTOR_VALIDATION_DEFAULTS,
  RTO_FACTOR_VALIDATION_STATUSES,
  selectFrozenPeers,
  validateRtoFactorEvent,
} from "../lib/rto-factor-validation.mjs";

const EVENT_DATE = "2026-07-10";
const HISTORY_START = "2026-06-01";
const HISTORY_END = "2026-07-23";
const READY_CONTEXT = Object.freeze({ batchStatus: "ready", reportStatus: "ready" });

assert.deepEqual(RTO_FACTOR_ELIGIBLE_SOURCE_TIERS, ["A", "B"]);
assert.equal(RTO_FACTOR_VALIDATION_DEFAULTS.preDays, 28);
assert.equal(RTO_FACTOR_VALIDATION_DEFAULTS.postDays, 14);
assert.equal(RTO_FACTOR_VALIDATION_DEFAULTS.minCoverage, 0.9);
assert.equal(RTO_FACTOR_VALIDATION_DEFAULTS.minControls, 5);
assert.deepEqual(
  RTO_FACTOR_VALIDATION_STATUSES,
  [
    "blocked_data",
    "blocked_evidence",
    "too_early",
    "confounded",
    "no_effect",
    "mixed_evidence",
    "supported_association",
  ],
);

const baseEvent = {
  id: "event-1",
  title: "Official EV registration-fee change",
  effectiveDate: EVENT_DATE,
  scopeLevel: "rto",
  state: "Alpha",
  rto: "Alpha Central RTO",
  fuelGroup: "EV",
  vehicleCategory: "2W",
  expectedDirection: "increase",
  hypothesis: "The event may be associated with a change in EV 2W registrations.",
  sources: [
    {
      id: "source-a",
      tier: "A",
      verified: true,
      url: "https://example.gov/event",
    },
  ],
};

const normalizedEvent = normalizeRtoFactorEvent(baseEvent);
assert.equal(normalizedEvent.scopeLevel, "rto");
assert.equal(normalizedEvent.effectiveDate, EVENT_DATE);
assert.deepEqual(normalizedEvent.rtos, [{ state: "Alpha", rto: "Alpha Central RTO" }]);
assert.deepEqual(normalizedEvent.normalizationIssues, []);

const causalEvent = normalizeRtoFactorEvent({
  ...baseEvent,
  hypothesis: "The fee change caused registrations to increase.",
});
assert.ok(causalEvent.normalizationIssues.includes("causal_claim_not_allowed"));

const focalSupported = buildMtdRows({
  state: "Alpha",
  rto: "Alpha Central RTO",
  incrementForDate: (date, index) =>
    date < EVENT_DATE ? 20 + centeredCycle(index) : 40 + centeredCycle(index),
});
const candidateSupported = buildControlRows({
  count: 12,
  postChange: () => 1,
});
const supported = validateRtoFactorEvent({
  event: baseEvent,
  focalRows: focalSupported,
  candidateRows: candidateSupported,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.equal(supported.status, "supported_association");
assert.equal(supported.eligible, true);
assert.ok(supported.estimate.effect >= supported.estimate.effectThreshold);
assert.ok(supported.estimate.interval.lower > 0);
assert.equal(supported.estimate.unit, "registrations_per_day");
assert.equal(supported.coverage.focal.pre.expectedDays, 28);
assert.equal(supported.coverage.focal.post.expectedDays, 14);
assert.equal(supported.peerSelection.frozenAt, "2026-07-09");
assert.equal(supported.peerSelection.selected.length, 10);
assert.equal(supported.algorithm.controlAggregation, "median");
assert.equal(supported.algorithm.intervalMethod, "deterministic_seeded_percentile_bootstrap");
assert.doesNotMatch(
  supported.interpretation,
  /\b(caused?|because of|due to|led to|resulted in|drove|driven by)\b/i,
);
assert.doesNotThrow(() => JSON.stringify(supported), "validation output must remain JSON-serializable");

const repeatedSupported = validateRtoFactorEvent({
  event: baseEvent,
  focalRows: focalSupported,
  candidateRows: candidateSupported,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.deepEqual(
  repeatedSupported.estimate.interval,
  supported.estimate.interval,
  "the seeded bootstrap interval must be deterministic",
);

const focalOppositeDirection = buildMtdRows({
  state: "Alpha",
  rto: "Alpha Central RTO",
  incrementForDate: (date, index) =>
    date < EVENT_DATE ? 40 + centeredCycle(index) : 15 + centeredCycle(index),
});
const oppositeDirection = validateRtoFactorEvent({
  event: baseEvent,
  focalRows: focalOppositeDirection,
  candidateRows: candidateSupported,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.equal(oppositeDirection.status, "mixed_evidence");
assert.ok(oppositeDirection.estimate.effect < 0);
assert.ok(oppositeDirection.reasonCodes.includes("effect_opposes_expected_direction"));

const focalNoEffect = buildMtdRows({
  state: "Alpha",
  rto: "Alpha Central RTO",
  incrementForDate: (date, index) =>
    20 + centeredCycle(index) + (date >= EVENT_DATE ? 1 : 0),
});
const noEffect = validateRtoFactorEvent({
  event: baseEvent,
  focalRows: focalNoEffect,
  candidateRows: candidateSupported,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.equal(noEffect.status, "no_effect");
assert.ok(Math.abs(noEffect.estimate.effect) < noEffect.estimate.effectThreshold);
assert.ok(noEffect.estimate.interval.lower <= 0);
assert.ok(noEffect.estimate.interval.upper >= 0);

const focalMixed = buildMtdRows({
  state: "Alpha",
  rto: "Alpha Central RTO",
  incrementForDate: (date) => date < EVENT_DATE ? 100 : 106,
});
const mixedControls = buildControlRows({
  count: 8,
  preBase: () => 100,
  postChange: () => 0,
  variation: () => 0,
});
const mixed = validateRtoFactorEvent({
  event: baseEvent,
  focalRows: focalMixed,
  candidateRows: mixedControls,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.equal(mixed.status, "mixed_evidence");
assert.equal(mixed.estimate.effect, 6);
assert.equal(mixed.estimate.effectThreshold, 10);
assert.ok(mixed.estimate.interval.lower > 0);

const confounded = validateRtoFactorEvent({
  event: {
    ...baseEvent,
    confounders: [
      {
        id: "overlap-1",
        title: "Overlapping local transport restriction",
        relevant: true,
      },
    ],
  },
  focalRows: focalSupported,
  candidateRows: candidateSupported,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.equal(confounded.status, "confounded");
assert.deepEqual(confounded.reasonCodes, ["active_relevant_confounder"]);
assert.equal(confounded.diagnostics.activeConfounders.length, 1);

const missingDate = "2026-07-15";
const missingData = validateRtoFactorEvent({
  event: baseEvent,
  focalRows: focalSupported.filter((row) => row.snapshot_date !== missingDate),
  candidateRows: candidateSupported,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.equal(missingData.status, "blocked_data");
assert.ok(missingData.reasonCodes.includes("insufficient_focal_post_coverage"));
assert.equal(missingData.coverage.focal.post.observedDays, 12);
assert.ok(missingData.coverage.focal.post.missingDates.includes(missingDate));
assert.ok(
  missingData.coverage.focal.post.missingDates.includes("2026-07-16"),
  "the day after a missing MTD row must also stay missing because its baseline is unavailable",
);
const attemptedRelaxedCoverage = validateRtoFactorEvent({
  event: baseEvent,
  focalRows: focalSupported.filter((row) => row.snapshot_date !== missingDate),
  candidateRows: candidateSupported,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
  options: { minCoverage: 0.5 },
});
assert.equal(attemptedRelaxedCoverage.status, "blocked_data");
assert.equal(
  attemptedRelaxedCoverage.algorithm.minCoverage,
  0.9,
  "the production coverage floor must not be relaxed below 90%",
);

const monthBoundary = mtdRowsToDailyIncrements([
  readyRow({ date: "2026-06-30", total: 300 }),
  readyRow({ date: "2026-07-01", total: 7 }),
  readyRow({ date: "2026-07-02", total: 12 }),
  readyRow({ date: "2026-07-03", total: 12 }),
  readyRow({ date: "2026-07-04", total: 20 }),
], {
  from: "2026-06-30",
  to: "2026-07-04",
  metric: { fuelGroup: "EV", vehicleCategory: "2W" },
});
assert.deepEqual(
  monthBoundary.observations.map((row) => [row.snapshotDate, row.value]),
  [
    ["2026-07-01", 7],
    ["2026-07-02", 5],
    ["2026-07-03", 0],
    ["2026-07-04", 8],
  ],
  "month reset and a true unchanged-MTD zero must both be preserved",
);
const missingPredecessor = mtdRowsToDailyIncrements([
  readyRow({ date: "2026-07-01", total: 7 }),
  readyRow({ date: "2026-07-02", total: 12 }),
  readyRow({ date: "2026-07-04", total: 20 }),
], {
  from: "2026-07-01",
  to: "2026-07-04",
  metric: { fuelGroup: "EV", vehicleCategory: "2W" },
});
assert.ok(
  missingPredecessor.rejectedRows.some((row) =>
    row.snapshotDate === "2026-07-04" && row.reasonCodes.includes("missing_previous_day")),
);
assert.ok(!missingPredecessor.observations.some((row) => row.snapshotDate === "2026-07-04"));

const fourControls = buildControlRows({ count: 4, postChange: () => 1 });
const insufficientControls = validateRtoFactorEvent({
  event: baseEvent,
  focalRows: focalSupported,
  candidateRows: fourControls,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.equal(insufficientControls.status, "blocked_data");
assert.ok(insufficientControls.reasonCodes.includes("insufficient_controls"));

const blockedEvidence = validateRtoFactorEvent({
  event: {
    ...baseEvent,
    sources: [{ id: "source-c", tier: "C", verified: true }],
  },
  focalRows: focalSupported,
  candidateRows: candidateSupported,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.equal(blockedEvidence.status, "blocked_evidence");
assert.ok(blockedEvidence.reasonCodes.includes("no_verified_tier_a_or_b_source"));
assert.deepEqual(blockedEvidence.evidenceEligibility.eligibleSourceIds, []);

const unverifiedEvidence = validateRtoFactorEvent({
  event: {
    ...baseEvent,
    sources: [{ id: "source-a", tier: "A", verified: false }],
  },
  focalRows: focalSupported,
  candidateRows: candidateSupported,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.equal(unverifiedEvidence.status, "blocked_evidence");

const tooEarly = validateRtoFactorEvent({
  event: baseEvent,
  focalRows: focalSupported,
  candidateRows: candidateSupported,
  asOfDate: "2026-07-22",
  dataContext: READY_CONTEXT,
});
assert.equal(tooEarly.status, "too_early");
assert.deepEqual(tooEarly.reasonCodes, ["post_period_not_complete"]);

const noReadyContext = validateRtoFactorEvent({
  event: baseEvent,
  focalRows: focalSupported,
  candidateRows: candidateSupported,
  asOfDate: HISTORY_END,
});
assert.equal(noReadyContext.status, "blocked_data");
assert.ok(noReadyContext.reasonCodes.includes("missing_batch_status"));
assert.ok(noReadyContext.reasonCodes.includes("missing_report_status"));

const lateFillRows = focalSupported.map((row) =>
  row.snapshot_date === "2026-07-18"
    ? { ...row, scrape_status: "late_fill" }
    : row);
const lateFillBlocked = validateRtoFactorEvent({
  event: baseEvent,
  focalRows: lateFillRows,
  candidateRows: candidateSupported,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.equal(lateFillBlocked.status, "blocked_data");
assert.ok(lateFillBlocked.reasonCodes.includes("quality_issue_in_analysis_window"));
const badDataAndConfounder = validateRtoFactorEvent({
  event: {
    ...baseEvent,
    hasConfounder: true,
  },
  focalRows: lateFillRows,
  candidateRows: candidateSupported,
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.equal(
  badDataAndConfounder.status,
  "blocked_data",
  "the hard data-quality gate must take precedence over analytical interpretation",
);

const postMutatedCandidates = candidateSupported.map((row) => {
  if (row.snapshot_date < EVENT_DATE) return row;
  const peerNumber = Number(row.rto.match(/(\d+)$/)?.[1] ?? 0);
  return {
    ...row,
    report_total: row.report_total + peerNumber * 10_000,
  };
});
const originalConversion = mtdRowsToDailyIncrements(
  [...focalSupported, ...candidateSupported],
  {
    from: "2026-06-12",
    to: HISTORY_END,
    metric: { fuelGroup: "EV", vehicleCategory: "2W" },
  },
);
const mutatedConversion = mtdRowsToDailyIncrements(
  [...focalSupported, ...postMutatedCandidates],
  {
    from: "2026-06-12",
    to: HISTORY_END,
    metric: { fuelGroup: "EV", vehicleCategory: "2W" },
  },
);
const originalPeers = selectFrozenPeers({
  event: normalizedEvent,
  focalKey: "Alpha\u0000Alpha Central RTO",
  observations: originalConversion.observations,
  entities: originalConversion.entities,
  preStart: "2026-06-12",
  preEnd: "2026-07-09",
});
const mutatedPeers = selectFrozenPeers({
  event: normalizedEvent,
  focalKey: "Alpha\u0000Alpha Central RTO",
  observations: mutatedConversion.observations,
  entities: mutatedConversion.entities,
  preStart: "2026-06-12",
  preEnd: "2026-07-09",
});
assert.deepEqual(
  mutatedPeers.selected,
  originalPeers.selected,
  "post-event values must not influence the frozen peer set or similarity scores",
);

const stateEvent = {
  ...baseEvent,
  id: "state-event",
  scopeLevel: "state",
  rto: undefined,
};
const sameStateControls = buildControlRows({
  count: 5,
  stateFor: () => "Alpha",
  rtoPrefix: "Same State Peer",
  postChange: () => 1,
});
const otherStateControls = buildControlRows({
  count: 6,
  stateFor: () => "Beta",
  rtoPrefix: "Other State Peer",
  postChange: () => 1,
});
const stateValidation = validateRtoFactorEvent({
  event: stateEvent,
  focalRows: focalSupported,
  candidateRows: [...sameStateControls, ...otherStateControls],
  asOfDate: HISTORY_END,
  dataContext: READY_CONTEXT,
});
assert.equal(stateValidation.status, "supported_association");
assert.ok(stateValidation.peerSelection.selected.every((peer) => peer.state === "Beta"));
assert.ok(
  stateValidation.peerSelection.excluded
    .filter((peer) => peer.state === "Alpha")
    .every((peer) => peer.reasonCodes.includes("same_state_exposure")),
);

console.log("RTO factor validation checks passed (supported, no-effect, mixed, confounded, coverage, month reset, evidence, readiness, and no-leakage peers).");

function buildControlRows({
  count,
  preBase = (index) => 18 + index,
  postChange = () => 0,
  variation = (_date, dateIndex) => centeredCycle(dateIndex),
  stateFor = () => "Alpha",
  rtoPrefix = "Peer RTO",
}) {
  return Array.from({ length: count }, (_, peerIndex) => buildMtdRows({
    state: stateFor(peerIndex),
    rto: `${rtoPrefix} ${String(peerIndex + 1).padStart(2, "0")}`,
    incrementForDate: (date, dateIndex) =>
      preBase(peerIndex)
      + variation(date, dateIndex, peerIndex)
      + (date >= EVENT_DATE ? postChange(peerIndex) : 0),
  })).flat();
}

function buildMtdRows({
  state,
  rto,
  incrementForDate,
  start = HISTORY_START,
  end = HISTORY_END,
}) {
  const rows = [];
  let runningTotal = 0;
  let currentMonth = null;
  let dateIndex = 0;
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const month = date.slice(0, 7);
    if (month !== currentMonth) {
      currentMonth = month;
      runningTotal = 0;
    }
    const increment = incrementForDate(date, dateIndex);
    assert.ok(Number.isInteger(increment) && increment >= 0, `Invalid synthetic increment ${increment}`);
    runningTotal += increment;
    rows.push(readyRow({
      state,
      rto,
      date,
      total: runningTotal,
    }));
    dateIndex += 1;
  }
  return rows;
}

function readyRow({
  state = "Alpha",
  rto = "Alpha Central RTO",
  date,
  total,
}) {
  return {
    state,
    rto,
    snapshot_date: date,
    target_month: date.slice(0, 7),
    fuel_group: "EV",
    vehicle_category: "2W",
    report_total: total,
    scrape_status: "success",
    quality_status: "ready",
    quality_flags: {},
  };
}

function centeredCycle(index) {
  return (index % 3) - 1;
}

function addDays(value, amount) {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + amount * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
