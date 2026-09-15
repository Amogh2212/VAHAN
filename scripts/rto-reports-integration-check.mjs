import assert from "node:assert/strict";
import { closePool, query } from "../lib/db.mjs";
import {
  getRtoReport,
  getRtoReportReadiness,
  listRtoReportsForBatch,
  reconcileRtoReportsForRun,
} from "../lib/rto-reports.mjs";

const FIXTURE_STATE = "__CODEX_RTO_REGISTRATION_REPORT_INTEGRATION__";
const FIXTURE_RTO_PREFIX = "__REGISTRATION_REPORT_RTO_";
const COHORT_HASH = "integration-rto-registration-report-cohort-v1";
const CURRENT_DATE = "2099-05-31";
const PREVIOUS_DATE = "2099-05-30";
const TARGET_MONTH = "2099-05";
const METRIC_KIND = "registration_month_to_date";
const SOURCE = "vahan-public-dashboard";
const SOURCE_CONTRACT = "public-registration-mtd-v1";
const OEM_REASON = "The Public Dashboard maker chart does not expose an exact target-month contract.";

let previousRunId = null;
let currentRunId = null;

try {
  assertLocalDatabase();
  await cleanupFixture();
  await seedConfigs();
  previousRunId = await seedRun(PREVIOUS_DATE, null, 0);
  currentRunId = await seedRun(CURRENT_DATE, COHORT_HASH, 100);
  await seedJobs(previousRunId, PREVIOUS_DATE);
  await seedJobs(currentRunId, CURRENT_DATE);
  await seedScrapeReports(previousRunId, PREVIOUS_DATE, 0);
  await seedScrapeReports(currentRunId, CURRENT_DATE, 10);
  await freezeCurrentCohort();

  const baselineReadiness = await getRtoReportReadiness({ runId: currentRunId });
  assert.equal(baselineReadiness.collectionEligible, true);
  assert.equal(baselineReadiness.cohortSize, 100);
  assert.equal(baselineReadiness.completeRtos, 100);
  assert.equal(baselineReadiness.oemContractRtos, 0);
  assert.equal(baselineReadiness.gates.oemSourceContractValidity.passed, false);
  assert.equal(baselineReadiness.comparisonEligibleRtos, 0);
  assert.equal(baselineReadiness.dailyRegistrationEligible, false);
  assert.equal(baselineReadiness.gates.dailyReportUsability.passed, false);

  await seedRegistrationObservations(previousRunId);
  await seedRegistrationObservations(currentRunId);

  const readiness = await getRtoReportReadiness({ runId: currentRunId });
  assert.equal(readiness.collectionEligible, true);
  assert.equal(readiness.dailyRegistrationEligible, true);
  assert.equal(readiness.expectedRtos, 100);
  assert.equal(readiness.expectedOems, 5);
  assert.equal(readiness.expectedOemRowsPerRto, 30);
  assert.equal(readiness.cohortSize, 100);
  assert.equal(readiness.completeRtos, 100);
  assert.equal(readiness.comparisonEligibleRtos, 100);
  assert.equal(readiness.previousDayEligibleRtos, 0);
  assert.equal(readiness.oemContractRtos, 0);
  assert.equal(readiness.gates.collectionCompletion.passed, true);
  assert.equal(readiness.gates.cohortCoverage.passed, true);
  assert.equal(readiness.gates.sixScopesPerRto.passed, true);
  assert.equal(readiness.gates.registrationSourceValidity.passed, true);
  assert.equal(readiness.gates.oemSourceContractValidity.passed, false);
  assert.equal(readiness.gates.comparisonEligibility.passed, true);
  assert.equal(readiness.gates.dailyReportUsability.passed, true);

  const first = await reconcileRtoReportsForRun({
    runId: currentRunId,
    includeAvailableHistory: true,
    historyFrom: PREVIOUS_DATE,
  });
  assert.equal(first.materialized.totals, 1_200);
  assert.equal(first.materialized.oems, 0, "unverified maker evidence must not materialize OEM rows");
  assert.deepEqual(
    first.batches.map((entry) => entry.batch.cadence),
    ["daily"],
    "a registration observation run must publish only the Daily registration cadence",
  );
  assert.ok(first.batches.every((entry) => entry.generated));
  assert.ok(first.batches.every((entry) => entry.batch.reportCount === 100));

  const dailyBatch = first.batches.find((entry) => entry.batch.cadence === "daily").batch;
  const summaries = await listRtoReportsForBatch(dailyBatch.id, { limit: 100 });
  assert.equal(summaries.length, 100);

  const report = await getRtoReport(summaries[0].id);
  assert.equal(report.periodEv, 30);
  assert.equal(report.periodIce, 30);
  assert.equal(report.payload.dailyRegistration.previousDayRegistrations.value, null);
  assert.equal(report.payload.metrics.sourceMonthToDate.ev, 230 + Number(report.selectionRank) * 3);
  assert.equal(report.payload.metrics.activeStock.ev, null);
  assert.equal(report.payload.categories.length, 3);
  assert.deepEqual(report.payload.oems, []);
  assert.equal(report.payload.oemEvidence.status, "unavailable");
  assert.match(report.payload.oemEvidence.reason, /target-month contract/i);
  assert.equal(report.payload.source.metricKind, METRIC_KIND);
  assert.equal(report.payload.source.requestHashes.length, 6);
  assert.equal(report.payload.source.responseHashes.length, 6);

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

  console.log("RTO registration report Postgres integration checks passed.");
} finally {
  await cleanupFixture().catch((error) => {
    console.error(`Fixture cleanup failed: ${error.message}`);
  });
  await closePool();
}

function assertLocalDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname), "integration check only runs against local PostgreSQL");
}

async function seedConfigs() {
  await query(
    `insert into rto_daily_snapshot_configs (state, rto, enabled, priority)
     select $1, $2 || lpad(series::text, 3, '0'), true, series
     from generate_series(1, 100) as series`,
    [FIXTURE_STATE, FIXTURE_RTO_PREFIX],
  );
}

async function seedRun(snapshotDate, cohortHash, cohortSize) {
  const result = await query(
    `insert into rto_daily_collection_runs (
       status, started_at, completed_at, attempted_rtos, succeeded_rtos, failed_rtos,
       snapshot_date, target_month, worker_count, total_rtos, report_cohort_hash,
       report_cohort_size, metric_kind, source, metadata
     ) values (
       'success', ($1 || 'T09:00:00+05:30')::timestamptz, ($1 || 'T10:00:00+05:30')::timestamptz,
       100, 100, 0, $1::date, $2, 1, 100, $3, $4, $5, $6,
       '{"fixture":"rto-registration-reports-integration-check"}'::jsonb
     ) returning id`,
    [snapshotDate, TARGET_MONTH, cohortHash, cohortSize, METRIC_KIND, SOURCE],
  );
  return Number(result.rows[0].id);
}

async function seedJobs(runId, snapshotDate) {
  await query(
    `insert into rto_daily_jobs (
       run_id, config_id, snapshot_date, target_month, state, rto, status,
       queue_priority, queue_reason, attempts, started_at, completed_at
     )
     select $1, c.id, $2::date, $3, c.state, c.rto, 'success',
       c.priority, 'rotation', 1,
       ($2 || 'T09:00:00+05:30')::timestamptz,
       ($2 || 'T10:00:00+05:30')::timestamptz
     from rto_daily_snapshot_configs c where c.state = $4`,
    [runId, snapshotDate, TARGET_MONTH, FIXTURE_STATE],
  );
}

async function seedScrapeReports(runId, snapshotDate, dayIncrement) {
  await query(
    `insert into rto_daily_scrape_reports (
       run_id, job_id, snapshot_date, target_month, state, rto, fuel_group,
       vehicle_category, status, report_total, source_row_count, attempts,
       filters_confirmed, explicit_zero, metric_kind, source, scraped_at, evidence
     )
     select
       $1, j.id, $2::date, $3::text, j.state, j.rto, combo.fuel_group,
       combo.vehicle_category, 'success', combo.base_total + c.priority + $4,
       0, 1, true, false, $5, $6,
       ($2 || 'T10:00:00+05:30')::timestamptz,
       jsonb_build_object(
         'filters', jsonb_build_object(
           'stateCode', 'ZZ',
           'rtoCode', c.priority::text,
           'vehicleCategories', case combo.vehicle_category
             when '2W' then jsonb_build_array('TWO WHEELER(NT)', 'TWO WHEELER(T)')
             when '3W' then jsonb_build_array('THREE WHEELER(NT)', 'THREE WHEELER(T)')
             else jsonb_build_array('LIGHT MOTOR VEHICLE', 'LIGHT PASSENGER VEHICLE') end,
           'vehicleClasses', '[]'::jsonb,
           'fuels', case combo.fuel_group
             when 'EV' then jsonb_build_array('PURE EV', 'ELECTRIC(BOV)')
             else jsonb_build_array('PETROL', 'DIESEL') end,
           'archiveScope', 'ACTIVE_ONLY',
           'calendarType', '3',
           'timePeriod', '0',
           'targetMonth', $3::text
         ),
         'freshness', jsonb_build_object(
           'observedAt', ($2 || 'T10:00:00+05:30'),
           'sourceReportedAt', null,
           'status', 'unconfirmed'
         ),
         'oem', jsonb_build_object('status', 'unavailable', 'reason', $7::text),
         'topMakerRows', '[]'::jsonb,
         'validation', jsonb_build_object(
           'contract', $8::text,
           'mapping', jsonb_build_object(
             'state', j.state,
             'rto', j.rto,
             'stateCode', 'ZZ',
             'rtoCode', c.priority::text,
             'catalogHash', repeat(md5('catalog'), 2)
           ),
           'requestHash', repeat(md5(concat(j.rto, '|', combo.fuel_group, '|', combo.vehicle_category)), 2),
           'responseHash', repeat(md5(concat($2, '|', j.rto, '|', combo.fuel_group, '|', combo.vehicle_category)), 2),
           'observedAt', ($2 || 'T10:00:00+05:30'),
           'monthToDateTotal', combo.base_total + c.priority + $4,
           'sourceRowCount', 0,
           'timePeriod', '0',
           'calendarType', '3',
           'targetMonth', $3::text,
           'zeroConfirmed', false
         )
       )
     from rto_daily_jobs j
     join rto_daily_snapshot_configs c on c.id = j.config_id
     cross join (
       values ('EV', '2W', 120), ('EV', '3W', 30), ('EV', '4W', 50),
              ('ICE', '2W', 500), ('ICE', '3W', 80), ('ICE', '4W', 220)
     ) as combo(fuel_group, vehicle_category, base_total)
     where j.run_id = $1`,
    [runId, snapshotDate, TARGET_MONTH, dayIncrement, METRIC_KIND, SOURCE, OEM_REASON, SOURCE_CONTRACT],
  );
}

async function seedRegistrationObservations(runId) {
  await query(
    `insert into rto_registration_observations (
       run_id, job_id, attempt_id, observation_date, observed_at, target_month,
       state, rto, fuel_group, vehicle_category, month_to_date_total, metric_kind,
       source, source_contract, filters, request_hash, response_hash, freshness,
       evidence, accepted, disposition, selection_reason
     )
     select r.run_id, r.job_id, concat('fixture:', r.id), r.snapshot_date, r.scraped_at,
       r.target_month, r.state, r.rto, r.fuel_group, r.vehicle_category, r.report_total,
       r.metric_kind, r.source, r.evidence->'validation'->>'contract', r.evidence->'filters',
       r.evidence->'validation'->>'requestHash', r.evidence->'validation'->>'responseHash',
       r.evidence->'freshness', r.evidence, true, 'accepted', 'fixture_first_valid_observation'
     from rto_daily_scrape_reports r where r.run_id = $1`,
    [runId],
  );
}

async function freezeCurrentCohort() {
  await query(
    `insert into rto_daily_run_cohort_members (
       run_id, config_id, snapshot_date, target_month, state, rto, cohort_rank
     )
     select $1, c.id, $2::date, $3, c.state, c.rto, c.priority
     from rto_daily_snapshot_configs c where c.state = $4 order by c.priority`,
    [currentRunId, CURRENT_DATE, TARGET_MONTH, FIXTURE_STATE],
  );
}

async function cleanupFixture() {
  await query("delete from rto_report_batches where cohort_hash = $1", [COHORT_HASH]);
  await query("delete from rto_daily_report_totals where state = $1", [FIXTURE_STATE]);
  await query("delete from rto_daily_oem_totals where state = $1", [FIXTURE_STATE]);
  await query("delete from rto_daily_snapshots where state = $1", [FIXTURE_STATE]);
  await query("delete from rto_registration_observations where state = $1", [FIXTURE_STATE]);
  await query(
    "delete from rto_daily_collection_runs where metadata ->> 'fixture' = 'rto-registration-reports-integration-check'",
  );
  await query("delete from rto_daily_snapshot_configs where state = $1", [FIXTURE_STATE]);
}
