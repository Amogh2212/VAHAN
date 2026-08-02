import assert from "node:assert/strict";
import {
  assertDailyAutomationWriteEnabled,
  listPendingRtoFactorValidations,
  runPendingRtoFactorValidations,
} from "../lib/rto-factor-daily-automation.mjs";
import { parseArgs } from "./run-rto-factor-daily-automation.mjs";

const candidate = {
  eventId: 41,
  eventTitle: "State EV incentive",
  effectiveStart: "2026-07-01",
  reportId: 501,
  state: "Maharashtra",
  rto: "Pune Central RTO",
  reportStatus: "ready",
  batchId: 91,
  batchStatus: "ready",
  reportRevision: 2,
  reportSourceChecksum: "a".repeat(64),
  sourceSnapshotDate: "2026-07-26",
};

const calls = [];
const result = await runPendingRtoFactorValidations({
  asOfDate: "2026-07-30",
  write: true,
  providerName: "none",
  env: { FACTOR_AGENT_ENABLED: "1", FACTOR_AGENT_MODE: "draft_only" },
  dependencies: {
    listCandidates: async () => [candidate, { ...candidate, eventId: 42, reportId: 502 }],
    runAgent: async (input) => {
      calls.push(input);
      if (input.eventId === 42) throw new Error("Expected validation failure");
      return {
        validation: { status: "supported_association", reasonCodes: ["confidence_interval_excludes_zero"] },
        persistedValidation: { id: 701 },
        persistedExplanation: { id: 801 },
      };
    },
  },
});
assert.equal(result.mode, "write_drafts_only");
assert.equal(result.candidateCount, 2);
assert.equal(result.validationCount, 1);
assert.equal(result.errorCount, 1);
assert.equal(result.statusCounts.supported_association, 1);
assert.equal(result.statusCounts.error, 1);
assert.equal(result.validations[0].publicationStatus, "draft_pending_human_review");
assert.equal(calls[0].asOfDate, "2026-07-26");
assert.equal(calls[0].createdByLabel, "rto-factor-daily-automation");

const queryCalls = [];
const listed = await listPendingRtoFactorValidations({
  limit: 999,
  queryImpl: async (sql, values) => {
    queryCalls.push({ sql, values });
    return {
      rows: [{
        event_id: 41,
        event_title: "State EV incentive",
        effective_start: "2026-07-01",
        report_id: 501,
        state: "Maharashtra",
        rto: "Pune Central RTO",
        report_status: "ready",
        batch_id: 91,
        batch_status: "ready",
        report_revision: 2,
        report_source_checksum: "a".repeat(64),
        source_snapshot_date: "2026-07-26",
      }],
    };
  },
});
assert.equal(listed[0].eventId, 41);
assert.equal(listed[0].reportId, 501);
assert.equal(queryCalls[0].values[0], 500);
assert.match(queryCalls[0].sql, /latest_daily_reports/i);
assert.match(queryCalls[0].sql, /not exists[\s\S]*rto_factor_validations/i);

assert.throws(() => assertDailyAutomationWriteEnabled({}), /FACTOR_DAILY_AUTOMATION_ENABLED=1/);
assert.throws(
  () => assertDailyAutomationWriteEnabled({ FACTOR_DAILY_AUTOMATION_ENABLED: "1" }),
  /FACTOR_AGENT_ENABLED=1/,
);
assert.throws(
  () => assertDailyAutomationWriteEnabled({
    FACTOR_DAILY_AUTOMATION_ENABLED: "1",
    FACTOR_AGENT_ENABLED: "1",
    FACTOR_AGENT_MODE: "publish",
  }),
  /FACTOR_AGENT_MODE=draft_only/,
);
assert.doesNotThrow(() => assertDailyAutomationWriteEnabled({
  FACTOR_DAILY_AUTOMATION_ENABLED: "1",
  FACTOR_AGENT_ENABLED: "1",
  FACTOR_AGENT_MODE: "draft_only",
}));

assert.equal(parseArgs(["--write", "--validation-limit", "20"]).write, true);
assert.equal(parseArgs(["--dry-run", "--skip-source-collection"]).skipSourceCollection, true);
assert.equal(parseArgs(["--provider", "ollama"]).provider, "ollama");
assert.throws(() => parseArgs(["--write", "--dry-run"]), /cannot be combined/);
assert.throws(() => parseArgs(["--provider", "unknown"]), /--provider must be/);

console.log("RTO factor daily automation checks passed.");
