import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parseTrackingArguments, runOemTrackingCollection, trackingDatabaseUrl, trackingCoverageAudit } from "./collect-rto-oem-tracking.mjs";

const cohort = Array.from({ length: 100 }, (_, index) => ({ rank: index + 1, state: "Andhra Pradesh", rto: `RTO ${index + 1} - AP${index + 1}` }));
const makers = Array.from({ length: 5 }, (_, index) => ({ id: String(index + 1), name: `Maker ${index + 1}`, rank: index + 1, count: 100 - index }));
const key = (row) => JSON.stringify([row.state, row.rto, row.fuelGroup ?? row.fuel_group, row.vehicleCategory ?? row.vehicle_category]);
const observationKey = (row) => `${key(row)}:${row.makerId ?? row.maker_id}`;
const baselineOptions = parseTrackingArguments(["--mode", "baseline", "--latest-cohort", "--limit", "1"]);
const dailyOptions = parseTrackingArguments(["--mode", "daily", "--limit", "1"]);

for (const args of [[], ["--mode", "daily", "--latest-cohort"], ["--mode", "baseline"], ["--mode", "baseline", "--latest-cohort", "--cohort-run-id", "2"], ["--mode", "baseline", "--latest-cohort", "--selection-year", "2026"], ["--mode", "daily", "--limit", "101"], ["--mode", "daily", "--mode", "baseline"], ["--mode", "daily", "--production", "--unexpected"]]) assert.throws(() => parseTrackingArguments(args));
assert.equal(parseTrackingArguments(["--help"]).help, true);
assert.throws(() => trackingDatabaseUrl({ DATABASE_URL: "postgres://u:YOUR_PASSWORD@db.example.test/db" }, false), /explicit --production/);
assert.throws(() => trackingDatabaseUrl({ DATABASE_URL: "https://localhost/db" }, true), /PostgreSQL/);
assert.throws(() => trackingDatabaseUrl({}, true), /not configured/);
assert.equal(new URL(trackingDatabaseUrl({ DATABASE_URL: "postgres://u:YOUR_PASSWORD@ep-scope-pooler.eu-central-1.aws.neon.tech/db" }, true)).hostname, "ep-scope.eu-central-1.aws.neon.tech");
assert.equal(new URL(trackingDatabaseUrl({ DATABASE_URL: "postgres://localhost/db", DATABASE_URL_UNPOOLED: "postgres://localhost/direct" }, false)).pathname, "/direct");

function harness({ scopes: initialScopes = [], active = true, date = "2026-10-04T06:00:00Z" } = {}) {
  let clock = Date.parse(date);
  const baseline = { id: 1, selectionYear: 2025, active, cohort };
  const scopes = new Map(initialScopes.map((row) => [key(row), row]));
  const observations = new Map();
  const requests = [];
  const finishes = [];
  let createCalls = 0;
  let releaseCalls = 0;
  let pruneCalls = 0;
  const store = {
    createOemBaseline: async ({ cohort: frozen, selectionYear }) => { createCalls += 1; assert.equal(frozen.length, 100); assert.equal(selectionYear, 2025); return baseline; },
    getOemBaseline: async ({ baselineId }) => baselineId === 1 ? baseline : null,
    getActiveOemBaseline: async () => active ? baseline : null,
    getOemBaselineScopes: async () => [...scopes.values()],
    saveOemBaselineScope: async (row) => { if (scopes.get(key(row))?.status !== "verified") scopes.set(key(row), { ...row, status: row.evidence ? "verified" : "unavailable", makers: row.evidence?.makers ?? [], rankingComplete: row.evidence?.rankingComplete ?? false }); },
    finishOemBaseline: async (row) => finishes.push(row),
    createOemDailyRun: async ({ date: observedDate }) => ({ id: 1, date: observedDate }),
    getOemDailyPending: async () => [...scopes.values()].flatMap((scope) => scope.status === "verified" ? scope.makers.filter((maker) => observations.get(observationKey({ ...scope, makerId: maker.id }))?.status !== "verified").map((maker) => ({ ...scope, makerId: maker.id, makerName: maker.name })) : []),
    saveOemDailyObservation: async (row) => { if (observations.get(observationKey(row))?.status !== "verified") observations.set(observationKey(row), { ...row, status: row.evidence ? "verified" : "unavailable", count: row.evidence?.count }); },
    listOemDailyObservations: async () => [...observations.values()],
    finishOemDailyRun: async (row) => finishes.push(row),
    pruneOemTrackingEvidence: async ({ date: observedDate }) => { pruneCalls += 1; assert.match(observedDate, /^\d{4}-\d{2}-\d{2}$/); },
  };
  const deps = {
    store, now: () => clock, sleep: async (ms) => { clock += ms; }, advance: (ms) => { clock += ms; }, log: () => {},
    acquireLock: async (_owner, lockOptions) => { assert.equal(lockOptions.guardLoss, true); return async () => { releaseCalls += 1; }; },
    latestCohortRunId: async () => 42, loadCohort: async (id) => { assert.equal(id, 42); return cohort; },
    fetchBaseline: async (input) => {
      assert.equal(input.year, 2025);
      assert.equal(input.maxRequestAttempts, 1);
      await input.beforeRequest(); requests.push(clock);
      await input.beforeRequest(); requests.push(clock);
      return { observedAt: new Date(clock).toISOString(), selectionYear: 2025, rankingComplete: true, makers };
    },
    fetchTracked: async (input) => {
      assert.equal(input.year, 2026);
      assert.equal(input.maxRequestAttempts, 1);
      await input.beforeRequest(); requests.push(clock);
      return { makers: input.makers.map((maker) => ({ ...maker, status: "verified", evidence: { count: 200, makerId: maker.id, observedAt: new Date(clock).toISOString() } })) };
    },
  };
  return { deps, scopes, observations, requests, finishes, baseline, counts: () => ({ createCalls, releaseCalls, pruneCalls }) };
}

// Baseline collection is historical selection with actual current observation times and fixed 100-RTO membership.
const seeded = harness({ active: false });
let result = await runOemTrackingCollection(baselineOptions, seeded.deps);
assert.equal(result.audit.verifiedScopes, 6);
assert.equal(result.audit.selectedMakers, 30);
assert.equal(result.exitCode, 1);
assert.equal(seeded.finishes[0].activate, false);
assert.ok([...seeded.scopes.values()].every((row) => row.evidence.observedAt.startsWith("2026-10-04")));
assert.ok(seeded.requests.slice(1).every((time, index) => time - seeded.requests[index] >= 1200));
assert.equal(seeded.counts().releaseCalls, 1);
assert.equal(result.audit.requestCount, 12);

// Successful membership is immutable across resumed baseline days; no refetch or reranking.
seeded.deps.advance(86_400_000);
seeded.deps.fetchBaseline = async () => { throw new Error("A verified scope must never be fetched on resume"); };
result = await runOemTrackingCollection(parseTrackingArguments(["--mode", "baseline", "--resume-baseline-id", "1", "--limit", "1"]), seeded.deps);
assert.equal(result.audit.requestCount, 0);
assert.equal(seeded.counts().createCalls, 1);

// Daily runs reuse the active baseline, checkpoint verified makers and only retry unsuccessful OEMs.
const baselineScopes = [];
for (const member of cohort) for (const fuelGroup of ["EV", "ICE"]) for (const vehicleCategory of ["2W", "3W", "4W"]) baselineScopes.push({ ...member, fuelGroup, vehicleCategory, status: "verified", rankingComplete: true, makers });
const daily = harness({ scopes: baselineScopes });
daily.deps.latestCohortRunId = async () => { throw new Error("Daily must never replace the frozen cohort"); };
daily.deps.loadCohort = daily.deps.latestCohortRunId;
const attempts = [];
let failed = false;
daily.deps.fetchTracked = async (input) => {
  await input.beforeRequest();
  attempts.push(input.makers.map((maker) => maker.id));
  return { makers: input.makers.map((maker) => {
    if (!failed && maker.id === "2") { failed = true; return { ...maker, status: "unavailable", reason: "temporary source failure postgres://user:YOUR_PASSWORD@host/db" }; }
    return { ...maker, status: "verified", evidence: { count: 200, observedAt: new Date(daily.deps.now()).toISOString() } };
  }) };
};
result = await runOemTrackingCollection(dailyOptions, daily.deps);
assert.deepEqual(attempts[1], ["2"]);
assert.equal(result.audit.verifiedMakers, 30);
assert.equal(result.audit.selectedMakers, 3000);
assert.equal(daily.counts().createCalls, 0);
assert.doesNotMatch(JSON.stringify(result.audit), /YOUR_PASSWORD/);
assert.equal(result.audit.observationDate, "2026-10-04");
const firstRequests = attempts.length;
result = await runOemTrackingCollection(dailyOptions, daily.deps);
assert.equal(attempts.length, firstRequests);
assert.equal(result.audit.requestCount, 0);

// Repeated failures stop at three attempts and remain explicit unavailable entries.
const failing = harness({ scopes: baselineScopes });
let failureCalls = 0;
failing.deps.fetchTracked = async ({ beforeRequest }) => { await beforeRequest(); failureCalls += 1; throw new Error("source unavailable"); };
result = await runOemTrackingCollection(dailyOptions, failing.deps);
assert.equal(failureCalls, 18);
assert.equal(result.audit.verifiedMakers, 0);
assert.equal(failing.observations.size, 30);
assert.equal(result.audit.missingExamples.length, 12);
assert.ok([...failing.observations.values()].every((row) => row.status === "unavailable"));

// Sparse chart/count 404s remain scoped; a catalog outage across three distinct RTOs stops broader collection.
const routeOutage = harness({ scopes: baselineScopes });
let missingRouteCalls = 0;
routeOutage.deps.fetchTracked = async ({ beforeRequest }) => { await beforeRequest(); missingRouteCalls += 1; throw new Error("Public Dashboard catalog returned HTTP 404."); };
result = await runOemTrackingCollection({ ...dailyOptions, limit: 3 }, routeOutage.deps);
assert.equal(missingRouteCalls, 39);
assert.equal(routeOutage.observations.size, 65);
assert.match(result.audit.stopReason, /three distinct RTOs/);
assert.equal(routeOutage.counts().pruneCalls, 1);
const baselineOutage = harness({ active: false });
let baselineRouteCalls = 0;
baselineOutage.deps.fetchBaseline = async ({ beforeRequest }) => { await beforeRequest(); baselineRouteCalls += 1; throw new Error("Annual OEM source returned HTTP 404."); };
result = await runOemTrackingCollection(baselineOptions, baselineOutage.deps);
assert.equal(baselineRouteCalls, 18);
assert.equal(baselineOutage.scopes.size, 6);
assert.equal(result.audit.stopReason, null);
const separatedCatalogFailures = harness({ active: false });
const successfulBaseline = separatedCatalogFailures.deps.fetchBaseline;
let separatedFailures = 0;
separatedCatalogFailures.deps.fetchBaseline = async (input) => {
  if (input.fuels.includes("PURE EV") && input.vehicleCategories[0] === "TWO WHEELER(NT)") {
    await input.beforeRequest(); separatedFailures += 1;
    throw new Error("OEM tracking source returned HTTP 404: /analytics/publicdashboard/lazy/vehicle-makers.");
  }
  return successfulBaseline(input);
};
result = await runOemTrackingCollection({ ...baselineOptions, limit: 3 }, separatedCatalogFailures.deps);
assert.equal(separatedFailures, 9);
assert.equal(separatedCatalogFailures.scopes.size, 18);
assert.equal(result.audit.verifiedScopes, 15);
assert.equal(result.audit.stopReason, null);
// Zero-only scopes cannot claim that the maker catalog recovered.
const zeroBetweenCatalogFailures = harness({ active: false });
zeroBetweenCatalogFailures.deps.fetchBaseline = async (input) => {
  await input.beforeRequest();
  if (input.fuels.includes("PURE EV") && input.vehicleCategories[0] === "TWO WHEELER(NT)") throw new Error("OEM tracking source returned HTTP 404: /analytics/publicdashboard/lazy/vehicle-makers.");
  return { observedAt: new Date(zeroBetweenCatalogFailures.deps.now()).toISOString(), selectionYear: 2025, rankingComplete: true, explicitZero: true, makers: [] };
};
result = await runOemTrackingCollection({ ...baselineOptions, limit: 3 }, zeroBetweenCatalogFailures.deps);
assert.match(result.audit.stopReason, /three distinct RTOs/);
assert.equal(zeroBetweenCatalogFailures.scopes.size, 13);

// Midnight responses never become a backdated observation.
const midnight = harness({ scopes: baselineScopes, date: "2026-10-04T18:29:58Z" });
midnight.deps.fetchTracked = async ({ beforeRequest, makers: requested }) => {
  await beforeRequest(); midnight.deps.advance(3000);
  return { makers: requested.map((maker) => ({ ...maker, status: "verified", evidence: { count: 201, observedAt: new Date(midnight.deps.now()).toISOString() } })) };
};
result = await runOemTrackingCollection(dailyOptions, midnight.deps);
assert.equal(midnight.observations.size, 0);
assert.match(result.audit.stopReason, /IST date changed/);
assert.equal(result.audit.observationDate, "2026-10-04");
assert.equal(midnight.counts().releaseCalls, 1);
assert.equal(midnight.counts().pruneCalls, 1);

// Time budget retains a just-completed valid-day checkpoint and stops subsequent requests.
const budget = harness({ scopes: baselineScopes });
budget.deps.fetchTracked = async ({ beforeRequest, makers: requested }) => {
  await beforeRequest(); budget.deps.advance(61_000);
  return { makers: requested.map((maker) => ({ ...maker, status: "verified", evidence: { count: 201, observedAt: new Date(budget.deps.now()).toISOString() } })) };
};
result = await runOemTrackingCollection({ ...dailyOptions, timeBudgetMinutes: 1 }, budget.deps);
assert.equal(budget.observations.size, 5);
assert.match(result.audit.stopReason, /time budget/);
assert.equal(budget.counts().pruneCalls, 1);

// A stop during a later individual request keeps preceding same-day verified results.
const partialBudget = harness({ scopes: baselineScopes });
partialBudget.deps.fetchTracked = async ({ beforeRequest, makers: requested }) => {
  await beforeRequest();
  const evidence = { count: 202, observedAt: new Date(partialBudget.deps.now()).toISOString() };
  partialBudget.deps.advance(61_000);
  throw Object.assign(new Error("Collection time budget exhausted before the next OEM"), { code: "OEM_COLLECTION_STOPPED",
    trackingResults: [{ ...requested[0], status: "verified", evidence }] });
};
result = await runOemTrackingCollection({ ...dailyOptions, timeBudgetMinutes: 1 }, partialBudget.deps);
assert.equal(partialBudget.observations.size, 1);
assert.equal(result.audit.verifiedMakers, 1);
assert.match(result.audit.stopReason, /time budget/);

// Midnight checkpoints can retain an earlier response, but cannot retain a later response under yesterday.
const partialMidnight = harness({ scopes: baselineScopes, date: "2026-10-04T18:29:58Z" });
partialMidnight.deps.fetchTracked = async ({ beforeRequest, makers: requested }) => {
  await beforeRequest();
  const earlier = { ...requested[0], status: "verified", evidence: { count: 203, observedAt: new Date(partialMidnight.deps.now()).toISOString() } };
  partialMidnight.deps.advance(3000);
  const later = { ...requested[1], status: "verified", evidence: { count: 204, observedAt: new Date(partialMidnight.deps.now()).toISOString() } };
  throw Object.assign(new Error("IST date changed during the next maker"), { code: "OEM_COLLECTION_STOPPED", trackingResults: [earlier, later] });
};
result = await runOemTrackingCollection(dailyOptions, partialMidnight.deps);
assert.equal(partialMidnight.observations.size, 1);
assert.equal(result.audit.verifiedMakers, 1);
assert.equal([...partialMidnight.observations.values()][0].evidence.count, 203);
assert.match(result.audit.stopReason, /IST date changed/);

// Daily refuses a missing baseline and never launches historical collection automatically.
const empty = harness({ active: false });
result = await runOemTrackingCollection(dailyOptions, empty.deps);
assert.equal(result.audit.status, "failed");
assert.match(result.audit.stopReason, /explicit manual 2025/);
assert.equal(empty.counts().createCalls, 0);
assert.equal(empty.counts().releaseCalls, 1);
const automaticEmpty = harness({ active: false });
result = await runOemTrackingCollection({ ...dailyOptions, automatic: true }, automaticEmpty.deps);
assert.equal(result.audit.status, "skipped");
assert.equal(result.exitCode, 0);
assert.equal(automaticEmpty.counts().releaseCalls, 0);
assert.equal(automaticEmpty.counts().createCalls, 0);
assert.equal(automaticEmpty.counts().pruneCalls, 0);
assert.match(result.audit.skipReason, /waiting for explicit manual/);

// Losing the session lock during pacing stops before the next source request.
// Earlier checkpoints remain resumable and an interrupted baseline cannot activate.
const lostLock = harness({ active: false });
let held = true;
const releaseLostLock = async () => { held = false; };
releaseLostLock.assertHeld = () => {
  if (!held) { const error = new Error("lock session lost"); error.code = "VAHAN_SCRAPE_LOCK_LOST"; throw error; }
};
lostLock.deps.acquireLock = async () => releaseLostLock;
lostLock.deps.fetchBaseline = async (input) => {
  await input.beforeRequest();
  lostLock.requests.push(lostLock.deps.now());
  return { observedAt: new Date(lostLock.deps.now()).toISOString(), selectionYear: 2025, rankingComplete: true, makers };
};
lostLock.deps.sleep = async (ms) => { lostLock.deps.advance(ms); held = false; };
result = await runOemTrackingCollection(parseTrackingArguments(["--mode", "baseline", "--latest-cohort"]), lostLock.deps);
assert.equal(lostLock.requests.length, 1);
assert.equal(result.audit.requestCount, 1);
assert.equal(result.audit.verifiedScopes, 1);
assert.match(result.audit.stopReason, /scrape lock was lost/);
assert.equal(lostLock.finishes[0].activate, false);
assert.equal(result.exitCode, 1);

// A loss before the first Daily request retains a failed audit and performs cleanup.
const lostDailyLock = harness({ scopes: baselineScopes });
let dailyReleased = 0;
const releaseLostDaily = async () => { dailyReleased += 1; };
let checks = 0;
releaseLostDaily.assertHeld = () => { if (++checks > 1) throw new Error("lock session lost"); };
lostDailyLock.deps.acquireLock = async () => releaseLostDaily;
result = await runOemTrackingCollection(dailyOptions, lostDailyLock.deps);
assert.equal(result.audit.requestCount, 0);
assert.equal(lostDailyLock.requests.length, 0);
assert.match(result.audit.stopReason, /scrape lock was lost/);
assert.equal(lostDailyLock.counts().pruneCalls, 1);
assert.equal(dailyReleased, 1);

// A complete manual pass is the only automatic promotion of a new selection version.
const full = harness({ active: false });
result = await runOemTrackingCollection(parseTrackingArguments(["--mode", "baseline", "--latest-cohort"]), full.deps);
assert.equal(result.exitCode, 0);
assert.equal(result.audit.completeRankings, 600);
assert.equal(full.finishes[0].activate, true);
const zero = trackingCoverageAudit({ baseline: full.baseline, scopes: [{ ...cohort[0], fuelGroup: "EV", vehicleCategory: "2W", status: "verified", explicitZero: true, rankingComplete: false, makers: [] }], mode: "baseline", startedAt: "2026-10-04T00:00:00Z", finishedAt: "2026-10-04T00:00:01Z" });
assert.equal(zero.completeRankings, 1);

// Workflow completion includes failed parents, uses trusted main and has no annual auto-collection duplicate.
const workflow = await fs.readFile(new URL("../.github/workflows/rto-oem-tracking-production.yml", import.meta.url), "utf8");
const legacy = await fs.readFile(new URL("../.github/workflows/rto-oem-annual-production.yml", import.meta.url), "utf8");
assert.match(workflow, /types: \[completed\]/);
assert.match(workflow, /ref: main/);
assert.doesNotMatch(workflow, /workflow_run\.conclusion/);
assert.match(workflow, /--mode daily/);
assert.match(workflow, /--mode baseline --selection-year 2025/);
assert.match(workflow, /if: always\(\)/);
assert.doesNotMatch(legacy, /workflow_run:/);
assert.match(legacy, /resume_run_id:/);
assert.match(legacy, /--resume-run-id "\$OEM_RESUME_RUN_ID"/);
console.log("OEM tracking collector: frozen historical selection, resumable checkpoints, bounded retries, pace, rollover, time budget, guards and workflow checks passed.");

// Source-accounted short rankings pass coverage, whereas a residual blocks completion.
const shortScopes = baselineScopes.map(s=>({...s,rankingComplete:false,makers:makers.slice(0,2),evidence:{total:199,makers:makers.slice(0,2)}}));
let shortAudit = trackingCoverageAudit({baseline:full.baseline,scopes:shortScopes,mode:'baseline',startedAt:'2026-10-06T00:00:00Z',finishedAt:'2026-10-06T00:00:01Z'});
assert.equal(shortAudit.status,'success');
assert.equal(shortAudit.sourceAccountedRankings,600);
assert.equal(shortAudit.completeRankings,0);
shortScopes[0].evidence.total=200;
assert.equal(trackingCoverageAudit({baseline:full.baseline,scopes:shortScopes,mode:'baseline'}).status,'partial');
assert.throws(()=>parseTrackingArguments(['--mode','baseline','--latest-cohort','--refresh']),/daily-only/);

// Refresh fetches verified scopes again; incomplete scopes do not replace saved counts.
const refreshHarness=harness({scopes:baselineScopes});
await runOemTrackingCollection(dailyOptions,refreshHarness.deps);
refreshHarness.deps.store.getOemDailyPending=async()=>baselineScopes.slice(0,6).flatMap(s=>s.makers.map(m=>({...s,makerId:m.id,makerName:m.name})));
let promotedScopes=0;
refreshHarness.deps.store.saveOemDailyScopeRefresh=async({results,errorReason})=>{
  if(errorReason || results.length!==5 || results.some(r=>r.status!=='verified'))return {saved:false,reason:errorReason ?? 'partial'};
  promotedScopes++;
  return {saved:true};
};
let refreshedResult=await runOemTrackingCollection(parseTrackingArguments(['--mode','daily','--refresh','--limit','1']),refreshHarness.deps);
assert.equal(promotedScopes,6);
assert.equal(refreshedResult.audit.refreshedScopes,6);
assert.ok(refreshedResult.audit.requestCount>0);
refreshHarness.deps.fetchTracked=async()=>({makers:[]});
refreshedResult=await runOemTrackingCollection(parseTrackingArguments(['--mode','daily','--refresh','--limit','1']),refreshHarness.deps);
assert.equal(promotedScopes,6);
assert.equal(refreshedResult.audit.refreshFailures.length,6);
assert.equal(refreshedResult.exitCode,1);
assert.equal(refreshedResult.audit.verifiedMakers,30);
