import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { closePool, query } from "../lib/db.mjs";
import {
  DEFAULT_ANOMALY_REPORT_TOTAL_MAX,
  DEFAULT_MIN_STATE_COVERAGE_PCT,
  buildDailyEvReportSet,
  renderDailyEvReportHtml,
  reportRelativeParts,
  selectLatestEligibleRun,
} from "../lib/daily-ev-report-try.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_DIR = path.join("reports", "daily-ev-try");

export function parseArgs(argv = []) {
  const args = {
    date: null,
    scope: "all",
    minStateCoveragePct: DEFAULT_MIN_STATE_COVERAGE_PCT,
    anomalyReportTotalMax: DEFAULT_ANOMALY_REPORT_TOTAL_MAX,
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`Missing value for ${token}`);
      index += 1;
      if (key === "date") args.date = value;
      else if (key === "scope") args.scope = value;
      else if (key === "min-state-coverage") args.minStateCoveragePct = Number(value);
      else if (key === "output-dir") args.outputDir = value;
      else if (key === "anomaly-report-total-max") args.anomalyReportTotalMax = Number(value);
      else throw new Error(`Unknown argument: ${token}`);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error("--date must use YYYY-MM-DD format.");
  }
  if (!["india", "states", "all"].includes(args.scope)) {
    throw new Error("--scope must be one of india, states, or all.");
  }
  if (!Number.isFinite(args.minStateCoveragePct) || args.minStateCoveragePct < 0 || args.minStateCoveragePct > 100) {
    throw new Error("--min-state-coverage must be a number from 0 to 100.");
  }
  if (!Number.isFinite(args.anomalyReportTotalMax) || args.anomalyReportTotalMax < 1) {
    throw new Error("--anomaly-report-total-max must be a positive number.");
  }

  return args;
}

function usage() {
  return [
    "Usage: node --env-file=.env scripts/generate-daily-ev-report-try.mjs [options]",
    "",
    "Options:",
    "  --date YYYY-MM-DD              Source snapshot date. Defaults to latest completed/partial non-running cycle.",
    "  --scope india|states|all       Reports to write (default all).",
    "  --min-state-coverage N         State report coverage threshold percent (default 50).",
    "  --anomaly-report-total-max N   Critical row total threshold (default 1000000).",
    "  --output-dir PATH              Output root (default reports/daily-ev-try).",
  ].join("\n");
}

async function loadRun({ date = null } = {}) {
  if (date) {
    const result = await query(
      `
        select id, snapshot_date::text as snapshot_date, target_month, status,
               total_rtos, succeeded_rtos, failed_rtos, started_at, completed_at
        from rto_daily_collection_runs
        where snapshot_date = $1::date and status in ('success', 'partial')
        order by started_at desc
        limit 1
      `,
      [date],
    );
    if (!result.rows[0]) {
      throw new Error(`No completed or partial RTO daily cycle is available for ${date}.`);
    }
    return result.rows[0];
  }

  const result = await query(
    `
      select id, snapshot_date::text as snapshot_date, target_month, status,
             total_rtos, succeeded_rtos, failed_rtos, started_at, completed_at
      from rto_daily_collection_runs
      where snapshot_date is not null
      order by snapshot_date desc, started_at desc
      limit 20
    `,
  );
  const run = selectLatestEligibleRun(result.rows);
  if (!run) throw new Error("No completed or partial RTO daily cycle is available.");
  return run;
}

async function loadPreviousRun(run) {
  const result = await query(
    `
      select id, snapshot_date::text as snapshot_date, target_month, status,
             total_rtos, succeeded_rtos, failed_rtos, started_at, completed_at
      from rto_daily_collection_runs
      where snapshot_date is not null
        and status in ('success', 'partial')
        and target_month = $1
        and snapshot_date < $2::date
      order by snapshot_date desc, started_at desc
      limit 1
    `,
    [run.targetMonth ?? run.target_month, run.snapshotDate ?? run.snapshot_date],
  );
  return result.rows[0] ?? null;
}

async function loadConfigRows() {
  const result = await query(
    `
      select state, rto, enabled
      from rto_daily_snapshot_configs
      where enabled = true
      order by state asc, rto asc
    `,
  );
  return result.rows;
}

async function loadReportRows(runId) {
  const result = await query(
    `
      select run_id, state, rto, fuel_group, vehicle_category, status, report_total,
             source_row_count, filters_confirmed, explicit_zero, scraped_at
      from rto_daily_scrape_reports
      where run_id = $1
      order by state asc, rto asc, fuel_group asc, vehicle_category asc
    `,
    [runId],
  );
  return result.rows;
}

async function writeReport(report, dateDir) {
  const reportDir = path.join(dateDir, ...reportRelativeParts(report));
  await fs.mkdir(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, "report.json");
  const htmlPath = path.join(reportDir, "report.html");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(htmlPath, renderDailyEvReportHtml(report), "utf8");
  return {
    scope: report.scope,
    state: report.state,
    status: report.status,
    title: report.title,
    jsonPath,
    htmlPath,
  };
}

function manifestReportEntry(entry, outputRoot) {
  return {
    scope: entry.scope,
    state: entry.state,
    status: entry.status,
    title: entry.title,
    jsonPath: path.relative(outputRoot, entry.jsonPath).replaceAll("\\", "/"),
    htmlPath: path.relative(outputRoot, entry.htmlPath).replaceAll("\\", "/"),
  };
}

export async function generateDailyEvReportTry(args) {
  const run = await loadRun({ date: args.date });
  const previousRun = await loadPreviousRun(run);
  const [configRows, currentRows, previousRows] = await Promise.all([
    loadConfigRows(),
    loadReportRows(run.id),
    previousRun ? loadReportRows(previousRun.id) : Promise.resolve([]),
  ]);
  const reportSet = buildDailyEvReportSet({
    run,
    previousRun,
    configRows,
    currentRows,
    previousRows,
    minStateCoveragePct: args.minStateCoveragePct,
    anomalyReportTotalMax: args.anomalyReportTotalMax,
  });

  const outputRoot = path.resolve(ROOT_DIR, args.outputDir);
  const dateDir = path.join(outputRoot, reportSet.run.snapshotDate);
  await fs.mkdir(dateDir, { recursive: true });

  const written = [];
  if (args.scope === "india" || args.scope === "all") {
    written.push(await writeReport(reportSet.reports.india, dateDir));
  }
  if (args.scope === "states" || args.scope === "all") {
    for (const report of reportSet.reports.states) {
      written.push(await writeReport(report, dateDir));
    }
  }

  const manifest = {
    kind: reportSet.kind,
    generatedAt: reportSet.generatedAt,
    run: reportSet.run,
    previousRun: reportSet.previousRun,
    options: {
      ...reportSet.options,
      scope: args.scope,
      outputDir: path.relative(ROOT_DIR, outputRoot).replaceAll("\\", "/"),
    },
    generated: written.map((entry) => manifestReportEntry(entry, outputRoot)),
    skipped: reportSet.skipped,
    needsReview: written
      .filter((entry) => entry.status === "needs_review")
      .map((entry) => ({
        scope: entry.scope,
        state: entry.state,
        title: entry.title,
      })),
    totals: {
      generatedReports: written.length,
      skippedReports: reportSet.skipped.length,
      needsReviewReports: written.filter((entry) => entry.status === "needs_review").length,
    },
  };

  const manifestPath = path.join(dateDir, "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifest, manifestPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const { manifest, manifestPath } = await generateDailyEvReportTry(args);
  console.log(JSON.stringify({
    manifestPath,
    run: manifest.run,
    totals: manifest.totals,
    needsReview: manifest.needsReview,
  }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}
