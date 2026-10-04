import assert from "node:assert/strict";
import fs from "node:fs";
import { withRegistrationEvidence } from "./fixtures/rto-stock-evidence.mjs";
import {
  RTO_DAILY_CATEGORIES,
  RTO_DAILY_FUEL_GROUPS,
  RTO_DAILY_QUEUE_PRIORITIES,
  buildRankedRegistrationSnapshotRows,
  rtoDailyExpectedRowCount,
  scrapeStatusForSnapshotDate,
  selectAuthoritativeObservation,
  snapshotDateKey,
  targetMonthForDate,
  validateRtoDailyReport,
} from "../lib/rto-daily-snapshots.mjs";
import { canonicalizeRtoCatalog, rtoStorageLabels, resolveRtoWithCatalog, searchRtoCatalog, toCatalogRto } from "../lib/rto-resolver.mjs";
import { canonicalRegistrationRows } from "../lib/registrations.mjs";
import { createTerminalProgress, formatRtoDailyProgress } from "../lib/terminal-progress.mjs";
import { validateRtoDailyLoadTestCohort } from "../lib/rto-daily-cohort.mjs";
import { createAdaptiveController, requireCompleteFailureReasons, parseArgs, finishRtoDailyReports } from "./run-rto-daily-snapshots.mjs";

assert.equal(parseArgs(["--preserve-history"]).preserveHistory, true);
assert.equal(parseArgs([]).preserveHistory, false);
const productionWorkflow = fs.readFileSync(new URL("../.github/workflows/rto-daily-neon-production.yml", import.meta.url), "utf8");
assert.match(productionWorkflow, /cron: "30 14 \* \* \*"/,
  "production scheduling must target 20:00 IST (14:30 UTC)");
assert.match(productionWorkflow, /initialize_cohort:[\s\S]*?default: false/,
  "manual production runs must not reseed an existing daily queue by default");
assert.match(productionWorkflow, /--neon --work-queue --allow-partial --time-budget-minutes 315/,
  "production queue runs must continue pending RTOs without automatically requeueing known partial failures");
assert.match(productionWorkflow, /github.event_name == 'workflow_dispatch' && inputs.retry_failed == true && '--retry-failed'/,
  "an explicit manual recovery run must requeue failed jobs without resetting scheduled runs");
assert.doesNotMatch(productionWorkflow, /--retry-incomplete/,
  "successful jobs must retain their first valid observations during recovery");
assert.throws(() => parseArgs(["--preserve-history", "--date=2000-01-01"]), /historical reruns are forbidden/);
for (const preserveHistory of [true, false]) {
  const calls = [];
  const result = await finishRtoDailyReports({ run: { id: 1, snapshotDate: snapshotDateKey() }, args: { preserveHistory, retentionDays: 30 } }, {
    reconcile: async options => { calls.push(["reconcile", options]); return { verified: true }; },
    pruneReports: async () => { calls.push(["pruneReports"]); return {}; },
    pruneSnapshots: async options => { calls.push(["pruneSnapshots", options]); return {}; },
  });
  assert.equal(calls[0][1].includeAvailableHistory, !preserveHistory);
  assert.equal(calls.length, preserveHistory ? 1 : 3, "preservation must never invoke either destructive cleanup");
  if (preserveHistory) {
    assert.equal(calls[0][1].historyFrom, null);
    assert.equal(result.reportRetention.skipped, "preserve_history");
    assert.equal(result.retention.skipped, "preserve_history");
  }
}

const loadTestCohort = JSON.parse(fs.readFileSync(new URL("../data/vahan/rto-top-100-cohort.json", import.meta.url), "utf8"));
const validatedLoadTestCohort = validateRtoDailyLoadTestCohort(loadTestCohort);
assert.equal(validatedLoadTestCohort.length, 100, "hosted load-test cohort must have exactly 100 members");
assert.deepEqual(validatedLoadTestCohort.map((member) => member.rank), Array.from({ length: 100 }, (_, index) => index + 1), "hosted load-test cohort ranks must be contiguous");
assert.throws(
  () => validateRtoDailyLoadTestCohort({ members: [...validatedLoadTestCohort.slice(0, 99), { ...validatedLoadTestCohort[0], rank: 100 }] }),
  /duplicate member/i,
  "hosted load-test cohort must reject duplicate RTOs",
);
assert.throws(
  () => validateRtoDailyLoadTestCohort({ members: validatedLoadTestCohort.slice(0, 99) }),
  /exactly 100/i,
  "hosted load-test cohort must reject incomplete seeds",
);
assert.deepEqual(
  requireCompleteFailureReasons({
    finalized: { complete: true, summary: { total: 100, succeeded: 100, failed: 0, queued: 0, running: 0, retrying: 0, deferred: 0 } },
    readiness: { eligible: true, dailyRegistrationEligible: true, cohortSize: 100, completeRtos: 100 },
  }),
  [],
  "strict hosted completion should accept a fully evidenced 100-RTO run",
);
assert.match(
  requireCompleteFailureReasons({
    finalized: { complete: false, summary: { total: 100, succeeded: 99, failed: 0, queued: 1, running: 0, retrying: 0, deferred: 0 } },
    readiness: { eligible: false, reason: "cohort_incomplete", cohortSize: 100, completeRtos: 99 },
  }).join(" | "),
  /cycle did not finish|expected 100 successful|queued|not eligible|complete evidence/i,
  "strict hosted completion should reject partial cycles and missing evidence",
);
assert.equal(rtoDailyExpectedRowCount(), 30, "Public Dashboard top-five collection should store at most 30 rows per RTO");
assert.deepEqual(selectAuthoritativeObservation(null, { valid: true }), {
  accepted: true, disposition: "accepted", reason: "first_valid_observation_for_date",
});
assert.equal(selectAuthoritativeObservation({ id: 41 }, { valid: true }).authoritativeObservationId, 41,
  "same-date reruns retain the first valid observation as the comparison boundary");
assert.equal(selectAuthoritativeObservation(null, { valid: false }).disposition, "rejected");
assert.match(
  requireCompleteFailureReasons({
    finalized: { complete: true, summary: { total: 100, succeeded: 100, failed: 0, queued: 0, running: 0, retrying: 0, deferred: 0 } },
    readiness: {
      eligible: true,
      dailyRegistrationEligible: false,
      dailyRegistrationReason: "comparison evidence is incomplete",
      cohortSize: 100,
      completeRtos: 100,
    },
  }).join(" | "),
  /Daily registration comparison readiness.*incomplete/i,
  "warning-only collection readiness must not make Daily reports usable",
);

const rankedRows = buildRankedRegistrationSnapshotRows({
  sourceRows: [{ maker: "Maker A", count: 12, rank: 1 }, { maker: "Maker B", count: 7, rank: 2 }],
  state: "Uttarakhand", rto: "Haridwar RTO", snapshotDate: "2026-09-07", targetMonth: "2026-09",
  fuelGroup: "EV", vehicleCategory: "2W",
});
assert.deepEqual(rankedRows.map((row) => [row.oem, row.vehicleCount, row.sourceRank]), [["Maker A", 12, 1], ["Maker B", 7, 2]]);
assert.ok(rankedRows.every((row) => row.metricKind === "registration_month_to_date" && row.source === "vahan-public-dashboard"));

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
const hostedLoadTestWorkflow = fs.readFileSync(new URL("../.github/workflows/rto-daily-hosted-load-test.yml", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.match(taskRegistration, /New-TimeSpan -Minutes 15/, "the local RTO worker should repeat every 15 minutes");
assert.match(taskRegistration, /New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 2:00AM/, "the OSM refresh should run once a week on Sunday");
assert.match(taskRegistration, /VahanEY-RtoInsightsOsm/, "the OSM refresh should have its own scheduled task");
assert.match(taskRegistration, /run-hidden-local-db-task\.vbs/, "the scheduled RTO worker should use the windowless launcher");
assert.match(taskRegistration, /\$settings\.Hidden = \$true/, "the scheduled RTO worker should be hidden in Task Scheduler");
assert.doesNotMatch(taskRegistration, /VahanEY-(Postgres|TrackedQueries|PostgresBackup|RtoCatalog)/, "registration should create only the daily RTO task");
assert.match(taskUnregister, /VahanEY-Postgres[\s\S]+VahanEY-RtoDaily[\s\S]+VahanEY-RtoFactorDaily/, "cleanup should remove the remaining local Vahan tasks");
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
assert.match(dailyRunnerSource, /args\.neon[\s\S]+assertNeonDatabaseUrl/, "Neon mode should validate the configured database before scraping");
assert.match(dailyRunnerSource, /storage: args\.neon \? \"neon\"/, "Neon runs should identify their persistence target in output");
assert.match(dailyRunnerSource, /--require-complete/, "the RTO worker should expose strict hosted-load-test completion gating");
assert.match(dailyRunnerSource, /fetchPublicRtoRegistrationSegment/, "the fixed RTO worker should use the Public Dashboard monthly-registration endpoint");
assert.doesNotMatch(dailyRunnerSource, /fetchPublicRtoStockSegment/, "the Daily worker must not collect As-On-Date active stock");
assert.doesNotMatch(dailyRunnerSource, /createVahanMakerSession/, "the fixed RTO worker should not depend on the retired legacy dashboard session");
assert.match(hostedLoadTestWorkflow, /workflow_dispatch:/, "the hosted load test must be manually triggered");
assert.doesNotMatch(hostedLoadTestWorkflow, /schedule:/, "the hosted load test must not be scheduled");
assert.match(hostedLoadTestWorkflow, /postgres:17/, "the hosted load test must use an ephemeral PostgreSQL service");
assert.match(hostedLoadTestWorkflow, /--require-complete/, "the hosted load test must enforce full report readiness");
assert.doesNotMatch(hostedLoadTestWorkflow, /NEON|neon\.tech|secrets\./i, "the hosted load test must not connect to Neon or use database secrets");
assert.equal(
  packageJson.scripts["rto-daily:neon"],
  "node --env-file=.env.neon scripts/run-rto-daily-snapshots.mjs --neon --work-queue",
  "the Neon RTO command should load the Neon environment and run the DB-backed work queue",
);

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
const resolvedDl01 = resolveRtoWithCatalog({ state: "Delhi", rtoSearch: "DL-01", locationText: "DL-01" }, {
  states: [{ state: "Delhi", rtos: [
    toCatalogRto("MALL ROAD - DL1"),
    toCatalogRto("RAJOURI GARDEN - DL10"),
    toCatalogRto("ROHINI - DL11"),
  ] }],
});
assert.equal(resolvedDl01.rto, "MALL ROAD - DL1", "DL-01 should match the exact RTO code, not DL-10 or DL-11");
assert.equal(resolvedDl01.ambiguousRtos, null, "an exact RTO code should not be reported as ambiguous");
const resolvedMh12WithDuplicateCatalogLabel = resolveRtoWithCatalog({ state: "Maharashtra", rtoSearch: "MH-12", locationText: "MH-12" }, {
  states: [{ state: "Maharashtra", rtos: [
    toCatalogRto("PUNE - MH12"),
    toCatalogRto("Pune Regional Transport Office MH12"),
  ] }],
});
assert.equal(resolvedMh12WithDuplicateCatalogLabel.rtoResolution.status, "resolved", "an exact code should resolve even if the catalog contains duplicate labels");
assert.equal(resolvedMh12WithDuplicateCatalogLabel.ambiguousRtos, null, "duplicate labels for one exact code must not produce an ambiguity prompt");
const resolvedNoidaWithDatedLegacyLabel = resolveRtoWithCatalog({ state: "Uttar Pradesh", rtoSearch: "Noida", locationText: "Noida" }, {
  states: [{ state: "Uttar Pradesh", rtos: [
    toCatalogRto("Noida - UP16"),
    toCatalogRto("Noida - UP16( 13-NOV-2017 )"),
  ] }],
});
assert.equal(resolvedNoidaWithDatedLegacyLabel.rto, "Noida - UP16", "a dated legacy label must not make the current RTO label ambiguous");
assert.equal(resolvedNoidaWithDatedLegacyLabel.ambiguousRtos, null, "dated legacy variants should collapse to the current RTO");
for (const labels of [
  ["Noida - UP16", "Noida - UP16( 13-NOV-2017 )"],
  ["Noida - UP16( 13-NOV-2017 )", "Noida - UP16"],
]) {
  const catalog = canonicalizeRtoCatalog({ states: [{ state: "Uttar Pradesh", rtos: labels.map(toCatalogRto) }] });
  assert.deepEqual(catalog.states[0].rtos.map((rto) => rto.label), ["Noida - UP16"], "the catalog exposed to filters must contain only one Noida office");
  assert.equal(resolveRtoWithCatalog({ locationText: "Noida" }, catalog).rto, "Noida - UP16");
  assert.deepEqual(canonicalizeRtoCatalog(catalog), catalog, "catalog canonicalization must be idempotent");
}
assert.ok(rtoStorageLabels("Uttar Pradesh", "Noida - UP16").includes("Noida - UP16( 13-NOV-2017 )"), "removing a selectable duplicate must preserve access to historical rows");
const legacyRegistration = {
  year: 2026, month: 1, state: "Uttar Pradesh", rto: "Noida - UP16( 13-NOV-2017 )",
  fuel_segment: "EV", fuel_type: "ELECTRIC(BOV)", fuel_filter: "ALL",
  vehicle_category_filter: "ALL", norms_filter: "ALL", vehicle_class_filter: "ALL",
  vehicle_count: 10, scraped_at: "2026-01-01T00:00:00Z", source_url: "fixture",
};
const newerRegistration = { ...legacyRegistration, rto: "Noida - UP16", vehicle_count: 12, scraped_at: "2026-01-02T00:00:00Z" };
for (const rows of [[legacyRegistration, newerRegistration], [newerRegistration, legacyRegistration]]) {
  assert.deepEqual(canonicalRegistrationRows(rows), [newerRegistration], "legacy and canonical observations of one context must not double-count registrations");
}
const historicalOnly = canonicalRegistrationRows([legacyRegistration]);
assert.equal(historicalOnly[0].rto, "Noida - UP16");
assert.equal(historicalOnly[0].vehicle_count, 10, "historical-only evidence must remain readable");
assert.equal(canonicalRegistrationRows([legacyRegistration, { ...newerRegistration, vehicle_category_filter: "MOTOR CAR" }]).length, 2, "distinct source filter contexts must remain separate");
const fitnessCatalog = { states: [{ state: "Maharashtra", rtos: [
  toCatalogRto("RTO MH04-Mira Bhayander FitnessTrack - MH203"),
  toCatalogRto("THANE - MH4"),
] }] };
assert.equal(resolveRtoWithCatalog({ locationText: "MH-04" }, fitnessCatalog).rto, "THANE - MH4", "an embedded reference code must not override the office's final code");
assert.equal(resolveRtoWithCatalog({ locationText: "MH-203" }, fitnessCatalog).rto, "RTO MH04-Mira Bhayander FitnessTrack - MH203");
assert.equal(resolveRtoWithCatalog({ rto: "RTO MH04-Mira Bhayander FitnessTrack - MH203" }, fitnessCatalog).rto, "RTO MH04-Mira Bhayander FitnessTrack - MH203");
const genuineMultiOfficeCatalog = { states: [{ state: "Tamil Nadu", rtos: [
  toCatalogRto("ERODE RTO - TN33"), toCatalogRto("ERODE (WEST) RTO - TN86"),
] }] };
assert.equal(resolveRtoWithCatalog({ locationText: "Erode" }, genuineMultiOfficeCatalog).rtoResolution.status, "ambiguous", "distinct office codes in the same city must remain selectable");
const legacyCityCatalog = canonicalizeRtoCatalog({ states: [{ state: "Karnataka", rtos: [
  toCatalogRto("bengaluru"), toCatalogRto("BENGALURU CENTRAL RTO - KA1"), toCatalogRto("BENGALURU EAST RTO - KA3"),
] }] }, { requireOfficeCode: true });
assert.equal(legacyCityCatalog.states[0].rtos.length, 2, "unidentified city rows must not appear as an additional office");
assert.equal(resolveRtoWithCatalog({ locationText: "bengaluru" }, legacyCityCatalog).rtoResolution.status, "ambiguous", "a legacy city-only record must not override multiple official offices");
for (const [state, canonical, legacy] of [
  ["Maharashtra", "PUNE - MH12", "PUNE - MH12( 25-JAN-2017 )"],
  ["Punjab", "RTO LUDHIANA - PB10", "RTO LUDHIANA - PB10( 25-JAN-2018 )"],
  ["Uttarakhand", "HARIDWAR ARTO - UK8", "haridwar"],
  ["Uttarakhand", "DEHRADUN RTO - UK7", "dehradun"],
]) {
  for (const labels of [[legacy, canonical], [canonical, legacy]]) {
    const catalog = canonicalizeRtoCatalog({ states: [{ state, rtos: labels.map(toCatalogRto) }] });
    assert.deepEqual(catalog.states[0].rtos.map((rto) => rto.label), [canonical]);
    assert.ok(rtoStorageLabels(state, canonical).includes(legacy));
  }
}
const resolvedExactSavedLabel = resolveRtoWithCatalog({ state: "Uttarakhand", rtoSearch: "haridwar", locationText: "haridwar" }, {
  states: [{ state: "Uttarakhand", rtos: [
    toCatalogRto("haridwar"),
    toCatalogRto("HARIDWAR ARTO - UK8"),
  ] }],
});
assert.equal(resolvedExactSavedLabel.rto, "HARIDWAR ARTO - UK8", "a legacy city-only label must resolve to the canonical office");

for (const [state, canonical, legacy, query] of [
  ["Uttar Pradesh", "Noida - UP16", "Noida - UP16( 13-NOV-2017 )", "noida"],
  ["Maharashtra", "PUNE - MH12", "PUNE - MH12( 25-JAN-2017 )", "pune"],
  ["Punjab", "RTO LUDHIANA - PB10", "RTO LUDHIANA - PB10( 25-JAN-2018 )", "PB10"],
  ["Uttarakhand", "HARIDWAR ARTO - UK8", "haridwar", "haridwar"],
  ["Uttarakhand", "DEHRADUN RTO - UK7", "dehradun", "dehradun"],
]) {
  for (const labels of [[legacy, canonical], [canonical, legacy]]) {
    const catalog = { states: [{ state, rtos: labels.map(toCatalogRto) }] };
    assert.equal(resolveRtoWithCatalog({ state, locationText: query }, catalog).rto, canonical);
    assert.equal(resolveRtoWithCatalog({ state, rto: legacy }, catalog).rto, canonical);
    assert.deepEqual(searchRtoCatalog(catalog, query, { state }).map((entry) => entry.rto), [canonical]);
  }
}

assert.equal(validateRtoDailyReport(withRegistrationEvidence({
  status: "success",
  state: "Uttarakhand",
  rto: "Haridwar RTO",
  fuelGroup: "EV",
  vehicleCategory: "2W",
  filtersConfirmed: true,
  reportTotal: 0,
  explicitZero: true,
  rows: [], targetMonth: "2026-09", scrapedAt: "2026-09-09T08:00:00Z",
}), { state: "Uttarakhand", rto: "Haridwar RTO" }), true);

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
  /empty maker evidence is neither explicitly unavailable nor a confirmed zero/,
  "unexplained empty reports must never become trusted zero snapshots",
);

assert.equal(validateRtoDailyReport(withRegistrationEvidence({
  status: "success", state: "Uttarakhand", rto: "Haridwar RTO", fuelGroup: "EV", vehicleCategory: "2W",
  filtersConfirmed: true, reportTotal: 20, explicitZero: false,
  rows: [], targetMonth: "2026-09", scrapedAt: "2026-09-09T08:00:00Z",
})), true);
assert.throws(() => validateRtoDailyReport({
  status: "success", state: "Uttarakhand", rto: "Haridwar RTO", fuelGroup: "EV", vehicleCategory: "2W",
  filtersConfirmed: true, reportTotal: 10, rows: [{ maker: "Maker A", vehicle_count: 11, rank: 1 }],
}), /top-maker total exceeds report total/);
assert.throws(() => validateRtoDailyReport({
  status: "success", state: "Uttarakhand", rto: "Haridwar RTO", fuelGroup: "EV", vehicleCategory: "2W",
  filtersConfirmed: true, reportTotal: null, explicitZero: true, rows: [],
}), /report total is invalid/);
assert.throws(() => validateRtoDailyReport({
  status: "success", state: "Uttarakhand", rto: "Haridwar RTO", fuelGroup: "EV", vehicleCategory: "2W",
  filtersConfirmed: true, reportTotal: 10, rows: [{ maker: "Maker A", vehicle_count: 1.5, rank: 1 }],
}), /maker count is invalid/);

console.log("RTO daily unit checks passed.");
