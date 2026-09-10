import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { withStockEvidence } from "./fixtures/rto-stock-evidence.mjs";
import { finishRtoDailyReports } from "./run-rto-daily-snapshots.mjs";
import { closePool, query } from "../lib/db.mjs";
import { upsertRtoDailyConfigs, ensureRtoDailyCycle, claimRtoDailyJob, completeRtoDailyJob, buildRankedStockSnapshotRows, finalizeRtoDailyCycle } from "../lib/rto-daily-snapshots.mjs";
import { getRtoReportReadiness, reconcileRtoReportsForRun, listRtoReportsForBatch, getRtoReport, getRtoReportBatch, listRtoReportBatches } from "../lib/rto-reports.mjs";

// This command NEVER uses a configured DATABASE_URL or an existing cluster.
const id = randomUUID();
const databaseDir = path.resolve(".local/postgres", `source-check-${id}`);
const password = randomUUID();
const port = 55439;
const server = new EmbeddedPostgres({ databaseDir, port, user: "postgres", password, persistent: true,
  authMethod: "scram-sha-256", initdbFlags: ["--encoding=UTF8", "--locale=C"], postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {}, onError: () => {},
});
const url = new URL(`postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`);
url.password = password;
process.env.DATABASE_URL = url.href;
process.env.PGSSL = "false";
let started = false;
try {
  await server.initialise(); await server.start(); started = true;
  await query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  const members = Array.from({ length: 100 }, (_, i) => ({ state: "Uttarakhand", rto: `Synthetic RTO ${i + 1}`, enabled: true, priority: i + 1 }));
  await upsertRtoDailyConfigs(members);
  const run = await ensureRtoDailyCycle({ snapshotDate: "2099-09-09", targetMonth: "2099-09", workerCount: 1 });
  const workerId = `source-check-${id}`;
  for (let i = 0; i < 100; i++) {
    const job = await claimRtoDailyJob({ runId: run.id, workerId });
    assert.ok(job);
    const reports = ["EV", "ICE"].flatMap(fuelGroup => ["2W", "3W", "4W"].map(vehicleCategory => {
      const zero = i === 99;
      const report = withStockEvidence({ state: job.state, rto: job.rto, status: "success", fuelGroup, vehicleCategory, filtersConfirmed: true,
        reportTotal: zero ? 0 : 20 + i, explicitZero: zero, rows: zero ? [] : [{ maker: "Synthetic Motors", vehicle_count: 12 + i, rank: 1 }], scrapedAt: "2099-09-09T08:00:00Z" });
      report.evidence.validation.responseHash = createHash("sha256").update(`${job.rto}:${fuelGroup}:${vehicleCategory}`).digest("hex");
      return report;
    }));
    const rows = reports.flatMap(report => buildRankedStockSnapshotRows({ ...job, fuelGroup: report.fuelGroup, vehicleCategory: report.vehicleCategory, sourceRows: report.rows, metadata: { scrapeRunId: run.id, scrapedAt: report.scrapedAt } }));
    await completeRtoDailyJob({ job, workerId, reports, rows });
  }
  await finalizeRtoDailyCycle(run.id);
  const readiness = () => getRtoReportReadiness({ runId: run.id });
  assert.equal((await readiness()).completeRtos, 100, "all six reports, exact OEM rows, and explicit zeroes must pass");
  const snapshot = (await query("select id, vehicle_count from rto_daily_snapshots order by id limit 1")).rows[0];
  await query("update rto_daily_snapshots set vehicle_count = vehicle_count + 1 where id = $1", [snapshot.id]);
  assert.equal((await readiness()).eligible, false, "wrong OEM count must fail even when row counts match");
  await query("update rto_daily_snapshots set vehicle_count = $2 where id = $1", [snapshot.id, snapshot.vehicle_count]);
  await query("update rto_daily_snapshots set scrape_status = 'failed' where id = $1", [snapshot.id]);
  assert.equal((await readiness()).eligible, false, "missing successful OEM evidence must fail");
  await query("update rto_daily_snapshots set scrape_status = 'success' where id = $1", [snapshot.id]);
  const report = (await query("select id, evidence from rto_daily_scrape_reports order by id limit 1")).rows[0];
  await query("update rto_daily_scrape_reports set evidence = '{}'::jsonb where id = $1", [report.id]);
  assert.equal((await readiness()).eligible, false, "old structurally complete reports are unverified");
  await query("update rto_daily_scrape_reports set evidence = $2::jsonb where id = $1", [report.id, JSON.stringify(report.evidence)]);
  assert.equal((await readiness()).eligible, true);
  const secondEvidence = (await query("select id, evidence from rto_daily_scrape_reports where rto = $1", [members[1].rto])).rows;
  await query(`update rto_daily_scrape_reports target
    set evidence = jsonb_set(target.evidence, '{validation,responseHash}', source.evidence->'validation'->'responseHash')
    from rto_daily_scrape_reports source
    where target.rto = $1 and source.rto = $2
      and target.fuel_group = source.fuel_group and target.vehicle_category = source.vehicle_category`, [members[1].rto, members[0].rto]);
  assert.equal((await readiness()).completeRtos, 98, "duplicated positive six-segment source responses must fail closed");
  assert.equal((await reconcileRtoReportsForRun({ runId: run.id })).batches.length, 0, "unverified collection must not be published");
  for (const item of secondEvidence) await query("update rto_daily_scrape_reports set evidence = $2::jsonb where id = $1", [item.id, JSON.stringify(item.evidence)]);
  const reconciled = await reconcileRtoReportsForRun({ runId: run.id });
  assert.ok(reconciled.batches.length);
  const reports = await listRtoReportsForBatch(reconciled.batches[0].batch.id);
  assert.equal(reports.length, 100);
  const fresh = await getRtoReport(reports[0].id);
  assert.equal(fresh.payload.source.registrationFlowAvailable, false);
  assert.ok(fresh.payload.metrics.stock.ev > 0);
  assert.equal(fresh.payload.metrics.period.ev, null, "first verified observation has no prior net change");
  await query("update rto_reports set payload = payload - 'source' where id = $1", [fresh.id]);
  assert.deepEqual((await getRtoReport(fresh.id)).payload.metrics, {}, "historical persisted reports must be quarantined at read time");
  const historicalBatch = await getRtoReportBatch(fresh.batchId);
  assert.equal(historicalBatch.coverageCount, 99);
  assert.equal(historicalBatch.reviewCount, 1);
  assert.equal(historicalBatch.warningCount, 99);
  assert.equal(historicalBatch.status, "needs_review");
  assert.equal((await listRtoReportsForBatch(fresh.batchId, { status: "needs_review" })).length, 1);
  assert.equal((await listRtoReportBatches({ status: "needs_review" })).length, 1);
  const retainedExport = (await query(`insert into rto_report_exports
    (scope_type, scope_id, format, revision, storage_path, checksum, byte_size, expires_at)
    values ('batch', $1, 'csv', 1, 'synthetic-preservation-check.csv', 'synthetic-fixture', 0, '2000-01-01') returning id`, [fresh.batchId])).rows[0];
  const preserved = await finishRtoDailyReports({ run, args: { preserveHistory: true, retentionDays: 30 } });
  assert.equal(preserved.reportRetention.skipped, "preserve_history");
  assert.equal(preserved.retention.skipped, "preserve_history");
  assert.equal((await query("select count(*)::int as count from rto_report_exports where id = $1", [retainedExport.id])).rows[0].count, 1, "even expired historical export records must remain during preserved collection");
  console.log(JSON.stringify({ passed: true, syntheticRtos: 100, syntheticReports: 600, runId: run.id, databaseDir, checks: ["full_readiness", "explicit_zero", "OEM_tampering", "OEM_missing", "legacy_evidence", "materialization", "no_false_registrations", "historical_quarantine"] }));
} finally {
  await closePool();
  if (started) {
    // Gracefully stop only this newly created cluster. Retain files for diagnosis.
    const packageEntry = fileURLToPath(import.meta.resolve("embedded-postgres"));
    const binary = path.resolve(path.dirname(packageEntry), "../../@embedded-postgres/windows-x64/native/bin/pg_ctl.exe");
    if (process.platform === "win32") await new Promise((resolve, reject) => {
      const child = spawn(binary, ["stop", "-D", databaseDir, "-m", "fast", "-w"], { windowsHide: true, stdio: "ignore" });
      child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Test cluster stop failed: ${code}`)));
    }); else await server.stop();
  }
}
