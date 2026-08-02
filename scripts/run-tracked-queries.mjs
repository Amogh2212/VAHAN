import process from "node:process";
import { closePool } from "../lib/db.mjs";
import { queryData, waitForQueryRefresh } from "../lib/query-engine.mjs";
import { acquireVahanScrapeLock } from "../lib/vahan-scrape-lock.mjs";
import {
  completeTrackedQueryRun,
  createTrackedQueryRun,
  failStaleRunningTrackedQueryRuns,
  failTrackedQueryRun,
  listDueTrackedQueries,
  upsertTrackedQueryObservation,
} from "../lib/tracked-queries.mjs";

const DEFAULT_TIMEOUT_MS = Number(process.env.TRACKED_QUERY_RUN_TIMEOUT_MS ?? 300_000);
const DEFAULT_BACKFILL_DAYS = Number(process.env.TRACKED_QUERY_BACKFILL_DAYS ?? 0);
const DEFAULT_STALE_RUN_MINUTES = Number(process.env.TRACKED_QUERY_STALE_RUN_MINUTES ?? 90);
const STORABLE_DATA_STATUSES = new Set(["complete", "live", "stale"]);
const DEFAULT_FAIL_ON_PARTIAL = !["0", "false", "no"].includes(
  String(process.env.TRACKED_QUERY_FAIL_ON_PARTIAL ?? "1").toLowerCase(),
);

function parseArgs(argv) {
  const args = {
    dryRun: false,
    date: null,
    all: false,
    backfillDays: DEFAULT_BACKFILL_DAYS,
    failOnPartial: DEFAULT_FAIL_ON_PARTIAL,
    queryIds: [],
    staleRunMinutes: DEFAULT_STALE_RUN_MINUTES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--all") args.all = true;
    else if (arg === "--fail-on-partial") args.failOnPartial = true;
    else if (arg === "--no-fail-on-partial") args.failOnPartial = false;
    else if (arg === "--id" || arg === "--query-id") args.queryIds.push(argv[++index] ?? "");
    else if (arg.startsWith("--id=")) args.queryIds.push(arg.slice("--id=".length));
    else if (arg.startsWith("--query-id=")) args.queryIds.push(arg.slice("--query-id=".length));
    else if (arg === "--stale-run-minutes") args.staleRunMinutes = argv[++index] ?? null;
    else if (arg.startsWith("--stale-run-minutes=")) args.staleRunMinutes = arg.slice("--stale-run-minutes=".length);
    else if (arg === "--backfill-days") args.backfillDays = argv[++index] ?? null;
    else if (arg.startsWith("--backfill-days=")) args.backfillDays = arg.slice("--backfill-days=".length);
    else if (arg === "--date") args.date = argv[++index] ?? null;
    else if (arg.startsWith("--date=")) args.date = arg.slice("--date=".length);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error("--date must use YYYY-MM-DD format.");
  }
  args.backfillDays = Math.max(0, Math.floor(Number(args.backfillDays) || 0));
  args.queryIds = [...new Set(args.queryIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  args.staleRunMinutes = Math.max(0, Math.floor(Number(args.staleRunMinutes) || 0));
  if (args.date) args.backfillDays = 0;

  return args;
}

function usage() {
  return [
    "Usage: node --env-file=.env scripts/run-tracked-queries.mjs [options]",
    "",
    "Options:",
    "  --dry-run          Print due tracked queries without writing runs or observations.",
    "  --date YYYY-MM-DD  Store observations for a specific local date.",
    "  --id N             Run only one tracked query id. Repeat for multiple ids.",
    "  --all              Include queries that already have an observation for the date.",
    "  --backfill-days N  Also run missing observations from the previous N local days.",
    "  --stale-run-minutes N  Fail running rows older than N minutes before starting. 0 disables cleanup.",
    "  --no-fail-on-partial  Exit 0 when at least one query succeeds but others fail.",
    "  --fail-on-partial     Exit 1 when any query fails. Default unless TRACKED_QUERY_FAIL_ON_PARTIAL=0.",
  ].join("\n");
}

async function finalPayload(payload) {
  if (payload?.liveRefresh?.status === "pending" && payload.liveRefresh.jobId) {
    return waitForQueryRefresh(payload.liveRefresh.jobId, { timeoutMs: DEFAULT_TIMEOUT_MS });
  }
  return payload;
}

function observationPayload(payload) {
  const total = payload?.summary?.total;
  if (!Number.isFinite(Number(total))) {
    throw new Error("Query did not return a numeric summary.total.");
  }
  const dataStatus = payload.dataStatus ?? null;
  if (!STORABLE_DATA_STATUSES.has(dataStatus)) {
    const warnings = (payload.warnings ?? []).filter(Boolean).join(" ");
    throw new Error([
      `Tracked query returned non-storable data_status "${dataStatus ?? "unknown"}"; observation was not stored.`,
      warnings,
    ].filter(Boolean).join(" "));
  }
  return {
    total: Number(total),
    filters: payload.filters ?? {},
    summary: payload.summary ?? {},
    dataStatus,
    warnings: payload.warnings ?? [],
    freshness: payload.freshness ?? {},
  };
}

function monthRangeForObservationDate(value) {
  const month = String(value ?? "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Observation date must use YYYY-MM-DD format.");
  }
  return {
    from: month,
    to: month,
    reason: "No date was provided in the saved query, so the daily tracker used the observation month",
  };
}

async function runTrackedQuery(item) {
  const defaultDateRange = monthRangeForObservationDate(item.observationDate);
  const run = await createTrackedQueryRun(item.id, item.observationDate, {
    query: item.query,
    label: item.label,
    defaultDateRange,
  });

  let payload = null;
  try {
    payload = await finalPayload(await queryData({
      query: item.query,
      defaultDateRange,
    }));
    const observation = await upsertTrackedQueryObservation(
      item.id,
      item.observationDate,
      observationPayload(payload),
    );
    await completeTrackedQueryRun(run.id, {
      query: item.query,
      label: item.label,
      defaultDateRange,
      dataStatus: payload.dataStatus ?? null,
      liveRefresh: payload.liveRefresh ?? null,
      scraper: payload.scraper ?? null,
      observationId: observation.id,
    });
    return {
      trackedQueryId: item.id,
      label: item.label,
      query: item.query,
      observation,
      status: "success",
    };
  } catch (error) {
    await failTrackedQueryRun(run.id, error, {
      query: item.query,
      label: item.label,
      defaultDateRange,
      dataStatus: payload?.dataStatus ?? null,
      liveRefresh: payload?.liveRefresh ?? null,
      scraper: payload?.scraper ?? null,
    });
    return {
      trackedQueryId: item.id,
      label: item.label,
      query: item.query,
      status: "failed",
      error: error.message,
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  let due = await listDueTrackedQueries({
    date: args.date,
    includeAlreadyObserved: args.all,
    backfillDays: args.backfillDays,
  });
  if (args.queryIds.length) {
    const idSet = new Set(args.queryIds);
    due = due.filter((item) => idSet.has(item.id));
  }

  if (args.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      count: due.length,
      queryIds: args.queryIds,
      trackedQueries: due.map((item) => ({
        id: item.id,
        label: item.label,
        query: item.query,
        observationDate: item.observationDate,
        runTimeLocal: item.runTimeLocal,
        timezone: item.timezone,
        defaultMonth: String(item.observationDate).slice(0, 7),
      })),
      backfillDays: args.backfillDays,
      staleRunMinutes: args.staleRunMinutes,
    }, null, 2));
    return;
  }

  if (args.staleRunMinutes > 0) {
    const cutoff = new Date(Date.now() - args.staleRunMinutes * 60 * 1000);
    const staleRuns = await failStaleRunningTrackedQueryRuns({
      before: cutoff,
      error: `Tracked query run exceeded ${args.staleRunMinutes} minute stale-run timeout before a later runner started.`,
    });
    if (staleRuns.length) {
      console.warn(`[tracked] marked ${staleRuns.length} stale running run(s) as failed`);
    }
  }

  const releaseLock = await acquireVahanScrapeLock("tracked-queries");
  const results = [];
  try {
    for (const item of due) {
      console.log(`[tracked] ${item.id} ${item.label ?? item.query} (${item.observationDate})`);
      results.push(await runTrackedQuery(item));
    }
  } finally {
    await releaseLock();
  }

  const failed = results.filter((item) => item.status === "failed").length;
  console.log(JSON.stringify({
    status: failed ? "partial" : "success",
    count: results.length,
    failed,
    results,
  }, null, 2));

  if (failed && (args.failOnPartial || failed === results.length)) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
