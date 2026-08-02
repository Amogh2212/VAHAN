import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  collectRtoFactorSourceCandidates,
  compileRtoFactorSourceRegistry,
} from "../lib/rto-factor-source-collector.mjs";

const DEFAULT_REGISTRY_PATH = "data/rto-factor-source-registry.json";
const DEFAULT_OUTPUT_DIRECTORY = "reports/rto-factor-source-candidates";

const args = parseArgs(process.argv.slice(2));

async function main() {
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const registryPath = path.resolve(args.registry);
  const input = await readJson(registryPath);
  const registry = compileRtoFactorSourceRegistry(input);
  const result = await collectRtoFactorSourceCandidates(registry, {
    sourceIds: args.sources,
    limit: args.limit,
    timeoutMs: args.timeoutMs,
  });
  const summary = summarize(result, { registryPath, write: args.write });

  if (args.write) {
    const outputPath = await writeReviewQueue(result, args.output);
    summary.outputPath = path.relative(process.cwd(), outputPath) || path.basename(outputPath);
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (result.candidateCount === 0 && result.failedSourceCount === result.sourceCount) {
    process.exitCode = 1;
  }
}

export function parseArgs(argv) {
  const parsed = {
    registry: DEFAULT_REGISTRY_PATH,
    sources: [],
    limit: null,
    timeoutMs: 15_000,
    write: false,
    output: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--registry") parsed.registry = requiredNext(argv, ++index, "--registry");
    else if (arg === "--source") parsed.sources.push(requiredNext(argv, ++index, "--source"));
    else if (arg === "--limit") parsed.limit = positiveInteger(requiredNext(argv, ++index, "--limit"), "--limit", 50);
    else if (arg === "--timeout-ms") parsed.timeoutMs = positiveInteger(requiredNext(argv, ++index, "--timeout-ms"), "--timeout-ms", 60_000);
    else if (arg === "--output") parsed.output = requiredNext(argv, ++index, "--output");
    else if (arg === "--write") parsed.write = true;
    else if (arg === "--dry-run") parsed.write = false;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw inputError(`Unknown argument: ${arg}`);
  }
  if (parsed.output && !parsed.write) throw inputError("--output requires --write");
  return parsed;
}

function summarize(result, { registryPath, write }) {
  return {
    mode: write ? "write_review_queue" : "dry_run",
    registryPath: path.relative(process.cwd(), registryPath) || path.basename(registryPath),
    collectedAt: result.collectedAt,
    databaseWrites: false,
    reviewRequired: true,
    sourceCount: result.sourceCount,
    candidateCount: result.candidateCount,
    failedSourceCount: result.failedSourceCount,
    sources: result.sources.map((source) => ({
      sourceId: source.sourceId,
      sourceKey: source.sourceKey,
      status: source.status,
      candidateCount: source.candidates.length,
      error: source.error ?? null,
    })),
    candidates: result.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      title: candidate.document.title,
      canonicalUrl: candidate.document.canonicalUrl,
      publishedAt: candidate.document.publishedAt,
      sourceKey: candidate.source.sourceKey,
    })),
    nextStep: "Review candidates, then create a real manual factor-event intake. This collector never creates events or approves evidence.",
  };
}

async function writeReviewQueue(result, outputOption) {
  const outputPath = outputOption
    ? safeWorkspaceOutputPath(outputOption)
    : defaultOutputPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  return outputPath;
}

function defaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(DEFAULT_OUTPUT_DIRECTORY, `review-queue-${stamp}.json`);
}

function safeWorkspaceOutputPath(value) {
  const root = path.resolve(process.cwd());
  const outputPath = path.resolve(value);
  const relative = path.relative(root, outputPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw inputError("--output must point to a file inside this workspace");
  }
  return outputPath;
}

async function readJson(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read source registry ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw inputError(`Source registry is not valid JSON: ${error.message}`);
  }
}

function positiveInteger(value, label, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw inputError(`${label} must be an integer between 1 and ${maximum}`);
  }
  return number;
}

function requiredNext(argv, index, label) {
  const value = argv[index];
  if (!value || String(value).startsWith("--")) throw inputError(`${label} requires a value`);
  return value;
}

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function usage() {
  return [
    "Collect reviewed-source discovery candidates for the RTO factor workflow",
    "",
    "Dry run (default; fetches allowlisted discovery pages but writes neither DB nor files):",
    "  npm.cmd run rto-factor:sources:collect",
    "",
    "Write a local review queue JSON file (still no database write):",
    "  npm.cmd run rto-factor:sources:collect -- --write",
    "",
    "Options:",
    "  --registry path.json    Allowlisted source registry (default data/rto-factor-source-registry.json)",
    "  --source SOURCE_ID      Collect one source; repeat to collect several",
    "  --limit N               Maximum candidates per source (1-50)",
    "  --timeout-ms N          Per-source timeout in milliseconds (1,000-60,000)",
    "  --write                 Save review queue under reports/rto-factor-source-candidates/",
    "  --output path.json      Output file inside this workspace; requires --write",
    "  --dry-run               Explicit no-file-write mode (default)",
    "  --help                  Show this help",
    "",
    "The output is discovery-only. A human must verify a primary source and create a separate factor-event intake before the factor agent can run.",
    "",
  ].join("\n");
}

function isMainModule() {
  return Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`[rto-factor:sources:collect] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
