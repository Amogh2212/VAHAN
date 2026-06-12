import process from "node:process";
import { closePool } from "../lib/db.mjs";
import { queryData, waitForQueryRefresh } from "../lib/query-engine.mjs";
import {
  completeTrackedQueryRun,
  createTrackedQueryRun,
  failTrackedQueryRun,
  listDueTrackedQueries,
  upsertTrackedQueryObservation,
} from "../lib/tracked-queries.mjs";

const DEFAULT_TIMEOUT_MS = Number(process.env.TRACKED_QUERY_RUN_TIMEOUT_MS ?? 300_000);
const STORABLE_DATA_STATUSES = new Set(["complete", "live", "stale"]);
const DEFAULT_FAIL_ON_PARTIAL = !["0", "false", "no"].includes(
  String(process.env.TRACKED_QUERY_FAIL_ON_PARTIAL ?? "1").toLowerCase(),
);

function parseArgs(argv) {
  const args = {
    dryRun: false,
    date: null,
    all: false,
    failOnPartial: DEFAULT_FAIL_ON_PARTIAL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--all") args.all = true;
    else if (arg === "--fail-on-partial") args.failOnPartial = true;
    else if (arg === "--no-fail-on-partial") args.failOnPartial = false;
    else if (arg === "--date") args.date = argv[++index] ?? null;
    else if (arg.startsWith("--date=")) args.date = arg.slice("--date=".length);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error("--date must use YYYY-MM-DD format.");
  }

  return args;
}

function usage() {
  return [
    "Usage: node --env-file=.env scripts/run-tracked-queries.mjs [options]",
    "",
    "Options:",
    "  --dry-run          Print due tracked queries without writing runs or observations.",
    "  --date YYYY-MM-DD  Store observations for a specific local date.",
    "  --all              Include queries that already have an observation for the date.",
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

  const due = await listDueTrackedQueries({
    date: args.date,
    includeAlreadyObserved: args.all,
  });

  if (args.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      count: due.length,
      trackedQueries: due.map((item) => ({
        id: item.id,
        label: item.label,
        query: item.query,
        observationDate: item.observationDate,
        runTimeLocal: item.runTimeLocal,
        timezone: item.timezone,
        defaultMonth: String(item.observationDate).slice(0, 7),
      })),
    }, null, 2));
    return;
  }

  const results = [];
  for (const item of due) {
    console.log(`[tracked] ${item.id} ${item.label ?? item.query} (${item.observationDate})`);
    results.push(await runTrackedQuery(item));
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
