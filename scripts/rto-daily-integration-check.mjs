import assert from "node:assert/strict";
import process from "node:process";
import { closePool, query } from "../lib/db.mjs";
import {
  RTO_DAILY_CATEGORIES,
  RTO_DAILY_FUEL_GROUPS,
  buildSnapshotRows,
  claimRtoDailyJob,
  completeRtoDailyJob,
  createRtoDailyPin,
  deferStaleRtoDailyCycles,
  deleteRtoDailyPin,
  enqueueRtoDailyJob,
  ensureRtoDailyCycle,
  failRtoDailyJob,
  finalizeRtoDailyCycle,
  findCarryoverRtoDailyCycle,
  getRtoDailyCoverage,
  listRtoDailyPins,
  requeueDeferredRtoDailyJobs,
  rolloverRtoDailyCycle,
  upsertRtoDailyConfigs,
} from "../lib/rto-daily-snapshots.mjs";
import { acquireVahanScrapeLock } from "../lib/vahan-scrape-lock.mjs";

const STATE = "__RTO_DAILY_INTEGRATION_TEST__";
const RTO = "TEST RTO";
const DATE = "2099-12-30";
const PRIORITY_DATE = "2099-12-31";
const STALE_DATE = "2099-12-01";
const PIN_RTO = "PIN TEST RTO";
const LOOKUP_RTO = "LOOKUP TEST RTO";
const ROTATION_RTO = "ROTATION TEST RTO";
const ROLLOVER_RTO = "ROLLOVER TEST RTO";
const ROLLOVER_SOURCE_DATE = "2099-12-02";
const ROLLOVER_CURRENT_DATE = "2099-12-03";

function assertLocalDatabase() {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname), "integration check only runs against local PostgreSQL");
}

async function cleanup() {
  await query("delete from rto_daily_snapshots where state = $1", [STATE]);
  await query("delete from rto_daily_collection_runs where snapshot_date in ($1::date, $2::date, $3::date, $4::date, $5::date) and target_month = '2099-12'", [DATE, PRIORITY_DATE, STALE_DATE, ROLLOVER_SOURCE_DATE, ROLLOVER_CURRENT_DATE]);
  await query("delete from rto_daily_snapshot_configs where state = $1", [STATE]);
  await query("delete from users where google_sub like '__rto_daily_integration_%'", []);
}

async function main() {
  assertLocalDatabase();
  const releaseLock = await acquireVahanScrapeLock("integration-owner");
  await assert.rejects(
    () => acquireVahanScrapeLock("integration-contender"),
    /already running/,
    "the shared scrape lock should prevent tracked and RTO collectors from overlapping",
  );
  const waitingLock = acquireVahanScrapeLock("integration-waiting-contender", { waitMs: 1000, retryMs: 25 });
  setTimeout(() => releaseLock(), 100);
  const releaseWaitedLock = await waitingLock;
  await releaseWaitedLock();
  const releaseReclaimedLock = await acquireVahanScrapeLock("integration-reclaimed");
  await releaseReclaimedLock();
  await cleanup();
  try {
    await upsertRtoDailyConfigs([{ state: STATE, rto: RTO, enabled: true, priority: 1 }]);
    const run = await ensureRtoDailyCycle({ snapshotDate: DATE, targetMonth: "2099-12", workerCount: 2, state: STATE });
    const [left, right] = await Promise.all([
      claimRtoDailyJob({ runId: run.id, workerId: "integration-a" }),
      claimRtoDailyJob({ runId: run.id, workerId: "integration-b" }),
    ]);
    const first = left ?? right;
    assert.ok(first, "one worker should claim the test job");
    assert.equal(first.snapshotDate, DATE, "PostgreSQL date values must retain their IST calendar date");
    assert.equal(Boolean(left) + Boolean(right), 1, "SKIP LOCKED should prevent duplicate claims");

    const retry = await failRtoDailyJob({ jobId: first.id, workerId: first.workerId, error: "fixture retry", maxAttempts: 3 });
    assert.equal(retry.status, "retrying");
    await query("update rto_daily_jobs set next_attempt_at = now() where id = $1", [first.id]);
    const second = await claimRtoDailyJob({ runId: run.id, workerId: "integration-c" });
    assert.equal(second.attempts, 2);
    await query("update rto_daily_jobs set lease_expires_at = now() - interval '1 minute' where id = $1", [second.id]);
    const reclaimed = await claimRtoDailyJob({ runId: run.id, workerId: "integration-d" });
    assert.equal(reclaimed.attempts, 3, "expired running leases should be reclaimable");

    const reports = [];
    const rows = [];
    for (const fuelGroup of RTO_DAILY_FUEL_GROUPS) {
      for (const vehicleCategory of RTO_DAILY_CATEGORIES) {
        reports.push({
          status: "success", state: STATE, rto: RTO, fuelGroup, vehicleCategory,
          filtersConfirmed: true, reportTotal: 0, explicitZero: true, rows: [],
          attempts: 1, scrapedAt: new Date().toISOString(), evidence: { fixture: true },
        });
        rows.push(...buildSnapshotRows({
          sourceRows: [], state: STATE, rto: RTO, snapshotDate: DATE, targetMonth: "2099-12",
          fuelGroup, vehicleCategory,
          metadata: { scrapeRunId: run.id, scrapeStatus: "late_fill", scrapedAt: new Date().toISOString() },
        }));
      }
    }
    const completed = await completeRtoDailyJob({ job: reclaimed, workerId: "integration-d", reports, rows });
    assert.deepEqual(completed, { reports: 6, rows: 90 });
    const finalized = await finalizeRtoDailyCycle(run.id);
    assert.equal(finalized.run.status, "success");
    const coverage = await getRtoDailyCoverage({ date: DATE });
    assert.equal(coverage.summary.completionPercent, 100);
    assert.equal(coverage.summary.succeeded, 1);
    assert.equal(coverage.summary.successRtos, 0);
    assert.equal(coverage.summary.lateFillRtos, 1, "coverage should expose completed late-fill RTOs separately");
    assert.equal(coverage.summary.pendingRtos, 0);
    assert.equal(coverage.summary.coveragePercent, 100);

    const firstUser = await query(
      "insert into users (google_sub, email) values ('__rto_daily_integration_a__', 'rto-a@example.test') returning id",
    );
    const secondUser = await query(
      "insert into users (google_sub, email) values ('__rto_daily_integration_b__', 'rto-b@example.test') returning id",
    );
    const userA = firstUser.rows[0].id;
    const userB = secondUser.rows[0].id;
    const firstPin = await createRtoDailyPin({ userId: userA, state: STATE, rto: PIN_RTO, maxPins: 1 });
    const duplicatePin = await createRtoDailyPin({ userId: userA, state: STATE, rto: PIN_RTO, maxPins: 1 });
    assert.equal(firstPin.created, true);
    assert.equal(duplicatePin.created, false, "pinning the same RTO should be idempotent");
    await assert.rejects(
      () => createRtoDailyPin({ userId: userA, state: STATE, rto: LOOKUP_RTO, maxPins: 1 }),
      /pin up to 1 RTO/,
      "the per-account pin cap must be transactional",
    );
    await createRtoDailyPin({ userId: userB, state: STATE, rto: PIN_RTO, maxPins: 1 });
    await upsertRtoDailyConfigs([
      { state: STATE, rto: LOOKUP_RTO, enabled: true, priority: 100 },
      { state: STATE, rto: ROTATION_RTO, enabled: true, priority: 100 },
      { state: STATE, rto: ROLLOVER_RTO, enabled: true, priority: 100 },
    ]);
    const pinnedJob = await enqueueRtoDailyJob({ state: STATE, rto: PIN_RTO, snapshotDate: PRIORITY_DATE, targetMonth: "2099-12", reason: "pin" });
    const duplicateJob = await enqueueRtoDailyJob({ state: STATE, rto: PIN_RTO, snapshotDate: PRIORITY_DATE, targetMonth: "2099-12", reason: "pin" });
    assert.equal(pinnedJob.id, duplicateJob.id, "duplicate pins must share one daily scrape job");
    await enqueueRtoDailyJob({ state: STATE, rto: LOOKUP_RTO, snapshotDate: PRIORITY_DATE, targetMonth: "2099-12", reason: "lookup" });
    const priorityRun = await ensureRtoDailyCycle({ snapshotDate: PRIORITY_DATE, targetMonth: "2099-12", state: STATE });
    const pinClaim = await claimRtoDailyJob({ runId: priorityRun.id, workerId: "priority-pin" });
    const lookupClaim = await claimRtoDailyJob({ runId: priorityRun.id, workerId: "priority-lookup" });
    const rotationClaim = await claimRtoDailyJob({ runId: priorityRun.id, workerId: "priority-rotation" });
    assert.equal(pinClaim.queueReason, "pin");
    assert.equal(lookupClaim.queueReason, "lookup");
    assert.equal(rotationClaim.queueReason, "rotation");
    await query("update rto_daily_jobs set status = 'queued', worker_id = null, lease_expires_at = null where run_id = $1", [priorityRun.id]);
    const staleRun = await ensureRtoDailyCycle({ snapshotDate: STALE_DATE, targetMonth: "2099-12", state: STATE, maxJobs: 1 });
    await query("update rto_daily_jobs set status = 'queued', worker_id = null, lease_expires_at = null where run_id = $1", [staleRun.id]);
    const carryover = await findCarryoverRtoDailyCycle({ beforeDate: "2100-01-01", state: STATE });
    assert.equal(carryover.id, priorityRun.id, "manual carryover lookup should find a recent unfinished prior cycle");
    const ancientCarryover = await findCarryoverRtoDailyCycle({ beforeDate: "2100-01-15", state: STATE });
    assert.equal(ancientCarryover, null, "default carryover must ignore old historical partial cycles");
    const deferred = await deferStaleRtoDailyCycles({ beforeDate: "2100-01-01", state: STATE });
    assert.ok(deferred.jobs >= 3, "unfinished prior-day jobs should become deferred");
    const requeuedDeferred = await requeueDeferredRtoDailyJobs({ runId: priorityRun.id, state: STATE });
    assert.ok(requeuedDeferred.count >= 3, "deferred jobs from older policy runs should be recoverable for carryover");

    const rolloverSource = await ensureRtoDailyCycle({
      snapshotDate: ROLLOVER_SOURCE_DATE,
      targetMonth: "2099-12",
      state: STATE,
      rto: ROLLOVER_RTO,
    });
    const rolloverCandidate = await findCarryoverRtoDailyCycle({
      beforeDate: ROLLOVER_CURRENT_DATE,
      state: STATE,
      rto: ROLLOVER_RTO,
    });
    assert.equal(rolloverCandidate.id, rolloverSource.id, "the unfinished prior-day cycle should be selected for rollover");
    const rollover = await rolloverRtoDailyCycle({
      sourceRunId: rolloverSource.id,
      snapshotDate: ROLLOVER_CURRENT_DATE,
      targetMonth: "2099-12",
      state: STATE,
      rto: ROLLOVER_RTO,
    });
    assert.equal(rollover.snapshotDate, ROLLOVER_CURRENT_DATE, "unfinished work should use the current fetch date");
    const rolloverJob = await query("select snapshot_date::text as snapshot_date from rto_daily_jobs where run_id = $1", [rollover.id]);
    assert.equal(rolloverJob.rows[0]?.snapshot_date, ROLLOVER_CURRENT_DATE, "rolled-over jobs should be dated in the new cycle");
    const repeatedRollover = await findCarryoverRtoDailyCycle({
      beforeDate: ROLLOVER_CURRENT_DATE,
      state: STATE,
      rto: ROLLOVER_RTO,
    });
    assert.equal(repeatedRollover, null, "transferred prior-day jobs must not be rolled over repeatedly");
    const userAPins = await listRtoDailyPins({ userId: userA });
    const userBPins = await listRtoDailyPins({ userId: userB });
    assert.equal(userAPins.length, 1);
    assert.equal(userBPins.length, 1, "pins must remain private per account");
    await deleteRtoDailyPin(firstPin.pin.id, { userId: userA });
    assert.equal((await listRtoDailyPins({ userId: userA })).length, 0);
    assert.equal((await listRtoDailyPins({ userId: userB })).length, 1, "unpinning one account must not remove another account's pin");
    console.log("RTO daily integration checks passed.");
  } finally {
    await cleanup();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
