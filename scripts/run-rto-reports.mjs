import process from "node:process";
import { closePool } from "../lib/db.mjs";
import {
  pruneRtoReportingData,
  reconcileRecentRtoReports,
  reconcileRtoReportsForRun,
} from "../lib/rto-reports.mjs";

function parseArgs(argv = []) {
  const args = {
    runId: null,
    limit: 30,
    includeAvailableHistory: false,
    historyFrom: null,
    prune: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--backfill-history") args.includeAvailableHistory = true;
    else if (token === "--prune") args.prune = true;
    else if (token === "--run-id") args.runId = Number(argv[++index]);
    else if (token.startsWith("--run-id=")) args.runId = Number(token.slice("--run-id=".length));
    else if (token === "--limit") args.limit = Number(argv[++index]);
    else if (token.startsWith("--limit=")) args.limit = Number(token.slice("--limit=".length));
    else if (token === "--history-from") args.historyFrom = argv[++index] ?? null;
    else if (token.startsWith("--history-from=")) args.historyFrom = token.slice("--history-from=".length);
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (args.runId !== null && (!Number.isInteger(args.runId) || args.runId < 1)) {
    throw new Error("--run-id must be a positive integer.");
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) throw new Error("--limit must be positive.");
  if (args.historyFrom && !/^\d{4}-\d{2}-\d{2}$/.test(args.historyFrom)) {
    throw new Error("--history-from must use YYYY-MM-DD.");
  }
  if (args.includeAvailableHistory && !args.runId) {
    throw new Error("--backfill-history requires --run-id so cohort membership is explicit.");
  }
  return args;
}

function usage() {
  return [
    "Usage: node --env-file=.env scripts/run-rto-reports.mjs [options]",
    "",
    "Options:",
    "  --run-id N              Reconcile one frozen-cohort daily run.",
    "  --backfill-history      Materialize available raw history for that run's cohort.",
    "  --history-from DATE     Earliest history date to materialize.",
    "  --limit N               Recent cohort runs to reconcile when --run-id is omitted.",
    "  --prune                 Apply report retention after reconciliation.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const reconciliation = args.runId
    ? await reconcileRtoReportsForRun({
      runId: args.runId,
      includeAvailableHistory: args.includeAvailableHistory,
      historyFrom: args.historyFrom,
    })
    : await reconcileRecentRtoReports({ limit: args.limit });
  const retention = args.prune ? await pruneRtoReportingData() : null;
  console.log(JSON.stringify({ reconciliation, retention }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closePool);
