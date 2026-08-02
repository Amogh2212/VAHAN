import assert from "node:assert/strict";
import { closePool, query } from "../lib/db.mjs";
import {
  getRtoReport,
  getRtoReportReadiness,
  listRtoReportsForBatch,
  RTO_REPORT_EXPECTED_OEM_ROWS_PER_RTO,
  reconcileRecentRtoReports,
  reconcileRtoReportsForRun,
} from "../lib/rto-reports.mjs";

const FIXTURE_STATE = "__CODEX_RTO_REPORT_INTEGRATION__";
const FIXTURE_RTO_PREFIX = "__REPORT_RTO_";
const COHORT_HASH = "integration-rto-report-cohort-v1";
const CURRENT_DATE = "2099-05-31";
const PREVIOUS_DATE = "2099-05-30";
const TARGET_MONTH = "2099-05";

let previousRunId = null;
let currentRunId = null;

try {
  await cleanupFixture();
  await seedConfigs();
  previousRunId = await seedRun(PREVIOUS_DATE, null, 0);
  currentRunId = await seedRun(CURRENT_DATE, COHORT_HASH, 100);
  await seedJobs(previousRunId, PREVIOUS_DATE);
  await seedJobs(currentRunId, CURRENT_DATE);
  await seedScrapeReports(previousRunId, PREVIOUS_DATE, 0);
  await seedScrapeReports(currentRunId, CURRENT_DATE, 10);
  await freezeCurrentCohort();

  const incompleteReadiness = await getRtoReportReadiness({ runId: currentRunId });
  assert.equal(incompleteReadiness.eligible, false);
  assert.equal(incompleteReadiness.reason, "cohort_incomplete");
  assert.equal(incompleteReadiness.missingRtos[0].missingOemRows, RTO_REPORT_EXPECTED_OEM_ROWS_PER_RTO);

  await seedOemSnapshots(previousRunId);
  await seedOemSnapshots(currentRunId);

  const readiness = await getRtoReportReadiness({ runId: currentRunId });
  assert.equal(readiness.eligible, true);
  assert.equal(readiness.expectedOems, 15);
  assert.equal(readiness.expectedOemRowsPerRto, 90);
  assert.equal(readiness.cohortSize, 100);
  assert.equal(readiness.completeRtos, 100);

  const first = await reconcileRtoReportsForRun({
    runId: currentRunId,
    includeAvailableHistory: true,
    historyFrom: PREVIOUS_DATE,
  });
  assert.equal(first.materialized.totals, 1_200);
  assert.equal(first.materialized.oems, 18_000);
  assert.deepEqual(
    first.batches.map((entry) => entry.batch.cadence),
    ["daily", "weekly", "monthly"],
    "a Sunday month-end run must create all three report batches",
  );
  assert.ok(first.batches.every((entry) => entry.generated));
  assert.ok(first.batches.every((entry) => entry.batch.reportCount === 100));

  const dailyBatch = first.batches.find((entry) => entry.batch.cadence === "daily").batch;
  const summaries = await listRtoReportsForBatch(dailyBatch.id, { limit: 100 });
  assert.equal(summaries.length, 100);

  const report = await getRtoReport(summaries[0].id);
  assert.equal(report.periodEv, 30);
  assert.equal(report.periodIce, 30);
  assert.equal(report.payload.categories.length, 3);
  const fixtureOem = report.payload.oems.find((row) => row.oem === "Fixture Motors");
  const untrackedOem = report.payload.oems.find((row) => row.oem === "Other / untracked");
  assert.ok(fixtureOem, "the OEM breakdown must retain tracked maker data");
  assert.ok(untrackedOem, "the OEM breakdown must expose the headline/OEM residual");
  const trackedPeriodTotal = report.payload.oems
    .filter((row) => row.oem !== "Other / untracked")
    .reduce((sum, row) => sum + row.period.total, 0);
  assert.equal(trackedPeriodTotal, 60);
  assert.equal(untrackedOem.mtd.total, 30);

  const second = await reconcileRtoReportsForRun({
    runId: currentRunId,
    includeAvailableHistory: true,
    historyFrom: PREVIOUS_DATE,
  });
  assert.ok(second.batches.every((entry) => entry.generated === false));
  assert.ok(second.batches.every((entry) => entry.reason === "unchanged"));
  assert.deepEqual(
    second.batches.map((entry) => entry.batch.revision),
    first.batches.map((entry) => entry.batch.revision),
  );

  const recent = await reconcileRecentRtoReports({ limit: 1 });
  assert.equal(recent.runs.length, 1);
  assert.ok(recent.runs[0].batches.every((entry) => entry.generated === false));

  console.log("RTO report Postgres integration checks passed.");
} finally {
  await cleanupFixture().catch((error) => {
    console.error(`Fixture cleanup failed: ${error.message}`);
  });
  await closePool();
}

async function seedConfigs() {
  await query(
    `
      insert into rto_daily_snapshot_configs (state, rto, enabled, priority)
      select
        $1,
        $2 || lpad(series::text, 3, '0'),
        true,
        series
      from generate_series(1, 100) as series
    `,
    [FIXTURE_STATE, FIXTURE_RTO_PREFIX],
  );
}

async function seedRun(snapshotDate, cohortHash, cohortSize) {
  const result = await query(
    `
      insert into rto_daily_collection_runs (
        status,
        started_at,
        completed_at,
        attempted_rtos,
        succeeded_rtos,
        failed_rtos,
        snapshot_date,
        target_month,
        worker_count,
        total_rtos,
        report_cohort_hash,
        report_cohort_size,
        metadata
      )
      values (
        'success',
        $1::date + time '02:00',
        $1::date + time '03:00',
        100,
        100,
        0,
        $1::date,
        $2,
        1,
        100,
        $3,
        $4,
        '{"fixture":"rto-reports-integration-check"}'::jsonb
      )
      returning id
    `,
    [snapshotDate, TARGET_MONTH, cohortHash, cohortSize],
  );
  return Number(result.rows[0].id);
}

async function seedJobs(runId, snapshotDate) {
  await query(
    `
      insert into rto_daily_jobs (
        run_id,
        config_id,
        snapshot_date,
        target_month,
        state,
        rto,
        status,
        queue_priority,
        queue_reason,
        attempts,
        started_at,
        completed_at
      )
      select
        $1,
        c.id,
        $2::date,
        $3,
        c.state,
        c.rto,
        'success',
        c.priority,
        'rotation',
        1,
        $2::date + time '02:00',
        $2::date + time '03:00'
      from rto_daily_snapshot_configs c
      where c.state = $4
    `,
    [runId, snapshotDate, TARGET_MONTH, FIXTURE_STATE],
  );
}

async function seedScrapeReports(runId, snapshotDate, dayIncrement) {
  await query(
    `
      insert into rto_daily_scrape_reports (
        run_id,
        job_id,
        snapshot_date,
        target_month,
        state,
        rto,
        fuel_group,
        vehicle_category,
        status,
        report_total,
        source_row_count,
        attempts,
        filters_confirmed,
        explicit_zero,
        scraped_at,
        evidence
      )
      select
        $1,
        j.id,
        $2::date,
        $3,
        j.state,
        j.rto,
        combo.fuel_group,
        combo.vehicle_category,
        'success',
        combo.base_total + c.priority + $4,
        1,
        1,
        true,
        false,
        $2::date + time '03:00',
        '{"fixture":true}'::jsonb
      from rto_daily_jobs j
      join rto_daily_snapshot_configs c on c.id = j.config_id
      cross join (
        values
          ('EV', '2W', 120),
          ('EV', '3W', 30),
          ('EV', '4W', 50),
          ('ICE', '2W', 500),
          ('ICE', '3W', 80),
          ('ICE', '4W', 220)
      ) as combo(fuel_group, vehicle_category, base_total)
      where j.run_id = $1
    `,
    [runId, snapshotDate, TARGET_MONTH, dayIncrement],
  );
}

async function seedOemSnapshots(runId) {
  await query(
    `
      insert into rto_daily_snapshots (
        snapshot_date,
        target_month,
        state,
        rto,
        fuel_group,
        vehicle_category,
        oem,
        vehicle_count,
        source,
        scrape_status,
        scrape_run_id,
        report_id,
        scraped_at,
        raw
      )
      select
        r.snapshot_date,
        r.target_month,
        r.state,
        r.rto,
        r.fuel_group,
        r.vehicle_category,
        case
          when oem_index = 1 then 'Fixture Motors'
          else 'Fixture OEM ' || lpad(oem_index::text, 2, '0')
        end,
        ((r.report_total - 5) / 15)
          + case when oem_index <= mod(r.report_total - 5, 15) then 1 else 0 end,
        'rto-reports-integration-check',
        'success',
        r.run_id,
        r.id,
        r.scraped_at,
        '{"fixture":true}'::jsonb
      from rto_daily_scrape_reports r
      cross join generate_series(1, 15) as oem_index
      where r.run_id = $1
    `,
    [runId],
  );
}

async function freezeCurrentCohort() {
  await query(
    `
      insert into rto_daily_run_cohort_members (
        run_id,
        config_id,
        snapshot_date,
        target_month,
        state,
        rto,
        cohort_rank
      )
      select
        $1,
        c.id,
        $2::date,
        $3,
        c.state,
        c.rto,
        c.priority
      from rto_daily_snapshot_configs c
      where c.state = $4
      order by c.priority
    `,
    [currentRunId, CURRENT_DATE, TARGET_MONTH, FIXTURE_STATE],
  );
}

async function cleanupFixture() {
  await query("delete from rto_report_batches where cohort_hash = $1", [COHORT_HASH]);
  await query("delete from rto_daily_report_totals where state = $1", [FIXTURE_STATE]);
  await query("delete from rto_daily_oem_totals where state = $1", [FIXTURE_STATE]);
  await query("delete from rto_daily_snapshots where state = $1", [FIXTURE_STATE]);
  await query(
    `
      delete from rto_daily_collection_runs
      where metadata ->> 'fixture' = 'rto-reports-integration-check'
    `,
  );
  await query("delete from rto_daily_snapshot_configs where state = $1", [FIXTURE_STATE]);
}
