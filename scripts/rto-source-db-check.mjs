import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { withRegistrationEvidence } from "./fixtures/rto-stock-evidence.mjs";
import { closePool, query } from "../lib/db.mjs";
import {
  claimRtoDailyJob,
  completeRtoDailyJob,
  getRtoDailyStatus,
  listRtoDailyFreshness,
  listRtoDailyTrend,
  rollupAndPruneRtoDailySnapshots,
  snapshotDateKey,
  upsertRtoDailyConfigs,
} from "../lib/rto-daily-snapshots.mjs";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
assert.ok(
  ["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname),
  "registration source DB checks are restricted to local PostgreSQL",
);

const id = randomUUID();
const state = `__REGISTRATION_OBSERVATION_TEST_${id}__`;
const rto = "Append-only RTO";
const observationDate = snapshotDateKey();
const targetMonth = observationDate.slice(0, 7);
const scopes = ["EV", "ICE"].flatMap((fuelGroup) => ["2W", "3W", "4W"].map((vehicleCategory) => ({ fuelGroup, vehicleCategory })));
let runId = null;

function reportsFor(job, revision) {
  return scopes.map(({ fuelGroup, vehicleCategory }, index) => {
    const scrapedAt = new Date().toISOString();
    const report = withRegistrationEvidence({
      status: "success",
      state,
      rto,
      fuelGroup,
      vehicleCategory,
      filtersConfirmed: true,
      reportTotal: 100 + index + revision * 10,
      explicitZero: false,
      rows: [],
      targetMonth,
      scrapedAt,
      attempts: job.attempts,
      attemptId: `${job.id}:${job.attempts}:${index}`,
    });
    report.evidence.validation.responseHash = createHash("sha256")
      .update(`${revision}:${fuelGroup}:${vehicleCategory}`)
      .digest("hex");
    return report;
  });
}

try {
  await query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await upsertRtoDailyConfigs([{ state, rto, enabled: true, priority: 1 }]);
  const config = await query("select id from rto_daily_snapshot_configs where state = $1 and rto = $2", [state, rto]);
  const run = await query(
    `insert into rto_daily_collection_runs
       (status, snapshot_date, target_month, worker_count, metric_kind, source, metadata, total_rtos)
     values ('running', $1::date, $2, 1, $3, 'vahan-public-dashboard', $4::jsonb, 1)
     returning id`,
    [observationDate, targetMonth, `registration_source_check_${id}`, JSON.stringify({ state, fixture: true })],
  );
  runId = run.rows[0].id;
  await query(
    `insert into rto_daily_jobs (run_id, config_id, snapshot_date, target_month, state, rto)
     values ($1, $2, $3::date, $4, $5, $6)`,
    [runId, config.rows[0].id, observationDate, targetMonth, state, rto],
  );

  const firstJob = await claimRtoDailyJob({ runId, workerId: "registration-source-first" });
  const first = await completeRtoDailyJob({
    job: firstJob,
    workerId: "registration-source-first",
    reports: reportsFor(firstJob, 0),
    rows: [],
  });
  assert.deepEqual(first, { reports: 6, rows: 0, acceptedScopes: 6, observations: 6 });

  await query(
    `update rto_daily_jobs
     set status = 'queued', worker_id = null, lease_expires_at = null,
         completed_at = null, next_attempt_at = now(), updated_at = now()
     where id = $1`,
    [firstJob.id],
  );
  const rerunJob = await claimRtoDailyJob({ runId, workerId: "registration-source-rerun" });
  const rerun = await completeRtoDailyJob({
    job: rerunJob,
    workerId: "registration-source-rerun",
    reports: reportsFor(rerunJob, 1),
    rows: [],
  });
  assert.deepEqual(rerun, { reports: 6, rows: 0, acceptedScopes: 0, observations: 6 });

  const history = await query(
    `select accepted, disposition, authoritative_observation_id, month_to_date_total,
            source_contract, filters, request_hash, response_hash, freshness, evidence
     from rto_registration_observations
     where run_id = $1
     order by id`,
    [runId],
  );
  assert.equal(history.rowCount, 12);
  assert.equal(history.rows.filter((row) => row.accepted).length, 6);
  assert.equal(history.rows.filter((row) => row.disposition === "superseded").length, 6);
  assert.ok(history.rows.filter((row) => row.disposition === "superseded").every((row) => row.authoritative_observation_id));
  assert.ok(history.rows.every((row) => row.source_contract === "public-registration-mtd-v1"));
  assert.ok(history.rows.every((row) => row.filters?.targetMonth === targetMonth));
  assert.ok(history.rows.every((row) => /^[a-f0-9]{64}$/.test(row.request_hash) && /^[a-f0-9]{64}$/.test(row.response_hash)));

  const published = await query(
    "select report_total from rto_daily_scrape_reports where run_id = $1 order by fuel_group, vehicle_category",
    [runId],
  );
  assert.deepEqual(
    published.rows.map((row) => Number(row.report_total)).sort((a, b) => a - b),
    [100, 101, 102, 103, 104, 105],
    "a same-date rerun must not overwrite the first valid observation",
  );

  const serializedTrend = await listRtoDailyTrend({
    state,
    rto,
    fuelGroup: "EV",
    category: "2W",
    limit: 30,
  });
  assert.equal(serializedTrend.length, 1, "the trend API model must expose only the accepted same-date authority");
  assert.deepEqual(
    {
      snapshotDate: serializedTrend[0].snapshotDate,
      targetMonth: serializedTrend[0].targetMonth,
      metricKind: serializedTrend[0].metricKind,
      monthToDateTotal: serializedTrend[0].monthToDateTotal,
      dailyRegistration: serializedTrend[0].dailyRegistration,
      status: serializedTrend[0].status,
    },
    {
      snapshotDate: observationDate,
      targetMonth,
      metricKind: "registration_month_to_date",
      monthToDateTotal: 100,
      dailyRegistration: null,
      status: "unavailable",
    },
    "API serialization must keep source MTD separate from an unavailable Daily calculation",
  );
  assert.match(serializedTrend[0].unavailableReason, /No previous accepted observation/i);
  assert.match(serializedTrend[0].requestHash, /^[a-f0-9]{64}$/);
  assert.match(serializedTrend[0].responseHash, /^[a-f0-9]{64}$/);
  assert.ok(serializedTrend[0].observedAt);
  assert.equal("activeStock" in serializedTrend[0], false, "registration trend rows must not serialize active stock as Daily data");
  const status = await getRtoDailyStatus({ state, rto });
  assert.equal(status.lastRegistrationObservationDate, observationDate);
  const freshness = (await listRtoDailyFreshness({ limit: 1_000 }))
    .find((entry) => entry.state === state && entry.rto === rto);
  assert.equal(freshness?.observationRows, 6);
  assert.ok(freshness?.latestObservedAt);

  await assert.rejects(
    query("delete from rto_daily_jobs where run_id = $1", [runId]),
    /foreign key|violates/i,
    "parent cleanup must not cascade-delete the accepted or superseded observation ledger",
  );
  await query(
    `insert into rto_monthly_snapshot_aggregates
       (target_month, state, rto, fuel_group, vehicle_category, oem,
        latest_snapshot_date, latest_vehicle_count, min_vehicle_count, max_vehicle_count, sample_count, metric_kind)
     values
       ($1,$2,$3,'EV','2W','Fixture Maker',$4::date,10,10,10,1,'active_stock'),
       ($1,$2,$3,'EV','2W','Fixture Maker',$4::date,7,7,7,1,'registration_month_to_date')`,
    [targetMonth, state, rto, observationDate],
  );
  const isolatedAggregateKinds = await query(
    "select metric_kind from rto_monthly_snapshot_aggregates where state = $1 and rto = $2 order by metric_kind",
    [state, rto],
  );
  assert.deepEqual(
    isolatedAggregateKinds.rows.map((row) => row.metric_kind),
    ["active_stock", "registration_month_to_date"],
    "monthly registration OEM evidence and preserved stock must use distinct aggregate keys",
  );

  assert.doesNotMatch(
    rollupAndPruneRtoDailySnapshots.toString(),
    /delete\s+from\s+rto_registration_observations/i,
    "ordinary retention must not target the raw observation ledger",
  );
  const retained = await query("select count(*)::int as count from rto_registration_observations where run_id = $1", [runId]);
  assert.equal(retained.rows[0].count, 12, "ordinary snapshot/report retention must preserve raw accepted and superseded observations");

  console.log(JSON.stringify({
    passed: true,
    databaseHost: databaseUrl.hostname,
    databasePort: databaseUrl.port,
    observationDate,
    accepted: 6,
    superseded: 6,
    retainedAfterPrune: 12,
  }));
} finally {
  await query("delete from rto_monthly_snapshot_aggregates where state = $1", [state]).catch(() => {});
  if (runId) await query("delete from rto_registration_observations where run_id = $1", [runId]).catch(() => {});
  if (runId) await query("delete from rto_daily_collection_runs where id = $1", [runId]).catch(() => {});
  await query("delete from rto_daily_snapshot_configs where state = $1", [state]).catch(() => {});
  await closePool();
}
