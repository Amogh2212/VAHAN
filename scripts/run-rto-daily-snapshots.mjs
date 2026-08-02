import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { closePool } from "../lib/db.mjs";
import {
  RTO_DAILY_CATEGORY_FILTERS,
  RTO_DAILY_CATEGORIES,
  RTO_DAILY_FUEL_FILTERS,
  RTO_DAILY_FUEL_GROUPS,
  buildSnapshotRows,
  claimRtoDailyJob,
  completeRtoDailyJob,
  deferStaleRtoDailyCycles,
  ensureRtoDailyCycle,
  failRtoDailyJob,
  finalizeRtoDailyCycle,
  heartbeatRtoDailyJob,
  previewRtoDailyCycle,
  requeueFailedRtoDailyJobs,
  rollupAndPruneRtoDailySnapshots,
  rtoDailyCycleSummary,
  scrapeStatusForSnapshotDate,
  snapshotDateKey,
  targetMonthForDate,
  upsertRtoDailyConfigs,
  validateRtoDailyReport,
} from "../lib/rto-daily-snapshots.mjs";
import { acquireVahanScrapeLock } from "../lib/vahan-scrape-lock.mjs";
import { createTerminalProgress } from "../lib/terminal-progress.mjs";
import {
  pruneRtoReportingData,
  reportHistoryStartDate,
  reconcileRtoReportsForRun,
} from "../lib/rto-reports.mjs";
import { createVahanMakerSession } from "./vahan-scraper.mjs";

const DEFAULT_WORKERS = Number(process.env.RTO_DAILY_WORKERS ?? 2);
const DEFAULT_RETENTION_DAYS = Number(process.env.RTO_DAILY_RETENTION_DAYS ?? 30);
const DEFAULT_DELAY_MS = Number(process.env.RTO_DAILY_DELAY_MS ?? 1200);
const DEFAULT_JITTER_MS = Number(process.env.RTO_DAILY_JITTER_MS ?? 400);
const DEFAULT_MAX_JOB_ATTEMPTS = Number(process.env.RTO_DAILY_MAX_JOB_ATTEMPTS ?? 3);
const DEFAULT_WORK_BUDGET_MINUTES = Number(process.env.RTO_DAILY_WORK_BUDGET_MINUTES ?? 10);
const DEFAULT_PROGRESS_LOG_INTERVAL_MS = Number(process.env.RTO_DAILY_PROGRESS_LOG_INTERVAL_MS ?? 30_000);
const CATALOG_FILE = path.join("data", "vahan", "rto_catalog.json");

function parseArgs(argv) {
  const args = {
    dryRun: false,
    bootstrapConfigs: false,
    workers: DEFAULT_WORKERS,
    retentionDays: DEFAULT_RETENTION_DAYS,
    maxJobAttempts: DEFAULT_MAX_JOB_ATTEMPTS,
    maxJobs: null,
    date: snapshotDateKey(),
    targetMonth: targetMonthForDate(),
    state: null,
    rto: null,
    retryFailed: false,
    workQueue: false,
    timeBudgetMinutes: null,
    dateExplicit: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--bootstrap-configs") args.bootstrapConfigs = true;
    else if (arg === "--retry-failed") args.retryFailed = true;
    else if (arg === "--work-queue") args.workQueue = true;
    else if (arg === "--workers") args.workers = argv[++index];
    else if (arg.startsWith("--workers=")) args.workers = arg.slice("--workers=".length);
    else if (arg === "--retention-days") args.retentionDays = argv[++index];
    else if (arg.startsWith("--retention-days=")) args.retentionDays = arg.slice("--retention-days=".length);
    else if (arg === "--max-job-attempts") args.maxJobAttempts = argv[++index];
    else if (arg.startsWith("--max-job-attempts=")) args.maxJobAttempts = arg.slice("--max-job-attempts=".length);
    else if (arg === "--max-jobs") args.maxJobs = argv[++index];
    else if (arg.startsWith("--max-jobs=")) args.maxJobs = arg.slice("--max-jobs=".length);
    else if (arg === "--time-budget-minutes") args.timeBudgetMinutes = argv[++index];
    else if (arg.startsWith("--time-budget-minutes=")) args.timeBudgetMinutes = arg.slice("--time-budget-minutes=".length);
    else if (arg === "--date") {
      args.date = argv[++index];
      args.dateExplicit = true;
    } else if (arg.startsWith("--date=")) {
      args.date = arg.slice("--date=".length);
      args.dateExplicit = true;
    }
    else if (arg === "--target-month") args.targetMonth = argv[++index];
    else if (arg.startsWith("--target-month=")) args.targetMonth = arg.slice("--target-month=".length);
    else if (arg === "--state") args.state = argv[++index] ?? null;
    else if (arg.startsWith("--state=")) args.state = arg.slice("--state=".length);
    else if (arg === "--rto") args.rto = argv[++index] ?? null;
    else if (arg.startsWith("--rto=")) args.rto = arg.slice("--rto=".length);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.workers = Math.max(1, Math.min(Number(args.workers) || DEFAULT_WORKERS, 4));
  args.retentionDays = Math.max(1, Math.floor(Number(args.retentionDays) || DEFAULT_RETENTION_DAYS));
  args.maxJobAttempts = Math.max(1, Math.floor(Number(args.maxJobAttempts) || DEFAULT_MAX_JOB_ATTEMPTS));
  args.maxJobs = args.maxJobs === null ? null : Math.max(1, Math.floor(Number(args.maxJobs) || 1));
  if (args.workQueue && args.timeBudgetMinutes === null) args.timeBudgetMinutes = DEFAULT_WORK_BUDGET_MINUTES;
  args.timeBudgetMinutes = args.timeBudgetMinutes === null
    ? null
    : Math.max(1, Number(args.timeBudgetMinutes) || DEFAULT_WORK_BUDGET_MINUTES);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error("--date must use YYYY-MM-DD format.");
  if (!/^\d{4}-\d{2}$/.test(args.targetMonth)) throw new Error("--target-month must use YYYY-MM format.");
  return args;
}

function usage() {
  return [
    "Usage: node --env-file=.env scripts/run-rto-daily-snapshots.mjs [options]",
    "",
    "Options:",
    "  --dry-run              Preview enabled RTOs without creating jobs or launching browsers.",
    "  --bootstrap-configs    Legacy bootstrap from data/vahan/rto_catalog.json.",
    "  --retry-failed         Requeue terminal failures in the selected cycle/scope.",
    "  --work-queue           Bounded mode intended for a deployment-host cron every 15 minutes.",
    "  --time-budget-minutes N Stop claiming new RTOs after N minutes (work-queue default 10).",
    "  --workers N            Persistent browser workers (1-4, default 2).",
    "  --max-job-attempts N   Maximum claims per RTO before terminal failure (default 3).",
    "  --max-jobs N           Seed at most N RTOs for a targeted pilot.",
    "  --retention-days N     Detailed snapshot retention (default 30).",
    "  --date YYYY-MM-DD      IST snapshot date.",
    "  --target-month YYYY-MM VAHAN month-to-date report month.",
    "  --state NAME           Restrict a pilot cycle to one state.",
    "  --rto LABEL            Restrict a pilot cycle to one exact official RTO label.",
  ].join("\n");
}

async function readCatalogConfigs({ state = null } = {}) {
  const content = await fs.readFile(CATALOG_FILE, "utf8").catch(() => null);
  if (!content) throw new Error(`RTO catalog not found at ${CATALOG_FILE}. Run npm run scrape:vahan:rto-catalog first.`);
  const catalog = JSON.parse(content);
  return (catalog.states ?? [])
    .filter((group) => !state || group.state === state)
    .flatMap((group) => (group.rtos ?? [])
      .filter((rto) => !/^All Vahan4 Running Office/i.test(rto.label ?? rto))
      .map((rto, index) => ({ state: group.state, rto: rto.label ?? rto, enabled: true, priority: index + 100 })));
}

function createRateLimiter(delayMs, jitterMs) {
  let tail = Promise.resolve();
  let nextAllowedAt = 0;
  return async () => {
    const turn = tail.then(async () => {
      const waitMs = Math.max(0, nextAllowedAt - Date.now());
      if (waitMs) await sleep(waitMs);
      nextAllowedAt = Date.now() + delayMs + Math.floor(Math.random() * Math.max(1, jitterMs));
    });
    tail = turn.catch(() => {});
    return turn;
  };
}

export function createAdaptiveController(initialWorkers, {
  recoveryHealthyWindows = 2,
  recoveryErrorRate = 0.01,
} = {}) {
  const maxWorkers = initialWorkers;
  let activeLimit = initialWorkers;
  let windowReports = 0;
  let windowIssues = 0;
  let healthyWindows = 0;
  return {
    canRun(index) { return index < activeLimit; },
    record(outcome) {
      windowReports += Number(outcome.reportCount ?? 6);
      windowIssues += outcome.failed ? Number(outcome.reportCount ?? 6) : Number(outcome.retryCount ?? 0);
      if (windowReports < 120) return;
      const errorRate = windowIssues / windowReports;
      windowReports = 0;
      windowIssues = 0;
      if (errorRate > 0.05 && activeLimit > 1) {
        activeLimit -= 1;
        healthyWindows = 0;
        console.warn(`[rto-daily] reducing active workers to ${activeLimit}; retry/failure rate exceeded 5%`);
      } else if (errorRate <= recoveryErrorRate && activeLimit < maxWorkers) {
        healthyWindows += 1;
        if (healthyWindows >= recoveryHealthyWindows) {
          activeLimit += 1;
          healthyWindows = 0;
          console.warn(`[rto-daily] increasing active workers to ${activeLimit}; recent retry/failure rate recovered`);
        }
      } else {
        healthyWindows = 0;
      }
    },
    get activeLimit() { return activeLimit; },
  };
}

function monthParts(monthKey) {
  const [year, month] = String(monthKey).split("-").map(Number);
  return { year, month };
}

async function scrapeJob({ session, job, workerId, rateLimit }) {
  const { year, month } = monthParts(job.targetMonth);
  const reports = [];
  const rows = [];
  let retryCount = 0;
  for (const fuelGroup of RTO_DAILY_FUEL_GROUPS) {
    for (const vehicleCategory of RTO_DAILY_CATEGORIES) {
      await heartbeatRtoDailyJob({ jobId: job.id, workerId });
      await rateLimit();
      const categoryFilters = RTO_DAILY_CATEGORY_FILTERS[vehicleCategory];
      const report = await session.scrapeReport({
        year,
        month,
        state: job.state,
        rto: job.rto,
        fuelGroup,
        vehicleCategory,
        fuels: RTO_DAILY_FUEL_FILTERS[fuelGroup],
        vehicleCategories: categoryFilters.vehicleCategories,
        vehicleClasses: categoryFilters.vehicleClasses,
      });
      validateRtoDailyReport(report, { state: job.state, rto: job.rto });
      if (report.attempts > 1) retryCount += 1;
      const scrapeStatus = scrapeStatusForSnapshotDate(job.snapshotDate, report.scrapedAt);
      reports.push(report);
      rows.push(...buildSnapshotRows({
        sourceRows: report.rows,
        state: job.state,
        rto: job.rto,
        snapshotDate: job.snapshotDate,
        targetMonth: job.targetMonth,
        fuelGroup,
        vehicleCategory,
        metadata: {
          scrapeRunId: job.runId,
          scrapedAt: report.scrapedAt,
          scrapeStatus,
          raw: {},
        },
      }));
    }
  }
  await completeRtoDailyJob({ job, workerId, reports, rows });
  return { retryCount, reportCount: reports.length };
}

async function workerLoop({ index, runId, args, controller, rateLimit, deadline, progress }) {
  const workerId = `${os.hostname()}-${process.pid}-w${index + 1}`;
  const workerLabel = `w${index + 1}`;
  let session = null;
  const resetSession = async () => {
    await session?.close().catch(() => {});
    session = await createVahanMakerSession();
  };
  try {
    while (true) {
      if (Date.now() >= deadline) return;
      if (!controller.canRun(index)) {
        const summary = await rtoDailyCycleSummary(runId);
        if (!summary.queued && !summary.running && !summary.retrying) return;
        await sleep(5000);
        continue;
      }
      const job = await claimRtoDailyJob({ runId, workerId });
      if (!job) {
        const summary = await rtoDailyCycleSummary(runId);
        if (!summary.queued && !summary.running && !summary.retrying) return;
        await sleep(2000);
        continue;
      }
      if (!session) await resetSession();
      progress.log(`[${workerLabel}] started | ${job.state} / ${job.rto} | attempt ${job.attempts}`);
      try {
        const result = await scrapeJob({ session, job, workerId, rateLimit });
        controller.record({ retryCount: result.retryCount, reportCount: result.reportCount, failed: false });
        progress.log(`[${workerLabel}] saved 90 rows | ${job.rto}`);
      } catch (error) {
        controller.record({ retryCount: 0, reportCount: 6, failed: true });
        const failed = await failRtoDailyJob({
          jobId: job.id,
          workerId,
          error: error.message,
          maxAttempts: args.maxJobAttempts,
        });
        progress.log(`[${workerLabel}] ${failed?.status ?? "failed"} | ${job.rto} | ${error.message}`, { error: true });
        await resetSession();
      }
      await progress.refresh();
    }
  } finally {
    await session?.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(usage());

  if (args.bootstrapConfigs) {
    const configs = await readCatalogConfigs({ state: args.state });
    if (args.dryRun) console.log(JSON.stringify({ bootstrapConfigs: configs.length, sample: configs.slice(0, 10) }, null, 2));
    else console.log(JSON.stringify({ bootstrap: await upsertRtoDailyConfigs(configs) }, null, 2));
  }
  if (args.dryRun) {
    const preview = await previewRtoDailyCycle({ state: args.state, limit: 20 });
    console.log(JSON.stringify({ dryRun: true, snapshotDate: args.date, targetMonth: args.targetMonth, workers: args.workers, maxJobs: args.maxJobs, ...preview }, null, 2));
    return;
  }

  const releaseLock = await acquireVahanScrapeLock("rto-daily");
  try {
    if (args.workQueue && !args.dateExplicit) {
      const deferred = await deferStaleRtoDailyCycles({
        beforeDate: args.date,
        state: args.state,
        rto: args.rto,
      });
      if (deferred.runs) console.log(JSON.stringify({ skippedPriorDay: deferred }, null, 2));
    }
    if (args.dateExplicit) {
      const deferred = await deferStaleRtoDailyCycles({ beforeDate: args.date });
      if (deferred.runs) console.log(JSON.stringify({ deferred }, null, 2));
    }
    const run = await ensureRtoDailyCycle({
      snapshotDate: args.date,
      targetMonth: args.targetMonth,
      workerCount: args.workers,
      state: args.state,
      rto: args.rto,
      maxJobs: args.maxJobs,
    });
    console.log(JSON.stringify({ cycle: run }, null, 2));
    if (args.retryFailed) {
      console.log(JSON.stringify({
        requeued: await requeueFailedRtoDailyJobs({ runId: run.id, state: args.state, rto: args.rto }),
      }, null, 2));
    }
    const terminalProgress = createTerminalProgress();
    let refreshTail = Promise.resolve();
    let lastProgressRenderedAt = 0;
    const progress = {
      ...terminalProgress,
      refresh({ force = false } = {}) {
        refreshTail = refreshTail.then(async () => {
          const now = Date.now();
          if (!force && now - lastProgressRenderedAt < DEFAULT_PROGRESS_LOG_INTERVAL_MS) return;
          terminalProgress.render(await rtoDailyCycleSummary(run.id));
          lastProgressRenderedAt = now;
        }).catch((error) => {
          terminalProgress.log(`[rto-daily:progress] unable to refresh: ${error.message}`, { error: true });
        });
        return refreshTail;
      },
    };
    await progress.refresh({ force: true });
    const controller = createAdaptiveController(args.workers);
    const rateLimit = createRateLimiter(DEFAULT_DELAY_MS, DEFAULT_JITTER_MS);
    const deadline = args.timeBudgetMinutes === null
      ? Number.POSITIVE_INFINITY
      : Date.now() + args.timeBudgetMinutes * 60_000;
    await Promise.all(Array.from({ length: args.workers }, (_, index) =>
      workerLoop({ index, runId: run.id, args, controller, rateLimit, deadline, progress })));
    const finalized = await finalizeRtoDailyCycle(run.id);
    const reportSystem = await reconcileRtoReportsForRun({
      runId: run.id,
      includeAvailableHistory: true,
      historyFrom: reportHistoryStartDate(run.snapshotDate),
    });
    const reportRetention = await pruneRtoReportingData();
    const retention = await rollupAndPruneRtoDailySnapshots({ retentionDays: args.retentionDays });
    progress.finish(finalized.summary);
    const stopReason = finalized.complete
      ? "cycle_complete"
      : (Number.isFinite(deadline) && Date.now() >= deadline ? "time_budget_reached" : "queue_incomplete");
    console.log(JSON.stringify({
      finalized,
      stopReason,
      workerLimit: controller.activeLimit,
      reportSystem,
      reportRetention,
      retention,
    }, null, 2));
    if (finalized.complete && finalized.summary.failed) process.exitCode = 1;
  } finally {
    await releaseLock();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(closePool);
}
