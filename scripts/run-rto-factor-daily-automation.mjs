import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { closePool } from "../lib/db.mjs";
import {
  acquireRtoFactorDailyLock,
  assertDailyAutomationWriteEnabled,
  runPendingRtoFactorValidations,
} from "../lib/rto-factor-daily-automation.mjs";
import {
  collectRtoFactorSourceCandidates,
  compileRtoFactorSourceRegistry,
} from "../lib/rto-factor-source-collector.mjs";

const DEFAULT_REGISTRY_PATH = "data/rto-factor-source-registry.json";
const DEFAULT_OUTPUT_DIRECTORY = "reports/rto-factor-daily";
const DEFAULT_REVIEW_QUEUE_DIRECTORY = "reports/rto-factor-source-candidates";

const args = parseArgs(process.argv.slice(2));

async function main() {
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (args.write) assertDailyAutomationWriteEnabled(process.env);

  const releaseLock = await acquireRtoFactorDailyLock("rto-factor-daily-task");
  try {
    const collected = args.skipSourceCollection
      ? { summary: { status: "skipped", reason: "source_collection_disabled" } }
      : await collectSources(args);
    const validations = await runPendingRtoFactorValidations({
      asOfDate: args.asOfDate,
      write: args.write,
      providerName: args.provider,
      env: process.env,
      limit: args.validationLimit,
    });
    const summary = {
      kind: "rto-factor-daily-automation",
      generatedAt: new Date().toISOString(),
      mode: args.write ? "write_drafts_only" : "dry_run",
      sourceCollection: collected.summary,
      validations,
      safeguards: [
        "Source candidates remain a human review queue; this job never creates or approves factor events.",
        "The job writes only deterministic validations and review-only explanation drafts.",
        "No VAHAN scrape, report total, queue, scheduler, or published explanation is changed by this job.",
      ],
    };
    if (args.write) {
      const outputPath = await writeJson(defaultOutputPath(), summary);
      summary.outputPath = path.relative(process.cwd(), outputPath);
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (validations.errorCount > 0 || collected.summary.status === "failed") process.exitCode = 1;
  } finally {
    await releaseLock();
  }
}

async function collectSources(options) {
  const registryPath = path.resolve(options.registry);
  const input = JSON.parse(await readFile(registryPath, "utf8"));
  const registry = compileRtoFactorSourceRegistry(input);
  const result = await collectRtoFactorSourceCandidates(registry, {
    limit: options.sourceLimit,
    timeoutMs: options.sourceTimeoutMs,
  });
  let queuePath = null;
  if (options.write) {
    queuePath = await writeJson(defaultReviewQueuePath(), result);
  }
  return {
    summary: {
      status: result.failedSourceCount === result.sourceCount ? "failed" : "complete",
      registryPath: path.relative(process.cwd(), registryPath),
      collectedAt: result.collectedAt,
      sourceCount: result.sourceCount,
      candidateCount: result.candidateCount,
      failedSourceCount: result.failedSourceCount,
      reviewQueuePath: queuePath ? path.relative(process.cwd(), queuePath) : null,
      sources: result.sources.map((source) => ({
        sourceId: source.sourceId,
        sourceKey: source.sourceKey,
        status: source.status,
        candidateCount: source.candidates.length,
        error: source.error ?? null,
      })),
    },
  };
}

export function parseArgs(argv) {
  const parsed = {
    registry: DEFAULT_REGISTRY_PATH,
    sourceLimit: null,
    sourceTimeoutMs: 15_000,
    validationLimit: configuredValidationLimit(),
    asOfDate: null,
    provider: "none",
    write: false,
    skipSourceCollection: false,
    help: false,
  };
  let modeFlag = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--registry") parsed.registry = requiredNext(argv, ++index, "--registry");
    else if (arg === "--source-limit") parsed.sourceLimit = positiveInteger(requiredNext(argv, ++index, "--source-limit"), "--source-limit", 50);
    else if (arg === "--source-timeout-ms") parsed.sourceTimeoutMs = positiveInteger(requiredNext(argv, ++index, "--source-timeout-ms"), "--source-timeout-ms", 60_000);
    else if (arg === "--validation-limit") parsed.validationLimit = positiveInteger(requiredNext(argv, ++index, "--validation-limit"), "--validation-limit", 500);
    else if (arg === "--as-of") parsed.asOfDate = dateOnly(requiredNext(argv, ++index, "--as-of"), "--as-of");
    else if (arg === "--provider") {
      parsed.provider = String(requiredNext(argv, ++index, "--provider")).trim().toLowerCase();
      if (!['none', 'auto', 'ollama', 'gemini', 'groq'].includes(parsed.provider)) {
        throw new Error("--provider must be none, auto, ollama, gemini, or groq.");
      }
    } else if (arg === "--write" || arg === "--dry-run") {
      if (modeFlag && modeFlag !== arg) throw new Error("--write and --dry-run cannot be combined.");
      modeFlag = arg;
      parsed.write = arg === "--write";
    } else if (arg === "--skip-source-collection") parsed.skipSourceCollection = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function writeJson(outputPath, value) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  return outputPath;
}

function defaultOutputPath() {
  return path.resolve(DEFAULT_OUTPUT_DIRECTORY, `run-${timestamp()}.json`);
}

function defaultReviewQueuePath() {
  return path.resolve(DEFAULT_REVIEW_QUEUE_DIRECTORY, `review-queue-${timestamp()}.json`);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function configuredValidationLimit() {
  const value = Number(process.env.FACTOR_DAILY_VALIDATION_LIMIT ?? 200);
  return Number.isSafeInteger(value) && value >= 1 && value <= 500 ? value : 200;
}

function positiveInteger(value, label, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}.`);
  }
  return number;
}

function requiredNext(argv, index, label) {
  const value = argv[index];
  if (!value || String(value).startsWith("--")) throw new Error(`${label} requires a value.`);
  return value;
}

function dateOnly(value, label) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  return text;
}

function usage() {
  return [
    "Daily RTO factor automation: source review queue plus eligible-event validation",
    "",
    "Dry run (default; no files or database records are written):",
    "  npm.cmd run rto-factor:daily",
    "",
    "Activated daily task mode (writes validations and review-only drafts):",
    "  npm.cmd run rto-factor:daily -- --write",
    "",
    "Options:",
    "  --registry path.json           Allowlisted source registry",
    "  --source-limit N              Max discovery candidates per source (1-50)",
    "  --source-timeout-ms N         Per-source timeout (1,000-60,000)",
    "  --validation-limit N          Max unprocessed event/report pairs (1-500)",
    "  --as-of YYYY-MM-DD            Never later than each report snapshot date",
    "  --provider none|auto|ollama|gemini|groq",
    "  --skip-source-collection      Run validations only",
    "  --write                       Requires explicit daily and factor-agent env gates",
    "  --dry-run                     Explicit no-write mode (default)",
    "",
    "This job never creates events, approves source evidence, publishes explanations, or starts VAHAN scraping.",
    "",
  ].join("\n");
}

function isMainModule() {
  return Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(`[rto-factor:daily] ${error.stack || error.message}`);
      process.exitCode = 1;
    })
    .finally(() => closePool().catch(() => {}));
}
