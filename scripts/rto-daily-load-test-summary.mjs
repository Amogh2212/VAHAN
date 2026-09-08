import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { closePool, query } from "../lib/db.mjs";
import { getRtoDailyCoverage } from "../lib/rto-daily-snapshots.mjs";
import { getRtoReportReadiness } from "../lib/rto-reports.mjs";

function outputPath(argv) {
  const index = argv.indexOf("--output");
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value) throw new Error("Usage: node --env-file=.env scripts/rto-daily-load-test-summary.mjs --output artifacts/rto-daily-load-test-summary.json");
  return value;
}

async function main() {
  const file = outputPath(process.argv.slice(2));
  const coverage = await getRtoDailyCoverage();
  const runId = coverage.run?.id ?? null;
  const readiness = await getRtoReportReadiness({ runId });
  const failures = runId
    ? await query(
      `select state, rto, attempts, last_error from rto_daily_jobs where run_id = $1 and status = 'failed' order by state, rto limit 100`,
      [runId],
    )
    : { rows: [] };
  const startedAt = coverage.run?.startedAt ? new Date(coverage.run.startedAt) : null;
  const completedAt = coverage.run?.completedAt ? new Date(coverage.run.completedAt) : new Date();
  const durationMs = startedAt && !Number.isNaN(startedAt.valueOf()) ? Math.max(0, completedAt - startedAt) : null;
  const summary = {
    generatedAt: new Date().toISOString(),
    run: coverage.run,
    cycle: coverage.summary,
    reportReadiness: readiness,
    failures: failures.rows.map((row) => ({ state: row.state, rto: row.rto, attempts: Number(row.attempts), error: row.last_error ?? null })),
    durationMs,
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ summaryFile: file, runId, status: coverage.run?.status ?? "no_run", durationMs, readiness: { eligible: readiness.eligible, cohortSize: readiness.cohortSize, completeRtos: readiness.completeRtos } }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(closePool);
