import process from "node:process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { closePool, query } from "../lib/db.mjs";
import {
  OSM_SIGNAL_DEFINITIONS,
  RTO_INSIGHT_DEFAULT_RADIUS_KM,
  RTO_INSIGHT_PROVIDER_OSM,
  buildOverpassQuery,
  geocodeQueriesForRto,
  getRtoGeoProfile,
  summarizeOsmSignal,
  upsertRtoExternalSignal,
  upsertRtoGeoProfile,
} from "../lib/rto-insights.mjs";
import { listRtoDailyRtos } from "../lib/rto-daily-snapshots.mjs";

const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const DEFAULT_WORKERS = 2;
const MAX_WORKERS = 3;
const DEFAULT_MAX_AGE_HOURS = 24;
const DEFAULT_FALLOUT_CYCLES = 5;
const DEFAULT_SLEEP_MS = 3000;
const DEFAULT_RETRIES = 5;
const DEFAULT_RETRY_JITTER_MS = 1000;

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  await runImport(args);
}

export async function runImport(args) {
  const dryRun = !args.write;
  const userAgent = args.userAgent || process.env.OSM_USER_AGENT || "VahanEY-RtoInsights/0.1";
  const radii = args.radiusKm.length ? args.radiusKm : [RTO_INSIGHT_DEFAULT_RADIUS_KM];
  const selectedSignals = selectSignals(args.signals);
  const signalByKey = new Map(selectedSignals.map((definition) => [definition.key, definition]));
  const freshnessCutoff = freshnessCutoffForImport(args);
  const rtos = await listRtoDailyRtos({ state: args.state || null });
  const filtered = rtos
    .filter((item) => !args.rto || item.rto.toLowerCase().includes(args.rto.toLowerCase()))
    .slice(args.skip)
    .slice(0, args.limit);

  if (!filtered.length) {
    console.log("No enabled daily RTO configs matched the OSM import filters.");
    return;
  }

  const stateGroups = groupTargetsByState(filtered);
  const requestThrottle = createRequestThrottle(args.sleepMs);
  const stats = createImportStats();
  const fallout = createFalloutTracker({ args, dryRun, filtered, selectedSignals, radii });

  console.log(`[rto-insights:osm] ${dryRun ? "dry-run" : "write"} mode for ${filtered.length} RTO(s), ${stateGroups.length} state(s), ${selectedSignals.length} signal(s), radii ${radii.join(",")} km, workers=${args.workers}, falloutCycles=${args.falloutCycles}`);
  if (freshnessCutoff) console.log(`[rto-insights:osm] skip fresh signals fetched since ${freshnessCutoff.toISOString()} (--max-age-hours ${args.maxAgeHours})`);
  if (args.refresh) console.log("[rto-insights:osm] refresh mode: timestamp freshness skips disabled");

  console.log(`[rto-insights:osm] cycle 1/${args.falloutCycles} starting full pass`);
  await runStateWorkers({
    stateGroups,
    args,
    dryRun,
    userAgent,
    radii,
    selectedSignals,
    freshnessCutoff,
    requestThrottle,
    stats,
    fallout,
    cycle: 1,
  });
  console.log(`[rto-insights:osm] cycle 1/${args.falloutCycles} complete written=${stats.written} freshSkipped=${stats.freshSkipped} skipped=${stats.skipped} failed=${fallout.failedItems.size}`);

  for (let cycle = 2; cycle <= args.falloutCycles && fallout.failedItems.size; cycle += 1) {
    const retryItems = fallout.retryItems();
    const retryStats = createImportStats();
    const retryWorkers = Math.min(args.workers, 2);
    console.log(`[rto-insights:osm] cycle ${cycle}/${args.falloutCycles} retrying ${retryItems.length} failed item(s) with workers=${retryWorkers}`);
    await runItemWorkers({
      items: retryItems,
      args: { ...args, workers: retryWorkers },
      dryRun,
      userAgent,
      signalByKey,
      freshnessCutoff,
      requestThrottle,
      stats: retryStats,
      fallout,
      cycle,
    });
    addImportStats(stats, retryStats);
    console.log(`[rto-insights:osm] cycle ${cycle}/${args.falloutCycles} complete written=${retryStats.written} freshSkipped=${retryStats.freshSkipped} skipped=${retryStats.skipped} remainingFailed=${fallout.failedItems.size}`);
  }

  const report = buildFalloutReport({ args, dryRun, stats, fallout });
  if (!dryRun && args.falloutCycles > 1 && (report.remainingFailures.length || report.skippedItems.length)) {
    const reportPath = await writeFalloutReport(report, args.reportFile);
    console.log(`[rto-insights:osm] fallout report saved to ${reportPath}`);
  }

  console.log(`[rto-insights:osm] done. workers=${args.workers} written=${stats.written} skipped=${stats.skipped} freshSkipped=${stats.freshSkipped} failedAttempts=${stats.failed} remainingFailed=${report.remainingFailures.length} dryRun=${dryRun}`);
  return stats;
}

async function runStateWorkers({ stateGroups, args, dryRun, userAgent, radii, selectedSignals, freshnessCutoff, requestThrottle, stats, fallout, cycle }) {
  const queue = createStateQueue(stateGroups);
  await Promise.all(Array.from({ length: args.workers }, (_, index) =>
    stateWorker({
      workerId: `worker-${index + 1}`,
      queue,
      args,
      dryRun,
      userAgent,
      radii,
      selectedSignals,
      freshnessCutoff,
      requestThrottle,
      stats,
      fallout,
      cycle,
    })));
}

async function stateWorker({ workerId, queue, args, dryRun, userAgent, radii, selectedSignals, freshnessCutoff, requestThrottle, stats, fallout, cycle }) {
  while (true) {
    const group = queue.claim();
    if (!group) return;
    const stateStats = createImportStats();
    console.log(`[rto-insights:osm] ${workerId} claimed ${group.state}, ${group.targets.length} RTO(s)`);

    for (let index = 0; index < group.targets.length; index += 1) {
      const delta = await processTarget(group.targets[index], {
        workerId,
        args,
        dryRun,
        userAgent,
        radii,
        selectedSignals,
        freshnessCutoff,
        requestThrottle,
        fallout,
        cycle,
      });
      addImportStats(stateStats, delta);
      addImportStats(stats, delta);
      console.log(`[rto-insights:osm] ${workerId} ${group.state} ${index + 1}/${group.targets.length} saved=${stateStats.written} freshSkipped=${stateStats.freshSkipped} failed=${stateStats.failed}`);
    }
  }
}

async function processTarget(target, { workerId, args, dryRun, userAgent, radii, selectedSignals, freshnessCutoff, requestThrottle, fallout, cycle }) {
  const stats = createImportStats();
  const profile = await resolveGeoProfile(target, { shouldGeocode: args.geocode, userAgent, dryRun, nominatimUrl: args.nominatimUrl });
  if (!profile?.latitude || !profile?.longitude) {
    stats.skipped += 1;
    const reason = args.geocode ? "missing_centroid_after_geocode" : "missing_centroid";
    fallout?.recordSkipped({ target, reason, cycle });
    console.log(`[rto-insights:osm] ${workerId} skip ${target.state} / ${target.rto}: no cached centroid${args.geocode ? " and geocode failed" : ""}`);
    return stats;
  }

  for (const radiusKm of radii) {
    for (const definition of selectedSignals) {
      addImportStats(stats, await processSignalItem({
        workerId,
        target,
        profile,
        definition,
        radiusKm,
        args,
        dryRun,
        userAgent,
        freshnessCutoff,
        requestThrottle,
        fallout,
        cycle,
      }));
    }
  }
  return stats;
}

async function runItemWorkers({ items, args, dryRun, userAgent, signalByKey, freshnessCutoff, requestThrottle, stats, fallout, cycle }) {
  const queue = createItemQueue(items);
  await Promise.all(Array.from({ length: args.workers }, (_, index) =>
    itemWorker({
      workerId: `worker-${index + 1}`,
      queue,
      args,
      dryRun,
      userAgent,
      signalByKey,
      freshnessCutoff,
      requestThrottle,
      stats,
      fallout,
      cycle,
    })));
}

async function itemWorker({ workerId, queue, args, dryRun, userAgent, signalByKey, freshnessCutoff, requestThrottle, stats, fallout, cycle }) {
  while (true) {
    const item = queue.claim();
    if (!item) return;
    const definition = signalByKey.get(item.signalKey);
    if (!definition) {
      fallout.recordFailure({ item, error: new Error(`Unknown signal for retry: ${item.signalKey}`), cycle });
      continue;
    }
    const target = { state: item.state, rto: item.rto };
    const profile = await resolveGeoProfile(target, { shouldGeocode: args.geocode, userAgent, dryRun, nominatimUrl: args.nominatimUrl });
    if (!profile?.latitude || !profile?.longitude) {
      const delta = createImportStats();
      delta.skipped += 1;
      addImportStats(stats, delta);
      fallout.clearFailure(item);
      fallout.recordSkipped({ target, reason: args.geocode ? "missing_centroid_after_geocode" : "missing_centroid", cycle });
      console.log(`[rto-insights:osm] ${workerId} retry skip ${target.state} / ${target.rto}: no cached centroid${args.geocode ? " and geocode failed" : ""}`);
      continue;
    }
    addImportStats(stats, await processSignalItem({
      workerId,
      target,
      profile,
      definition,
      radiusKm: item.radiusKm,
      args,
      dryRun,
      userAgent,
      freshnessCutoff,
      requestThrottle,
      fallout,
      cycle,
      retry: true,
    }));
  }
}

async function processSignalItem({ workerId, target, profile, definition, radiusKm, args, dryRun, userAgent, freshnessCutoff, requestThrottle, fallout, cycle, retry = false }) {
  const stats = createImportStats();
  const item = signalItem({ target, definition, radiusKm });
  if (freshnessCutoff) {
    const fresh = await findFreshSignal({
      state: target.state,
      rto: target.rto,
      signalKey: definition.key,
      radiusKm,
      fetchedSince: freshnessCutoff,
    });
    if (fresh) {
      stats.freshSkipped += 1;
      fallout?.clearFailure(item);
      console.log(`[rto-insights:osm] ${workerId} skip fresh ${definition.key} for ${target.state} / ${target.rto} @ ${radiusKm} km fetched_at=${fresh.fetched_at.toISOString?.() ?? fresh.fetched_at}`);
      return stats;
    }
  }

  const overpassQuery = buildOverpassQuery({
    signalKey: definition.key,
    latitude: profile.latitude,
    longitude: profile.longitude,
    radiusKm,
    timeoutSeconds: args.timeoutSeconds,
  });

  if (dryRun) {
    console.log(`[rto-insights:osm] ${workerId} would fetch ${definition.key} for ${target.state} / ${target.rto} @ ${radiusKm} km`);
    console.log(overpassQuery);
    return stats;
  }

  try {
    const body = await fetchOverpassWithRetry(overpassQuery, {
      overpassUrl: args.overpassUrl,
      userAgent,
      timeoutSeconds: args.timeoutSeconds,
      retries: args.retries,
      sleepMs: args.sleepMs,
      beforeFetch: requestThrottle,
    });
    const summary = summarizeOsmSignal(definition.key, body.elements ?? []);
    await upsertRtoExternalSignal({
      state: target.state,
      rto: target.rto,
      provider: RTO_INSIGHT_PROVIDER_OSM,
      radiusKm,
      sourceUrl: args.overpassUrl,
      fetchedAt: new Date().toISOString(),
      ...summary,
      evidence: {
        ...summary.evidence,
        query: overpassQuery,
        attribution: "OpenStreetMap contributors via Overpass API",
      },
    });
    stats.written += 1;
    fallout?.clearFailure(item);
    console.log(`[rto-insights:osm] ${workerId} ${retry ? "retry saved" : "saved"} ${definition.key}=${summary.numericValue} for ${target.state} / ${target.rto} @ ${radiusKm} km`);
  } catch (error) {
    stats.failed += 1;
    fallout?.recordFailure({ item, error, cycle });
    console.log(`[rto-insights:osm] ${workerId} ${retry ? "retry failed" : "failed"} ${definition.key} for ${target.state} / ${target.rto} @ ${radiusKm} km: ${error.message}`);
  }
  return stats;
}

async function findFreshSignal({ state, rto, signalKey, radiusKm, fetchedSince }) {
  const result = await query(
    `
      select fetched_at
      from rto_external_signals
      where state = $1
        and rto = $2
        and provider = $3
        and signal_key = $4
        and radius_km = $5
        and period_start is null
        and period_end is null
        and fetched_at >= $6::timestamptz
      order by fetched_at desc
      limit 1
    `,
    [state, rto, RTO_INSIGHT_PROVIDER_OSM, signalKey, radiusKm, fetchedSince.toISOString()],
  );
  return result.rows[0] ?? null;
}

async function resolveGeoProfile(target, { shouldGeocode, userAgent, dryRun, nominatimUrl }) {
  const existing = await getRtoGeoProfile(target);
  if (existing?.latitude && existing?.longitude) return existing;
  if (!shouldGeocode) return existing;

  const queries = geocodeQueriesForRto(target);
  if (dryRun) {
    console.log(`[rto-insights:osm] would geocode ${target.state} / ${target.rto}: ${queries.join(" | ")}`);
    return existing;
  }

  for (const q of queries) {
    const match = await geocode(q, { userAgent, nominatimUrl });
    if (!match) continue;
    return upsertRtoGeoProfile({
      state: target.state,
      rto: target.rto,
      latitude: Number(match.lat),
      longitude: Number(match.lon),
      confidenceScore: confidenceForNominatim(match),
      source: "nominatim",
      sourceUrl: match.osm_id ? `https://www.openstreetmap.org/${match.osm_type}/${match.osm_id}` : null,
      raw: { query: q, match },
      geocodedAt: new Date().toISOString(),
    });
  }
  return existing;
}

async function geocode(q, { userAgent, nominatimUrl }) {
  const url = new URL(nominatimUrl);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("countrycodes", "in");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`Nominatim failed ${response.status}: ${await response.text()}`);
  const rows = await response.json();
  await sleep(1100);
  return rows[0] ?? null;
}

async function fetchOverpass(overpassQuery, { overpassUrl, userAgent, timeoutSeconds }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(5, timeoutSeconds) * 1000 + 10_000);
  try {
    const response = await fetch(overpassUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": userAgent,
      },
      body: new URLSearchParams({ data: overpassQuery }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`Overpass failed ${response.status}: ${singleLineSnippet(text)}`);
      error.status = response.status;
      error.retryAfterMs = retryAfterHeaderMs(response.headers.get("retry-after"));
      throw error;
    }
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch (cause) {
      const error = new Error(`Overpass returned invalid JSON: ${singleLineSnippet(text || cause.message)}`);
      error.status = 502;
      error.retryable = true;
      error.cause = cause;
      throw error;
    }
    return assertValidOverpassBody(body);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOverpassWithRetry(overpassQuery, options) {
  let attempt = 0;
  while (true) {
    try {
      await options.beforeFetch?.();
      return await fetchOverpass(overpassQuery, options);
    } catch (error) {
      if (attempt >= options.retries || !isRetryableOverpassError(error)) throw error;
      attempt += 1;
      const delayMs = Math.max(overpassRetryDelayMs(attempt, options), retryAfterMsFromError(error));
      console.log(`[rto-insights:osm] retry ${attempt}/${options.retries} after ${delayMs}ms: ${error.message.split("\n")[0]}`);
      await sleep(delayMs);
    }
  }
}

export function overpassRetryDelayMs(attempt, { sleepMs = DEFAULT_SLEEP_MS, retryJitterMs = DEFAULT_RETRY_JITTER_MS, random = Math.random } = {}) {
  const baseDelayMs = Math.max(Number(sleepMs) || DEFAULT_SLEEP_MS, 1000);
  const jitterMs = Math.max(0, Math.floor(Number(retryJitterMs) || 0));
  const jitter = jitterMs ? Math.floor(random() * (jitterMs + 1)) : 0;
  return baseDelayMs * Math.max(1, Math.floor(Number(attempt) || 1)) + jitter;
}

function isRetryableOverpassError(error) {
  return error?.retryable === true || error?.name === "AbortError" || [429, 502, 503, 504].includes(Number(error?.status));
}

export function assertValidOverpassBody(body = {}) {
  const remark = overpassRemarkText(body);
  if (!remark) return body;
  const retryable = isRetryableOverpassRemark(remark);
  const error = new Error(`Overpass returned remark: ${singleLineSnippet(remark)}`);
  error.status = retryable ? 504 : 400;
  error.retryable = retryable;
  throw error;
}

function overpassRemarkText(body = {}) {
  const remark = body?.remark;
  if (Array.isArray(remark)) return remark.join(" ");
  return typeof remark === "string" ? remark.trim() : "";
}

function isRetryableOverpassRemark(remark) {
  const text = String(remark ?? "").toLowerCase();
  return [
    "runtime error",
    "timeout",
    "timed out",
    "rate limit",
    "too many",
    "quota",
    "temporar",
    "server",
    "load",
    "resource",
    "memory",
    "open64",
  ].some((marker) => text.includes(marker));
}

function retryAfterHeaderMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.floor(seconds * 1000));
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
}

function retryAfterMsFromError(error) {
  const delayMs = Number(error?.retryAfterMs);
  return Number.isFinite(delayMs) && delayMs > 0 ? Math.floor(delayMs) : 0;
}

function singleLineSnippet(value, maxLength = 500) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

export function parseArgs(argv) {
  const args = {
    state: null,
    rto: null,
    skip: 0,
    limit: 5,
    radiusKm: [],
    signals: [],
    write: false,
    geocode: false,
    refresh: false,
    workers: DEFAULT_WORKERS,
    falloutCycles: DEFAULT_FALLOUT_CYCLES,
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    reportFile: null,
    overpassUrl: process.env.OVERPASS_URL || DEFAULT_OVERPASS_URL,
    nominatimUrl: process.env.NOMINATIM_URL || DEFAULT_NOMINATIM_URL,
    userAgent: null,
    timeoutSeconds: 60,
    sleepMs: DEFAULT_SLEEP_MS,
    retries: DEFAULT_RETRIES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--write") args.write = true;
    else if (arg === "--geocode") args.geocode = true;
    else if (arg === "--refresh") args.refresh = true;
    else if (arg === "--workers") args.workers = clampWorkerCount(next());
    else if (arg.startsWith("--workers=")) args.workers = clampWorkerCount(arg.slice("--workers=".length));
    else if (arg === "--fallout-cycles") args.falloutCycles = clampFalloutCycles(next());
    else if (arg.startsWith("--fallout-cycles=")) args.falloutCycles = clampFalloutCycles(arg.slice("--fallout-cycles=".length));
    else if (arg === "--report-file") args.reportFile = next();
    else if (arg.startsWith("--report-file=")) args.reportFile = arg.slice("--report-file=".length);
    else if (arg === "--state") args.state = next();
    else if (arg === "--rto") args.rto = next();
    else if (arg === "--skip") args.skip = Math.max(0, Math.floor(Number(next()) || args.skip));
    else if (arg === "--limit") args.limit = Math.max(1, Math.floor(Number(next()) || args.limit));
    else if (arg === "--radius-km") args.radiusKm = splitNumbers(next());
    else if (arg === "--signals") args.signals = splitList(next());
    else if (arg === "--overpass-url") args.overpassUrl = next();
    else if (arg === "--nominatim-url") args.nominatimUrl = next();
    else if (arg === "--user-agent") args.userAgent = next();
    else if (arg === "--timeout-seconds") args.timeoutSeconds = Math.max(5, Math.floor(Number(next()) || args.timeoutSeconds));
    else if (arg === "--sleep-ms") args.sleepMs = Math.max(0, Math.floor(Number(next()) || args.sleepMs));
    else if (arg === "--retries") args.retries = Math.max(0, Math.floor(Number(next()) || args.retries));
    else if (arg === "--max-age-hours") args.maxAgeHours = nonNegativeNumber(next(), args.maxAgeHours);
    else if (arg.startsWith("--max-age-hours=")) args.maxAgeHours = nonNegativeNumber(arg.slice("--max-age-hours=".length), args.maxAgeHours);
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

export function selectSignals(keys = []) {
  if (!keys.length) return OSM_SIGNAL_DEFINITIONS;
  const wanted = new Set(keys);
  const selected = OSM_SIGNAL_DEFINITIONS.filter((definition) => wanted.has(definition.key));
  if (selected.length !== wanted.size) {
    const known = OSM_SIGNAL_DEFINITIONS.map((definition) => definition.key).join(", ");
    throw new Error(`Unknown signal in --signals. Known signals: ${known}`);
  }
  return selected;
}

function splitList(value = "") {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function splitNumbers(value = "") {
  return splitList(value).map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0);
}

export function freshnessCutoffFor(maxAgeHours) {
  const hours = Number(maxAgeHours);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export function freshnessCutoffForImport(args) {
  return args.refresh ? null : freshnessCutoffFor(args.maxAgeHours);
}

export function groupTargetsByState(targets = []) {
  const groups = new Map();
  for (const target of targets) {
    const state = target.state || "Unknown";
    if (!groups.has(state)) groups.set(state, { state, targets: [] });
    groups.get(state).targets.push(target);
  }
  return Array.from(groups.values());
}

function createStateQueue(stateGroups) {
  const queue = [...stateGroups];
  return {
    claim() {
      return queue.shift() ?? null;
    },
  };
}

function createItemQueue(items) {
  const queue = [...items];
  return {
    claim() {
      return queue.shift() ?? null;
    },
  };
}

function createRequestThrottle(delayMs) {
  const delay = Math.max(0, Math.floor(Number(delayMs) || 0));
  if (!delay) return async () => {};
  let tail = Promise.resolve();
  return async function waitForTurn() {
    const ready = tail.catch(() => {});
    tail = ready.then(() => sleep(delay));
    await ready;
  };
}

function createImportStats() {
  return { written: 0, skipped: 0, freshSkipped: 0, failed: 0 };
}

function addImportStats(target, delta) {
  target.written += delta.written;
  target.skipped += delta.skipped;
  target.freshSkipped += delta.freshSkipped;
  target.failed += delta.failed;
  return target;
}

export function clampWorkerCount(value, fallback = DEFAULT_WORKERS) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(Math.floor(number), MAX_WORKERS));
}

export function clampFalloutCycles(value, fallback = DEFAULT_FALLOUT_CYCLES) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(Math.floor(number), DEFAULT_FALLOUT_CYCLES));
}

export function signalItem({ target, definition, radiusKm }) {
  return {
    state: target.state,
    rto: target.rto,
    signalKey: definition.key,
    radiusKm,
  };
}

export function signalItemKey(item) {
  return [item.state, item.rto, item.signalKey, item.radiusKm].join("\u0000");
}

function createFalloutTracker({ args, dryRun, filtered, selectedSignals, radii }) {
  const failedItems = new Map();
  const skippedItems = new Map();
  const attemptsByReason = new Map();
  return {
    args,
    dryRun,
    startedAt: new Date().toISOString(),
    totalRtos: filtered.length,
    totalItems: filtered.length * selectedSignals.length * radii.length,
    failedItems,
    skippedItems,
    attemptsByReason,
    recordFailure({ item, error, cycle }) {
      const key = signalItemKey(item);
      const reason = classifyFailure(error);
      const previous = failedItems.get(key);
      const attempts = (previous?.attempts ?? 0) + 1;
      const failure = {
        ...item,
        attempts,
        firstFailedCycle: previous?.firstFailedCycle ?? cycle,
        lastFailedCycle: cycle,
        reason,
        message: String(error?.message ?? error ?? "Unknown error").slice(0, 1000),
      };
      failedItems.set(key, failure);
      attemptsByReason.set(reason, (attemptsByReason.get(reason) ?? 0) + 1);
    },
    clearFailure(item) {
      failedItems.delete(signalItemKey(item));
    },
    recordSkipped({ target, reason, cycle }) {
      const key = [target.state, target.rto, reason].join("\u0000");
      skippedItems.set(key, {
        state: target.state,
        rto: target.rto,
        reason,
        cycle,
      });
    },
    retryItems() {
      return Array.from(failedItems.values())
        .sort((a, b) => a.state.localeCompare(b.state) || a.rto.localeCompare(b.rto) || a.signalKey.localeCompare(b.signalKey) || a.radiusKm - b.radiusKm);
    },
  };
}

function classifyFailure(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  const status = Number(error?.status);
  if (error?.name === "AbortError" || message.includes("abort") || message.includes("timeout")) return "overpass_timeout";
  if (status === 429 || message.includes("429") || message.includes("rate limit")) return "overpass_rate_limited";
  if ([502, 503, 504].includes(status) || /\b50[234]\b/.test(message)) return "overpass_temporary";
  if (message.includes("json") || message.includes("unexpected token") || message.includes("invalid")) return "invalid_response";
  if (message.includes("database") || message.includes("postgres") || message.includes("pg") || message.includes("duplicate") || message.includes("constraint")) return "db_save_error";
  return "other";
}

export function buildFalloutReport({ args, dryRun, stats, fallout }) {
  return {
    generatedAt: new Date().toISOString(),
    startedAt: fallout.startedAt,
    dryRun,
    maxCycles: args.falloutCycles,
    workers: args.workers,
    maxAgeHours: args.maxAgeHours,
    filters: {
      state: args.state,
      rto: args.rto,
      limit: args.limit,
      skip: args.skip,
      signals: args.signals,
      radiusKm: args.radiusKm,
    },
    totals: {
      rtos: fallout.totalRtos,
      items: fallout.totalItems,
      written: stats.written,
      freshSkipped: stats.freshSkipped,
      skipped: stats.skipped,
      failedAttempts: stats.failed,
      remainingFailures: fallout.failedItems.size,
    },
    failureAttemptsByReason: Object.fromEntries(Array.from(fallout.attemptsByReason.entries()).sort()),
    remainingFailures: fallout.retryItems(),
    skippedItems: Array.from(fallout.skippedItems.values()).sort((a, b) => a.state.localeCompare(b.state) || a.rto.localeCompare(b.rto) || a.reason.localeCompare(b.reason)),
  };
}

async function writeFalloutReport(report, reportFile) {
  const outputPath = reportFile || path.join("reports", `rto-insights-osm-fallout-${safeTimestamp(report.generatedAt)}.json`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}

function safeTimestamp(value) {
  return String(value).replace(/[:.]/g, "-");
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, number);
}

function confidenceForNominatim(match) {
  const importance = Number(match.importance ?? 0);
  const placeRank = Number(match.place_rank ?? 30);
  return Math.max(0.35, Math.min(0.85, 0.35 + importance * 0.35 + Math.max(0, 30 - placeRank) * 0.01));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage:
  node --env-file=.env scripts/import-osm-rto-signals.mjs [options]

Options:
  --write                 Save OSM signal rows. Without this, prints dry-run queries only.
  --geocode               Use Nominatim for missing cached centroids.
  --workers 2             State-affinity workers to run in parallel (1-3, default 2).
  --fallout-cycles 5      Retry failed signal items after the full pass (1-5, default 5).
  --report-file path      Write fallout report to this JSON path when failures/skips remain.
  --state "Uttar Pradesh" Limit enabled RTO configs by state.
  --rto "Noida"           Limit enabled RTO configs by RTO label substring.
  --skip 10               Skip this many matched RTO configs before processing.
  --limit 10              Max RTO configs to process.
  --radius-km 5,10,25     Radius buckets to fetch.
  --signals key,key       OSM signal keys to fetch.
  --max-age-hours 24      Skip signal rows fetched within this many hours (default 24; use 0 to disable).
  --refresh               Ignore --max-age-hours and refetch matching signals.
  --user-agent "..."      Required by OSM/Nominatim policies; prefer one with contact info.
  --sleep-ms 3000         Base delay between Overpass requests and retries.
  --retries 5             Retry temporary Overpass failures before skipping a signal.
`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main()
    .catch((error) => {
      console.error(`[rto-insights:osm] ${error.stack || error.message}`);
      process.exitCode = 1;
    })
    .finally(closePool);
}
