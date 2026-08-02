import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { closePool } from "../lib/db.mjs";
import { runRtoFactorAgent } from "../lib/rto-factor-agent.mjs";

const args = parseArgs(process.argv.slice(2));

async function main() {
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (!args.eventId || !args.reportId) {
    throw new Error("--event-id and --report-id are required.");
  }
  if (args.write) assertWriteEnabled(process.env);

  const result = await runRtoFactorAgent({
    eventId: args.eventId,
    reportId: args.reportId,
    write: args.write,
    asOfDate: args.asOfDate,
    providerName: args.provider ?? process.env.FACTOR_AGENT_PROVIDER ?? "none",
    env: process.env,
    createdByLabel: process.env.FACTOR_AGENT_CREATED_BY ?? "rto-factor-agent-cli",
  });
  process.stdout.write(`${JSON.stringify(summarize(result), null, 2)}\n`);
}

export function assertWriteEnabled(env = process.env) {
  if (String(env.FACTOR_AGENT_ENABLED ?? "0").trim() !== "1") {
    throw new Error("Writes require FACTOR_AGENT_ENABLED=1.");
  }
  if (String(env.FACTOR_AGENT_MODE ?? "draft_only").trim().toLowerCase() !== "draft_only") {
    throw new Error("Writes require FACTOR_AGENT_MODE=draft_only.");
  }
}

export function parseArgs(argv) {
  const parsed = {
    eventId: null,
    reportId: null,
    asOfDate: null,
    provider: null,
    write: false,
    help: false,
  };
  let modeFlag = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--event-id") parsed.eventId = positiveInteger(argv[++index], "--event-id");
    else if (arg === "--report-id") parsed.reportId = positiveInteger(argv[++index], "--report-id");
    else if (arg === "--as-of") parsed.asOfDate = dateOnly(argv[++index], "--as-of");
    else if (arg === "--provider") {
      parsed.provider = String(argv[++index] ?? "").trim().toLowerCase();
      if (!["none", "auto", "ollama", "gemini", "groq"].includes(parsed.provider)) {
        throw new Error("--provider must be none, auto, ollama, gemini, or groq.");
      }
    } else if (arg === "--write" || arg === "--dry-run") {
      if (modeFlag && modeFlag !== arg) throw new Error("--write and --dry-run cannot be combined.");
      modeFlag = arg;
      parsed.write = arg === "--write";
    }
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function summarize(result) {
  const validation = result.validation ?? {};
  const estimate = validation.estimate ?? {};
  return {
    mode: result.mode,
    eventId: result.eventId,
    reportId: result.reportId,
    status: validation.status,
    eligible: validation.eligible,
    reasonCodes: validation.reasonCodes ?? [],
    interpretation: validation.interpretation ?? null,
    windows: validation.windows ?? null,
    controls: validation.peerSelection?.selected?.length ?? 0,
    coverage: validation.coverage
      ? {
          focalPre: validation.coverage.focal?.pre?.ratio ?? null,
          focalPost: validation.coverage.focal?.post?.ratio ?? null,
        }
      : null,
    estimate: estimate
      ? {
          unit: estimate.unit ?? null,
          effect: estimate.effect ?? null,
          practicalThreshold: estimate.effectThreshold ?? null,
          interval: estimate.interval ?? null,
        }
      : null,
    narrative: result.narrativeDraft
      ? {
          mode: result.narrativeDraft.mode,
          provider: result.narrativeDraft.provider,
          heading: result.narrativeDraft.narrative?.heading ?? null,
          body: result.narrativeDraft.narrative?.body ?? null,
          citations: result.narrativeDraft.narrative?.citations ?? [],
          warnings: result.narrativeDraft.warnings ?? [],
        }
      : null,
    persistedValidationId: result.persistedValidation?.id ?? null,
    persistedExplanationId: result.persistedExplanation?.id ?? null,
    publicationStatus: result.persistedExplanation
      ? "draft_pending_human_review"
      : "not_created",
  };
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label} must be a positive integer.`);
  return number;
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
    "RTO factor-agent validation and draft runner",
    "",
    "Dry run (default):",
    "  npm.cmd run rto-factor:run -- --event-id EVENT_ID --report-id REPORT_ID",
    "",
    "Persist validation and, when eligible, a review-only explanation draft:",
    "  npm.cmd run rto-factor:run -- --event-id EVENT_ID --report-id REPORT_ID --write",
    "",
    "Options:",
    "  --as-of YYYY-MM-DD",
    "  --provider none|auto|ollama|gemini|groq",
    "  --dry-run",
    "  --write",
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
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => closePool().catch(() => {}));
}
