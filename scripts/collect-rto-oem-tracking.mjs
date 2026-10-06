import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { validateRtoDailyLoadTestCohort } from "../lib/rto-daily-cohort.mjs";
import { RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS, snapshotDateKey } from "../lib/rto-daily-snapshots.mjs";
import { sourceAccountsForShortRanking } from "../lib/rto-oem-tracking.mjs";

const HELP = `collect-rto-oem-tracking.mjs --mode baseline|daily [--production]
Baseline: (--cohort-run-id ID | --latest-cohort | --resume-baseline-id ID) [--selection-year 2025]
Daily: [--baseline-id ID] [--automatic] (defaults to the established active baseline; never creates one)
Optional: --refresh (daily only) --rto NAME --limit 1..100 --time-budget-minutes 315 --output PATH
Baseline resume preserves successful maker membership across days. Daily observations use today's IST date.
Remote writes require --production. DATABASE_URL is read directly; local dotenv files are never loaded.`;

export function parseTrackingArguments(args) {
  if (args.includes("--help")) return { help: true };
  const flags = new Set(["--mode", "--cohort-run-id", "--resume-baseline-id", "--baseline-id", "--selection-year", "--rto", "--limit", "--time-budget-minutes", "--output"]);
  const booleans = new Set(["--production", "--latest-cohort", "--automatic", "--refresh"]);
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if ((!flags.has(flag) && !booleans.has(flag)) || values.has(flag)) throw new Error(`Unknown or duplicate option: ${flag}`);
    if (booleans.has(flag)) values.set(flag, true);
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
      values.set(flag, value);
    }
  }
  const integer = (flag, fallback, maximum = Number.MAX_SAFE_INTEGER) => {
    const raw = values.get(flag);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${flag}.`);
    return value;
  };
  const options = {
    mode: values.get("--mode"), production: values.has("--production"), latestCohort: values.has("--latest-cohort"), automatic: values.has("--automatic"), refresh: values.has("--refresh"),
    cohortRunId: integer("--cohort-run-id", null), resumeBaselineId: integer("--resume-baseline-id", null), baselineId: integer("--baseline-id", null),
    selectionYear: integer("--selection-year", 2025, 9999), rto: values.get("--rto") ?? null, limit: integer("--limit", null, 100),
    timeBudgetMinutes: integer("--time-budget-minutes", 315, 330), output: values.get("--output") ?? "artifacts/rto-oem-tracking-summary.json",
  };
  if (!["baseline", "daily"].includes(options.mode)) throw new Error("--mode must be baseline or daily.");
  if (options.refresh && options.mode !== "daily") throw new Error("--refresh is daily-only.");
  if (options.selectionYear !== 2025) throw new Error("This tracking version selects OEMs using the complete 2025 calendar year.");
  if (options.mode === "baseline") {
    if (Number(Boolean(options.cohortRunId)) + Number(options.latestCohort) + Number(Boolean(options.resumeBaselineId)) !== 1) throw new Error("Baseline needs exactly one of --cohort-run-id, --latest-cohort or --resume-baseline-id.");
    if (options.baselineId) throw new Error("Use --resume-baseline-id to resume baseline collection.");
    if (options.automatic) throw new Error("Baseline selection requires an explicit manual collection.");
  } else if (options.cohortRunId || options.latestCohort || options.resumeBaselineId || values.has("--selection-year")) {
    throw new Error("Daily collection reuses the frozen baseline; cohort and selection-year options are baseline-only.");
  }
  return options;
}

export function trackingDatabaseUrl(env, production) {
  const value = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured.");
  let url;
  try { url = new URL(value); } catch { throw new Error("DATABASE_URL must be a PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !production) throw new Error("Remote OEM tracking writes require explicit --production.");
  // The shared scrape lock is a session advisory lock; Neon transaction pooling cannot own it safely.
  if (url.hostname.endsWith(".neon.tech")) url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
  return url.toString();
}

function safeReason(value) {
  return String(value ?? "Source evidence unavailable").replace(/(?:postgres(?:ql)?|https?):\/\/[^\s"']+/gi, "[redacted URL]").slice(0, 500);
}
const scopeKey = (row) => JSON.stringify([row.state, row.rto, row.fuelGroup ?? row.fuel_group, row.vehicleCategory ?? row.vehicle_category]);
const makerKey = (row) => `${scopeKey(row)}:${row.makerId ?? row.maker_id ?? row.id}`;
const statusOf = (row) => row.scopeStatus ?? row.status;
const dateKey = (now) => snapshotDateKey(new Date(now()), "Asia/Kolkata");
const dateIso = (now) => new Date(now()).toISOString();
class CollectionStopped extends Error {
  constructor(message) { super(message); this.code = "OEM_COLLECTION_STOPPED"; }
}
const missingCatalogRoute = (reason) => /HTTP\s+(?:404|410)\b/i.test(reason ?? "") && /catalog|\/lazy\/vehicle-makers|\/analytics\/json_rtos/i.test(reason ?? "");

function selectMembers(cohort, options) {
  let members = options.rto ? cohort.filter((row) => row.rto === options.rto) : cohort;
  if (!members.length) throw new Error("The requested RTO is not in the frozen baseline cohort.");
  if (options.limit) members = members.slice(0, options.limit);
  return members;
}

export function trackingCoverageAudit({ baseline, scopes = [], observations = [], mode, date, startedAt, finishedAt, requestCount = 0, stopReason = null }) {
  const scopeMap = new Map(scopes.map((row) => [scopeKey(row), row]));
  const observationMap = new Map(observations.map((row) => [makerKey(row), row]));
  const details = [];
  let verifiedScopes = 0;
  let completeRankings = 0;
  let sourceAccountedRankings = 0;
  let selectedMakers = 0;
  let verifiedMakers = 0;
  for (const member of baseline?.cohort ?? []) for (const fuelGroup of ["EV", "ICE"]) for (const vehicleCategory of ["2W", "3W", "4W"]) {
    const context = { state: member.state, rto: member.rto, fuelGroup, vehicleCategory };
    const row = scopeMap.get(scopeKey(context));
    const verified = statusOf(row ?? {}) === "verified";
    const complete = verified && Boolean((row.rankingComplete ?? row.ranking_complete ?? row.evidence?.rankingComplete) || (row.explicitZero ?? row.explicit_zero ?? row.evidence?.explicitZero));
    if (verified) verifiedScopes += 1;
    if (complete) completeRankings += 1;
    const sourceAccounted = verified && !complete && sourceAccountsForShortRanking(row.evidence);
    if (sourceAccounted) sourceAccountedRankings += 1;
    const makers = verified ? (row.makers ?? row.evidence?.makers ?? []) : [];
    const makerDetails = makers.map((maker) => {
      selectedMakers += 1;
      const observed = observationMap.get(makerKey({ ...context, makerId: maker.id }));
      if (observed?.status === "verified") verifiedMakers += 1;
      return { id: String(maker.id), name: maker.name, rank: maker.rank, baselineCount: maker.baselineCount ?? maker.count,
        status: observed?.status ?? "pending", count: observed?.status === "verified" ? Number(observed.count ?? observed.cumulative_count ?? observed.evidence?.count) : null,
        observedAt: observed?.observedAt ?? observed?.observed_at ?? observed?.evidence?.observedAt ?? null,
        reason: observed && observed.status !== "verified" ? safeReason(observed.errorReason ?? observed.error_reason) : null };
    });
    details.push({ ...context, baselineStatus: verified ? "verified" : row?.status ?? "pending", rankingComplete: complete, sourceAccountedRanking: sourceAccounted,
      observedAt: row?.observedAt ?? row?.observed_at ?? row?.evidence?.observedAt ?? null,
      reason: !verified && row ? safeReason(row.errorReason ?? row.error_reason) : !verified ? "Baseline scope has not been collected" : null,
      makers: makerDetails });
  }
  const missingExamples = details.flatMap((scope) => {
    if (scope.baselineStatus !== "verified") return [{ state: scope.state, rto: scope.rto, fuelGroup: scope.fuelGroup, vehicleCategory: scope.vehicleCategory, reason: scope.reason }];
    if (mode === "daily") return scope.makers.filter((maker) => maker.status !== "verified").map((maker) => ({ state: scope.state, rto: scope.rto, fuelGroup: scope.fuelGroup, vehicleCategory: scope.vehicleCategory, makerId: maker.id, maker: maker.name, reason: maker.reason ?? "No verified observation on this IST date" }));
    return scope.rankingComplete || scope.sourceAccountedRanking ? [] : [{ state: scope.state, rto: scope.rto, fuelGroup: scope.fuelGroup, vehicleCategory: scope.vehicleCategory, reason: "Fewer than five verified named OEMs with an unaccounted source total" }];
  }).slice(0, 12);
  const complete = verifiedScopes === 600 && completeRankings + sourceAccountedRankings === 600 && (mode === "baseline" || selectedMakers === verifiedMakers);
  return { contract: "oem-tracking-collection-audit-v1", mode, baselineId: baseline?.id ?? null, selectionYear: baseline?.selectionYear ?? baseline?.selection_year ?? 2025,
    observationDate: mode === "daily" ? date : null, startedAt, finishedAt, runtimeSeconds: Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000), requestCount,
    status: stopReason ? "partial" : complete ? "success" : (verifiedScopes ? "partial" : "failed"), stopReason,
    expectedRtos: 100, expectedScopes: 600, maximumMakerSlots: 3000, verifiedScopes, completeRankings, sourceAccountedRankings, selectedMakers, verifiedMakers,
    missingMakerObservations: mode === "daily" ? selectedMakers - verifiedMakers : null, missingExamples, scopes: details };
}

export async function runOemTrackingCollection(options, deps) {
  const now = deps.now ?? Date.now;
  const wait = deps.sleep ?? sleep;
  const startedAt = dateIso(now);
  const deadline = now() + options.timeBudgetMinutes * 60_000;
  const log = deps.log ?? console.log;
  const store = deps.store;
  let baseline;
  let run;
  let release;
  let date;
  let lastRequest = null;
  let requestCount = 0;
  let refreshedScopes = 0;
  const refreshFailures = [];
  let stopReason = null;
  const unavailableCatalogRtos = new Set();
  const recordCatalogFailure = (context, reason) => {
    if (!missingCatalogRoute(reason)) return;
    unavailableCatalogRtos.add(JSON.stringify([context.state, context.rto]));
    // A sparse scope may genuinely return 404. A catalog failure across three
    // distinct offices is stronger evidence that the shared mapping route is down.
    if (unavailableCatalogRtos.size >= 3) throw new CollectionStopped("Shared source catalog returned HTTP 404/410 across three distinct RTOs. Remaining scopes were deferred; individual chart/count failures do not trigger this stop.");
  };
  const checkBudget = () => {
    try { release?.assertHeld?.(); }
    catch { throw new CollectionStopped("Shared VAHAN scrape lock was lost; verified entries were checkpointed. Restart collection to acquire a new lock."); }
    if (now() >= deadline) throw new CollectionStopped("Collection time budget exhausted; verified entries were checkpointed.");
    if (options.mode === "daily" && date && dateKey(now) !== date) throw new CollectionStopped("IST date changed; later responses were not backdated. Next daily run uses the new date.");
  };
  const beforeRequest = async () => {
    checkBudget();
    if (lastRequest !== null) await wait(Math.max(0, lastRequest + Math.max(1200, deps.delayMs ?? 1200) - now()));
    checkBudget();
    lastRequest = now();
    requestCount += 1;
  };
  try {
    if (options.mode === "daily" && options.automatic && !await store.getActiveOemBaseline()) {
      const audit = trackingCoverageAudit({ mode: "daily", date: dateKey(now), startedAt, finishedAt: dateIso(now) });
      audit.status = "skipped";
      audit.skipReason = "No active 2025 OEM baseline; waiting for explicit manual baseline collection.";
      log(`OEM daily skipped: ${audit.skipReason}`);
      return { audit, exitCode: 0 };
    }
    release = await deps.acquireLock(`oem-tracking-${options.mode}`, { guardLoss: true, waitMs: Math.min(15 * 60_000, Math.max(0, deadline - now())) });
    checkBudget();
    date = dateKey(now);
    if (options.mode === "baseline") {
      if (options.resumeBaselineId) {
        baseline = await store.getOemBaseline({ baselineId: options.resumeBaselineId });
        if (!baseline) throw new Error("Requested baseline does not exist.");
        if (Number(baseline.selectionYear ?? baseline.selection_year) !== options.selectionYear) throw new Error("Resumed baseline must use selection year 2025.");
      } else {
        const sourceRunId = options.cohortRunId ?? await deps.latestCohortRunId();
        if (!Number.isSafeInteger(Number(sourceRunId)) || Number(sourceRunId) < 1) throw new Error("No complete 100-RTO source cohort is available.");
        const cohort = validateRtoDailyLoadTestCohort(await deps.loadCohort(Number(sourceRunId)));
        baseline = await store.createOemBaseline({ sourceCohortRunId: Number(sourceRunId), cohort, selectionYear: options.selectionYear });
      }
    } else {
      baseline = options.baselineId ? await store.getOemBaseline({ baselineId: options.baselineId }) : await store.getActiveOemBaseline();
      if (!baseline) throw new Error("No established OEM baseline. Run the explicit manual 2025 baseline collection first.");
      if (options.baselineId && !(baseline.active ?? baseline.is_active)) throw new Error("Daily collection requires the active baseline; historical selections cannot be overwritten.");
      if (Number(baseline.selectionYear ?? baseline.selection_year) !== 2025) throw new Error("Daily collection requires the established 2025 OEM selection.");
    }
    const cohort = validateRtoDailyLoadTestCohort(baseline.cohort);
    const selected = selectMembers(cohort, options);
    log(`OEM ${options.mode}: baseline ${baseline.id}, selected ${selected.length}/100 RTOs, selection year 2025${options.mode === "daily" ? `, observed ${date}` : ""}`);
    if (options.mode === "baseline") {
      const saved = await store.getOemBaselineScopes({ baselineId: baseline.id });
      const completed = new Set(saved.filter((row) => statusOf(row) === "verified").map(scopeKey));
      for (const member of selected) for (const fuelGroup of ["EV", "ICE"]) for (const vehicleCategory of ["2W", "3W", "4W"]) {
        const context = { baselineId: baseline.id, state: member.state, rto: member.rto, fuelGroup, vehicleCategory };
        if (completed.has(scopeKey(context))) continue;
        checkBudget();
        let evidence;
        let failureEvidence;
        let errorReason;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            evidence = await deps.fetchBaseline({ ...member, year: options.selectionYear, ...RTO_DAILY_CATEGORY_FILTERS[vehicleCategory], fuels: RTO_DAILY_FUEL_FILTERS[fuelGroup], beforeRequest, maxRequestAttempts: 1 });
            errorReason = null;
            break;
          } catch (error) {
            if (error instanceof CollectionStopped) throw error;
            errorReason = safeReason(error.message);
            failureEvidence = error.trackingEvidence ?? error.annualEvidence;
            // Persist failures too so an interrupted run has a precise retry and coverage record.
            await store.saveOemBaselineScope({ ...context, failureEvidence, errorReason });
            if (attempt < 3) { await wait(attempt * 2000); checkBudget(); }
          }
        }
        // Baseline historical selection is distinct from its true collection timestamp.
        await store.saveOemBaselineScope({ ...context, evidence, failureEvidence, errorReason });
        // Named mappings between failures demonstrate usable catalog evidence.
        // Explicit-zero scopes do not consult the maker catalog and cannot reset it.
        if (evidence?.makers?.length) unavailableCatalogRtos.clear();
        if (!evidence) recordCatalogFailure(context, errorReason);
        checkBudget();
        log(`${member.rto} ${fuelGroup}/${vehicleCategory}: ${evidence ? `${evidence.makers.length} saved OEMs` : `Unavailable: ${errorReason}`}`);
      }
    } else {
      run = await store.createOemDailyRun({ baselineId: baseline.id, date });
      const selectedKeys = new Set(selected.map((row) => JSON.stringify([row.state, row.rto])));
      const groups = new Map();
      for (const row of await store.getOemDailyPending({ baselineId: baseline.id, date, refresh:options.refresh })) {
        if (!selectedKeys.has(JSON.stringify([row.state, row.rto]))) continue;
        const key = scopeKey(row);
        if (!groups.has(key)) groups.set(key, { state: row.state, rto: row.rto, fuelGroup: row.fuelGroup ?? row.fuel_group, vehicleCategory: row.vehicleCategory ?? row.vehicle_category, makers: [] });
        groups.get(key).makers.push({ id: String(row.makerId ?? row.maker_id ?? row.id), name: row.makerName ?? row.maker_name ?? row.name });
      }
      for (const group of groups.values()) {
        if (options.refresh) {
          let saved = false;
          let refreshReason;
          for (let attempt=1;attempt<=3 && !saved;attempt++) {
            checkBudget();
            try {
              const results = (await deps.fetchTracked({state:group.state,rto:group.rto,year:Number(date.slice(0,4)),makers:group.makers,
                ...RTO_DAILY_CATEGORY_FILTERS[group.vehicleCategory],fuels:RTO_DAILY_FUEL_FILTERS[group.fuelGroup],beforeRequest,maxRequestAttempts:1})).makers;
              checkBudget();
              const result = await store.saveOemDailyScopeRefresh({runId:run.id,baselineId:baseline.id,...group,date,results});
              saved = result.saved;
              refreshReason = result.reason;
            } catch (error) {
              if (error instanceof CollectionStopped || error?.code === 'OEM_COLLECTION_STOPPED' || error?.code === 'VAHAN_SCRAPE_LOCK_LOST') throw error;
              refreshReason = safeReason(error.message);
              await store.saveOemDailyScopeRefresh({runId:run.id,baselineId:baseline.id,...group,date,results:[],errorReason:refreshReason});
            }
            if (!saved && attempt<3) {await wait(attempt*2000);checkBudget();}
          }
          if (saved) refreshedScopes++;
          else refreshFailures.push({...group,makers:undefined,reason:refreshReason});
          if (!saved && missingCatalogRoute(refreshReason)) recordCatalogFailure(group,refreshReason);
          if (saved) unavailableCatalogRtos.clear();
          log(`${group.rto} ${group.fuelGroup}/${group.vehicleCategory}: ${saved?'refreshed; prior observations preserved':`refresh failed; saved counts retained: ${refreshReason}`}`);
          continue;
        }
        let pending = group.makers;
        let catalogUnavailable = false;
        for (let attempt = 1; attempt <= 3 && pending.length; attempt += 1) {
          checkBudget();
          let results;
          try {
            results = (await deps.fetchTracked({ state: group.state, rto: group.rto, year: Number(date.slice(0, 4)), makers: pending, ...RTO_DAILY_CATEGORY_FILTERS[group.vehicleCategory], fuels: RTO_DAILY_FUEL_FILTERS[group.fuelGroup], beforeRequest, maxRequestAttempts: 1 })).makers;
          } catch (error) {
            if (error instanceof CollectionStopped || error?.code === "OEM_COLLECTION_STOPPED") {
              // A later fallback request can hit the budget/date boundary after
              // earlier makers already produced verified responses. Preserve
              // those responses under their own actual observation date.
              const requested = new Set(pending.map((maker) => maker.id));
              for (const result of error.trackingResults ?? []) {
                const makerId = String(result.id);
                const observedAt = result.evidence?.observedAt;
                if (result.status !== "verified" || !requested.has(makerId) || !Number.isFinite(Date.parse(observedAt))
                  || snapshotDateKey(new Date(observedAt), "Asia/Kolkata") !== date) continue;
                await store.saveOemDailyObservation({ runId: run.id, baselineId: baseline.id, state: group.state, rto: group.rto,
                  fuelGroup: group.fuelGroup, vehicleCategory: group.vehicleCategory, makerId, date, evidence: result.evidence });
                requested.delete(makerId);
              }
              throw error;
            }
            results = pending.map((maker) => ({ ...maker, status: "unavailable", reason: safeReason(error.message), failureEvidence: error.trackingEvidence }));
          }
          // No response may be filed against yesterday if a request crosses midnight in India.
          if (dateKey(now) !== date) checkBudget();
          const returned = new Map((results ?? []).map((row) => [String(row.id), row]));
          const retry = [];
          let missingCatalogs = 0;
          for (const maker of pending) {
            const result = returned.get(maker.id);
            const evidence = result?.status === "verified" ? result.evidence : null;
            const reason = evidence ? null : safeReason(result?.reason ?? "Source did not return verified evidence for this saved OEM");
            if (missingCatalogRoute(reason)) missingCatalogs += 1;
            await store.saveOemDailyObservation({ runId: run.id, baselineId: baseline.id, state: group.state, rto: group.rto, fuelGroup: group.fuelGroup, vehicleCategory: group.vehicleCategory,
              makerId: maker.id, date, evidence, failureEvidence: result?.failureEvidence, errorReason: reason });
            if (!evidence) retry.push(maker);
          }
          pending = retry;
          catalogUnavailable = pending.length > 0 && missingCatalogs === pending.length;
          checkBudget();
          if (pending.length && attempt < 3) { await wait(attempt * 2000); checkBudget(); }
        }
        if (catalogUnavailable && pending.length) recordCatalogFailure(group, "Shared source catalog returned HTTP 404.");
        log(`${group.rto} ${group.fuelGroup}/${group.vehicleCategory}: ${group.makers.length - pending.length}/${group.makers.length} pending OEMs verified`);
      }
    }
  } catch (error) {
    stopReason = safeReason(error.message);
    log(`OEM collection stopped: ${stopReason}`);
  }
  let audit;
  try {
    if (refreshFailures.length) stopReason ??= `${refreshFailures.length} OEM scope refreshes failed; previous verified counts retained.`;
    // Outages and budget/date stops must not suspend evidence retention.
    if (run) {
      try { await store.pruneOemTrackingEvidence({ date }); }
      catch (error) { stopReason ??= `Evidence retention cleanup failed: ${safeReason(error.message)}`; }
    }
    const scopes = baseline ? await store.getOemBaselineScopes({ baselineId: baseline.id }) : [];
    const observations = baseline && options.mode === "daily" ? await store.listOemDailyObservations({ baselineId: baseline.id, date }) : [];
    audit = trackingCoverageAudit({ baseline, scopes, observations, mode: options.mode, date, startedAt, finishedAt: dateIso(now), requestCount, stopReason });
    audit.refresh = Boolean(options.refresh);
    audit.refreshedScopes = refreshedScopes;
    audit.refreshFailures = refreshFailures;
    if (!baseline) audit.status = "failed";
    if (run) await store.finishOemDailyRun({ runId: run.id, status: audit.status, errorReason: stopReason });
    if (baseline && options.mode === "baseline") await store.finishOemBaseline({ baselineId: baseline.id, status: audit.status,
      activate: !stopReason && !options.rto && !options.limit && audit.verifiedScopes > 0 });
    log(`OEM ${options.mode}: ${audit.status}, ${audit.verifiedScopes}/600 baseline scopes, ${audit.completeRankings}/600 complete rankings${options.mode === "daily" ? `, ${audit.verifiedMakers}/${audit.selectedMakers} saved OEM observations` : ""}, ${requestCount} requests`);
  } finally { await release?.(); }
  return { audit, exitCode: audit.status === "success" ? 0 : 1 };
}

async function main() {
  const options = parseTrackingArguments(process.argv.slice(2));
  if (options.help) { console.log(HELP); return; }
  process.env.DATABASE_URL = trackingDatabaseUrl(process.env, options.production);
  const [{ query, closePool }, { acquireVahanScrapeLock }, store, source] = await Promise.all([
    import("../lib/db.mjs"), import("../lib/vahan-scrape-lock.mjs"), import("../lib/rto-oem-tracking.mjs"), import("../lib/rto-oem-tracking-source.mjs"),
  ]);
  try {
    const result = await runOemTrackingCollection(options, { store, acquireLock: acquireVahanScrapeLock,
      fetchBaseline: source.fetchOemTrackingBaselineSegment, fetchTracked: source.fetchTrackedOemSegment,
      delayMs: Number(process.env.RTO_DAILY_DELAY_MS) || 1200,
      latestCohortRunId: async () => (await query("select run_id from rto_daily_run_cohort_members group by run_id having count(*)=100 order by run_id desc limit 1")).rows[0]?.run_id,
      loadCohort: async (id) => (await query("select state,rto,cohort_rank as rank from rto_daily_run_cohort_members where run_id=$1 order by cohort_rank", [id])).rows,
    });
    const output = path.resolve(options.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(result.audit, null, 2)}\n`);
    console.log(`Sanitized OEM coverage audit: ${output}`);
    process.exitCode = result.exitCode;
  } finally { await closePool(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { console.error(safeReason(error.message)); process.exitCode = 1; });
