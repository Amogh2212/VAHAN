import assert from "node:assert/strict";
import fs from "node:fs";
import {
  RTO_DAILY_CATEGORIES,
  RTO_DAILY_FUEL_GROUPS,
  RTO_DAILY_QUEUE_PRIORITIES,
  RTO_DAILY_OEMS,
  countForOem,
  rtoDailyCombinationMatrix,
  rtoDailyExpectedRowCount,
  scrapeStatusForSnapshotDate,
  snapshotDateKey,
  targetMonthForDate,
  validateRtoDailyReport,
} from "../lib/rto-daily-snapshots.mjs";
import { searchRtoCatalog, toCatalogRto } from "../lib/rto-resolver.mjs";
import { createTerminalProgress, formatRtoDailyProgress } from "../lib/terminal-progress.mjs";
import { createAdaptiveController } from "./run-rto-daily-snapshots.mjs";

const matrix = rtoDailyCombinationMatrix();
assert.equal(matrix.length, 90, "daily RTO matrix should produce exactly 90 rows per RTO");
assert.equal(rtoDailyExpectedRowCount(), 90, "expected row count helper should return 90");

for (const fuelGroup of RTO_DAILY_FUEL_GROUPS) {
  for (const category of RTO_DAILY_CATEGORIES) {
    const rows = matrix.filter((item) => item.fuelGroup === fuelGroup && item.vehicleCategory === category);
    assert.equal(rows.length, RTO_DAILY_OEMS.length, `${fuelGroup}/${category} should include all OEMs`);
  }
}

const tata = RTO_DAILY_OEMS.find((item) => item.name === "Tata Motors");
assert.equal(
  countForOem([
    { maker: "TATA MOTORS LTD", vehicle_count: 10 },
    { maker: "TATA MOTORS LIMITED", vehicle_count: 8 },
    { maker: "NOT TATA", vehicle_count: 99 },
  ], tata),
  18,
  "OEM alias matching should sum known aliases only",
);

assert.equal(snapshotDateKey(new Date(Date.UTC(2026, 5, 14))), "2026-06-14");
assert.equal(targetMonthForDate(new Date(Date.UTC(2026, 5, 14))), "2026-06");
assert.equal(
  scrapeStatusForSnapshotDate("2026-07-18", new Date("2026-07-18T18:29:59.000Z")),
  "success",
  "snapshots scraped before the next IST day should remain same-day successes",
);
assert.equal(
  scrapeStatusForSnapshotDate("2026-07-18", new Date("2026-07-18T18:30:00.000Z")),
  "late_fill",
  "snapshots scraped after the IST day boundary should be marked as late fills",
);
assert.deepEqual(RTO_DAILY_QUEUE_PRIORITIES, { pin: 0, lookup: 10, rotation: 100 });
assert.equal(
  formatRtoDailyProgress(
    { total: 1670, succeeded: 31, running: 2, queued: 1637, failed: 0 },
    {
      width: 10,
      startedAt: "2026-06-24T19:30:00.000Z",
      baselineSucceeded: 31,
      now: "2026-06-24T19:32:00.000Z",
    },
  ),
  "[----------] 31/1670 RTOs fetched (1.9%) | running 2 | queued 1637 | failed 0 | elapsed 2m | rate --/hr | ETA calculating...",
  "terminal progress should report fetched RTOs and wait for current-session completions before estimating ETA",
);
assert.equal(
  formatRtoDailyProgress(
    { total: 61, succeeded: 51, running: 2, queued: 8, failed: 0 },
    {
      width: 10,
      startedAt: "2026-06-24T19:30:00.000Z",
      baselineSucceeded: 49,
      now: "2026-06-24T19:42:00.000Z",
    },
  ),
  "[########--] 51/61 RTOs fetched (83.6%) | running 2 | queued 8 | failed 0 | elapsed 12m | rate 10.0/hr | ETA 1h | finish ~02:12 IST",
  "terminal progress should estimate remaining time from current-session successful RTO pace",
);
assert.equal(
  formatRtoDailyProgress(
    { total: 1670, succeeded: 120, running: 7, activeRunning: 4, staleRunning: 3, queued: 1543, failed: 0 },
    { width: 10 },
  ),
  "[#---------] 120/1670 RTOs fetched (7.2%) | running 4 active + 3 stale | queued 1543 | failed 0",
  "terminal progress should separate active workers from expired running leases",
);
assert.equal(
  formatRtoDailyProgress(
    { total: 1670, succeeded: 245, running: 2, queued: 1422, failed: 0 },
    {
      width: 10,
      startedAt: "2026-06-27T10:00:00.000Z",
      baselineSucceeded: 209,
      now: "2026-06-27T10:30:00.000Z",
      compact: true,
    },
  ),
  "[#---------] 245/1670 (14.7%) | run 2 | q 1422 | fail 0 | 30m | 72.0/hr | ETA 19h 48m",
  "compact terminal progress should keep ETA visible in narrow interactive terminals",
);
const interactiveWrites = [];
const interactiveProgress = createTerminalProgress({
  stream: {
    isTTY: true,
    columns: 100,
    write(value) {
      interactiveWrites.push(value);
    },
  },
});
interactiveProgress.render({ total: 1670, succeeded: 209, running: 4, queued: 1461, failed: 0 });
interactiveProgress.render({ total: 1670, succeeded: 245, running: 2, queued: 1422, failed: 0 });
assert.match(
  interactiveWrites.join(""),
  /\[rto-daily:progress\].*\n\[rto-daily:progress\].*ETA /s,
  "interactive progress should print durable progress lines with ETA instead of overwriting them",
);
assert.equal(
  formatRtoDailyProgress(
    { total: 61, succeeded: 61, running: 0, queued: 0, failed: 0 },
    {
      width: 10,
      startedAt: "2026-06-24T19:30:00.000Z",
      baselineSucceeded: 49,
      now: "2026-06-24T20:30:00.000Z",
    },
  ),
  "[##########] 61/61 RTOs fetched (100.0%) | running 0 | queued 0 | failed 0 | elapsed 1h | rate 12.0/hr | ETA done",
  "terminal progress should stop estimating once the cycle is complete",
);

const adaptiveController = createAdaptiveController(4);
assert.equal(adaptiveController.activeLimit, 4, "adaptive controller should start at the configured worker limit");
adaptiveController.record({ retryCount: 9, reportCount: 120, failed: false });
assert.equal(adaptiveController.activeLimit, 3, "adaptive controller should reduce workers after a noisy retry window");
adaptiveController.record({ retryCount: 0, reportCount: 120, failed: false });
assert.equal(adaptiveController.activeLimit, 3, "adaptive controller should wait for multiple healthy windows before restoring workers");
adaptiveController.record({ retryCount: 0, reportCount: 120, failed: false });
assert.equal(adaptiveController.activeLimit, 4, "adaptive controller should restore workers after sustained healthy windows");

const taskRegistration = fs.readFileSync(new URL("./register-local-db-tasks.ps1", import.meta.url), "utf8");
const taskRunner = fs.readFileSync(new URL("./run-local-db-task.ps1", import.meta.url), "utf8");
const taskUnregister = fs.readFileSync(new URL("./unregister-local-db-tasks.ps1", import.meta.url), "utf8");
const postgresPreflight = fs.readFileSync(new URL("./ensure-local-postgres.ps1", import.meta.url), "utf8");
const scraperSource = fs.readFileSync(new URL("./vahan-scraper.mjs", import.meta.url), "utf8");
const dailyRunnerSource = fs.readFileSync(new URL("./run-rto-daily-snapshots.mjs", import.meta.url), "utf8");
assert.match(taskRegistration, /New-TimeSpan -Minutes 15/, "the local RTO worker should repeat every 15 minutes");
assert.match(taskRegistration, /New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 2:00AM/, "the OSM refresh should run once a week on Sunday");
assert.match(taskRegistration, /VahanEY-RtoInsightsOsm/, "the OSM refresh should have its own scheduled task");
assert.match(taskRegistration, /run-hidden-local-db-task\.vbs/, "the scheduled RTO worker should use the windowless launcher");
assert.match(taskRegistration, /\$settings\.Hidden = \$true/, "the scheduled RTO worker should be hidden in Task Scheduler");
assert.doesNotMatch(taskRegistration, /VahanEY-(Postgres|TrackedQueries|PostgresBackup|RtoCatalog)/, "registration should create only the daily RTO task");
assert.match(taskUnregister, /VahanEY-Postgres[\s\S]+VahanEY-RtoDaily[\s\S]+VahanEY-TrackedQueries/, "cleanup should remove all old local Vahan tasks");
assert.match(taskRunner, /ensure-local-postgres\.ps1/, "the scheduled RTO worker should run the local Postgres preflight");
assert.match(postgresPreflight, /Start-HiddenLocalPostgres[\s\S]+"-Job"[\s\S]+"postgres"/, "the preflight should start local Postgres hidden when needed");
assert.match(taskRunner, /rto-daily[\s\S]+--work-queue/, "the scheduled RTO worker must use bounded work-queue mode");
assert.match(taskRunner, /rto-insights-osm[\s\S]+--refresh-source[\s\S]+--limit", "2000"/, "the weekly OSM task should refresh the Geofabrik source and all enabled RTOs");
assert.match(taskRunner, /\$Job -in @\("rto-daily", "rto-insights-osm", "rto-factor-daily"\)/, "scheduled data jobs should run the local PostgreSQL preflight");
assert.match(taskRunner, /\$ErrorActionPreference = "Continue"[\s\S]+node --env-file=\$envFile/, "the scheduled RTO worker should log native stderr without treating recoverable scraper errors as task-fatal PowerShell errors");
assert.match(scraperSource, /acquireVahanScrapeLock\("rto-catalog"/, "manual catalog refresh must use the shared scrape lock");
assert.doesNotMatch(dailyRunnerSource, /findCarryoverRtoDailyCycle|rolloverRtoDailyCycle/, "scheduled work must not roll unfinished prior-day work into the current date");
assert.match(dailyRunnerSource, /args\.workQueue && !args\.dateExplicit[\s\S]+deferStaleRtoDailyCycles/, "scheduled work should skip unfinished prior-day work before creating the current cycle");
assert.match(dailyRunnerSource, /const run = await ensureRtoDailyCycle/, "each scheduled date should create or resume its own current-date cycle");
assert.match(dailyRunnerSource, /if \(args\.retryFailed\)[\s\S]+requeueFailedRtoDailyJobs/, "only an explicit retry request should requeue terminal failures");
assert.match(dailyRunnerSource, /args\.dateExplicit[\s\S]+deferStaleRtoDailyCycles/, "stale-cycle deferral should be reserved for explicit manual date runs");
assert.match(dailyRunnerSource, /scrapeStatusForSnapshotDate/, "the runner should label after-midnight carryover rows as late_fill");
assert.match(dailyRunnerSource, /stopReason[\s\S]+time_budget_reached/, "bounded worker output should explain a time-budget stop");
assert.match(dailyRunnerSource, /RTO_DAILY_PROGRESS_LOG_INTERVAL_MS[\s\S]+30_000/, "RTO progress summaries should be throttled instead of printed after every completed job");

const catalog = {
  states: [
    { state: "Haryana", rtos: [toCatalogRto("Gurugram RTO HR-26")] },
    { state: "Delhi", rtos: [toCatalogRto("WEST (HARI NAGAR) - DL4")] },
    { state: "Uttarakhand", rtos: [toCatalogRto("HARIDWAR ARTO - UK8")] },
    { state: "Uttar Pradesh", rtos: [toCatalogRto("Noida RTO UP-16")] },
  ],
};
assert.equal(searchRtoCatalog(catalog, "gurgaon")[0]?.rto, "Gurugram RTO HR-26", "city aliases should resolve in combobox search");
assert.equal(searchRtoCatalog(catalog, "UP-16")[0]?.state, "Uttar Pradesh", "official RTO codes should be searchable");
assert.equal(searchRtoCatalog(catalog, "UP16")[0]?.state, "Uttar Pradesh", "compact RTO codes should be searchable");
assert.equal(searchRtoCatalog(catalog, "UK08")[0]?.state, "Uttarakhand", "zero-padded RTO codes should be searchable");
assert.equal(searchRtoCatalog(catalog, "hari")[0]?.state, "Uttarakhand", "canonical label prefixes should outrank short aliases from unrelated RTOs");

assert.equal(validateRtoDailyReport({
  status: "success",
  state: "Uttarakhand",
  rto: "Haridwar RTO",
  fuelGroup: "EV",
  vehicleCategory: "2W",
  filtersConfirmed: true,
  reportTotal: 0,
  explicitZero: true,
  rows: [],
}, { state: "Uttarakhand", rto: "Haridwar RTO" }), true);

assert.throws(
  () => validateRtoDailyReport({
    status: "success",
    state: "Uttarakhand",
    rto: "Haridwar RTO",
    fuelGroup: "EV",
    vehicleCategory: "2W",
    filtersConfirmed: true,
    reportTotal: null,
    explicitZero: false,
    rows: [],
  }),
  /empty report was not explicitly confirmed as zero/,
  "unexplained empty reports must never become trusted zero snapshots",
);

console.log("RTO daily unit checks passed.");
