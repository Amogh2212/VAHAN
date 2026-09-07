import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { copyBinaryExclusive, createRunDirectory, readJson, writeJsonExclusive, writeTextExclusive } from "../lib/audit/artifacts.mjs";
import { runControlledBrowser } from "../lib/audit/browser.mjs";
import {
  findFreePortRange,
  runCatalogCommand,
  runGraphifyQueries,
  runNpmAudit,
  runSemgrep,
  skippedResult,
} from "../lib/audit/command-runner.mjs";
import {
  applyReviewedPromotions,
  blockingFindings,
  deduplicateFindings,
  findingsFromCommandResults,
  findingsFromNpmAudit,
  findingsFromSarif,
  findingsFromSemgrep,
  graphifyFreshnessFinding,
  validateBaselineFindingsRegistry,
  validateCodeqlSarif,
  validateFinding,
  validateReviewedFindingsRegistry,
} from "../lib/audit/findings.mjs";
import { buildManifest, captureWorktreeState, changedPathsFromBaseline, validateCommitSha, worktreeDrift } from "../lib/audit/manifest.mjs";
import {
  CI_COMMAND_IDS,
  AUDIT_SCHEMA_VERSION,
  DEFAULT_OUTPUT_DIRECTORY,
  DETERMINISTIC_COMMANDS,
  GRAPHIFY_QUERIES,
} from "../lib/audit/policy.mjs";
import { createRedactor } from "../lib/audit/redact.mjs";
import { auditStatusFromCoverage, buildBacklog, buildCoverage, buildMarkdownReport, publishReport } from "../lib/audit/report.mjs";
import { runReadonlyRuntime } from "../lib/audit/runtime-readonly.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validCommands = new Set(["inventory", "static", "runtime:readonly", "browser", "full", "report", "ci"]);
const { values, positionals } = parseArgs({
  options: {
    out: { type: "string", default: DEFAULT_OUTPUT_DIRECTORY },
    baseline: { type: "string", default: "HEAD" },
    "include-runtime": { type: "boolean", default: false },
    publish: { type: "boolean", default: false },
    input: { type: "string" },
    codeql: { type: "string" },
    run: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
  strict: true,
});

if (values.help) {
  printHelp();
  process.exit(0);
}

const command = positionals[0];
if (!validCommands.has(command) || positionals.length !== 1) {
  printHelp();
  process.exitCode = 2;
} else {
  await main(command).catch((error) => {
    console.error(`Audit harness error: ${error.message}`);
    process.exitCode = 2;
  });
}

async function main(selectedCommand) {
  if (["static", "runtime:readonly", "browser", "full", "ci"].includes(selectedCommand) && !values.run) {
    throw new Error(`${selectedCommand} executes allowlisted checkout code; rerun with --run to acknowledge that trust boundary.`);
  }
  if (selectedCommand === "report" && !values.input) throw new Error("audit:report requires --input <prior-run-directory>.");
  if (values.publish && selectedCommand !== "report") throw new Error("--publish is accepted only by audit:report with --input.");
  if (values.input && selectedCommand !== "report") throw new Error("--input is accepted only by audit:report.");
  const redactor = createRedactor({ repoRoot });
  let manifest;
  let results = [];
  let importedFindings = [];
  let codeqlImported = false;
  let priorRun = null;

  if (selectedCommand === "report") {
    const inputDirectory = path.resolve(repoRoot, values.input);
    await assertSafePriorRunDirectory(inputDirectory);
    const [loadedManifest, loadedResults, loadedFindings, loadedSummary] = await Promise.all([
      readJson(path.join(inputDirectory, "manifest.json")),
      readJson(path.join(inputDirectory, "command-results.json")),
      readJson(path.join(inputDirectory, "findings.json")),
      readJson(path.join(inputDirectory, "run-summary.json")),
    ]);
    validatePriorRunArtifacts(loadedManifest, loadedResults, loadedFindings, loadedSummary);
    manifest = loadedManifest;
    results = loadedResults;
    importedFindings = loadedFindings;
    priorRun = { inputDirectory, summary: loadedSummary };
    codeqlImported = results.some((result) => result.id === "codeql-import" && result.status === "passed");
  } else {
    manifest = await buildManifest({ repoRoot, baselineRef: values.baseline });
  }

  const { runDirectory, runId } = await createRunDirectory({ outputBase: values.out, repoRoot, head: manifest.repository.head });
  await writeJsonExclusive(runDirectory, "manifest.json", manifest, redactor);
  if (priorRun) await copyPriorRunArtifacts(priorRun.inputDirectory, runDirectory, redactor);
  const changedPaths = priorRun ? new Set() : await changedPathsFromBaseline(repoRoot, manifest.repository.baselineCommit);

  if (!priorRun) {
    const context = { repoRoot, runDirectory, redactor };
    if (["static", "full", "ci"].includes(selectedCommand)) {
      const port = await findFreePortRange(2);
      const commands = selectedCommand === "ci"
        ? DETERMINISTIC_COMMANDS.filter((item) => CI_COMMAND_IDS.has(item.id))
        : DETERMINISTIC_COMMANDS;
      for (const checkCommand of commands) {
        results.push(await runCatalogCommand(checkCommand, { ...context, environment: { TEST_PORT: String(port) } }));
      }

      if (manifest.graphify.fresh) {
        results.push(...await runGraphifyQueries(context, GRAPHIFY_QUERIES));
      } else {
        for (let index = 0; index < GRAPHIFY_QUERIES.length; index += 1) {
          results.push(skippedResult(`graphify-query-${String(index + 1).padStart(2, "0")}`, "architecture", "Graphify is stale or unavailable; architecture queries were not treated as current evidence."));
        }
      }

      if (selectedCommand === "ci") {
        const semgrepResult = await runSemgrep(context, { includeAuto: false });
        results.push(semgrepResult);
        importedFindings.push(...findingsFromSemgrep(semgrepResult, manifest.repository.baselineCommit, changedPaths));
      } else {
        const npmResult = await runNpmAudit(context);
        results.push(npmResult);
        const packageLock = await readBoundedJson(path.join(repoRoot, "package-lock.json"), 20 * 1024 * 1024);
        importedFindings.push(...findingsFromNpmAudit(npmResult, manifest.repository.baselineCommit, packageLock));
        const semgrepResult = await runSemgrep(context, { includeAuto: true });
        results.push(semgrepResult);
        importedFindings.push(...findingsFromSemgrep(semgrepResult, manifest.repository.baselineCommit, changedPaths));
      }
    }

    if (["browser", "full"].includes(selectedCommand)) {
      results.push(await runControlledBrowser({ repoRoot, runDirectory, redactor }));
    }

    if (selectedCommand === "runtime:readonly" || (selectedCommand === "full" && values["include-runtime"])) {
      const connectionString = await loadOptionalRuntimeConnectionString();
      const runtimeRedactor = createRedactor({
        repoRoot,
        environment: connectionString ? { ...process.env, DATABASE_URL: connectionString } : process.env,
      });
      results.push(await runReadonlyRuntime({ repoRoot, runDirectory, redactor: runtimeRedactor, connectionString }));
    } else if (selectedCommand === "full") {
      results.push(skippedResult("runtime-readonly", "runtime_readonly", "Runtime inspection is opt-in; rerun full with --include-runtime."));
    }

    if (values.codeql) {
      const sarif = await readBoundedJson(path.resolve(repoRoot, values.codeql), 100 * 1024 * 1024);
      const validation = validateCodeqlSarif(sarif);
      if (validation.valid) {
        const sarifFindings = findingsFromSarif(sarif, manifest.repository.baselineCommit, changedPaths);
        importedFindings.push(...sarifFindings);
        codeqlImported = true;
        results.push(importResult("passed", `${sarifFindings.length} CodeQL result(s) normalized; source snippets were not copied.`));
      } else {
        results.push(importResult("failed", validation.reason));
      }
    }
  }

  const [baselineRegistry, reviewedRegistry] = await loadGateRegistries(repoRoot);
  const normalizedFindings = priorRun ? deduplicateFindings(importedFindings) : deduplicateFindings([
    ...importedFindings,
    ...findingsFromCommandResults(results, manifest.repository.baselineCommit),
    ...graphifyFreshnessFinding(manifest.graphify, manifest.repository.baselineCommit),
  ]);
  const findings = priorRun ? normalizedFindings : applyReviewedPromotions(normalizedFindings, reviewedRegistry);
  const monitoredDirtyPaths = (manifest.dirtyPathMetadata ?? []).map((item) => item.path);
  const endState = priorRun?.summary?.endState ?? await captureWorktreeState(repoRoot, manifest.files, monitoredDirtyPaths);
  const drift = priorRun?.summary?.worktreeDrift ?? worktreeDrift(manifest, endState);
  const coverage = buildCoverage({ manifest, results, codeqlImported });
  const backlog = buildBacklog(findings);
  const auditStatus = auditStatusFromCoverage(coverage);
  const report = buildMarkdownReport({
    manifest,
    results,
    findings,
    coverage,
    backlog,
    endState,
    drift,
    command: selectedCommand,
    auditStatus,
    inputRun: priorRun ? values.input : null,
  });
  const blocking = blockingFindings(findings, baselineRegistry, reviewedRegistry);
  const deterministicFailures = results.filter((result) => result.deterministic && result.gate && ["failed", "timed_out"].includes(result.status));

  await Promise.all([
    writeJsonExclusive(runDirectory, "command-results.json", results, redactor),
    writeJsonExclusive(runDirectory, "findings.json", findings, redactor),
    writeJsonExclusive(runDirectory, "coverage.json", coverage, redactor),
    writeJsonExclusive(runDirectory, "backlog.json", backlog, redactor),
    writeTextExclusive(runDirectory, "report.md", report, redactor),
  ]);

  let published = null;
  if (values.publish) published = await publishReport({ repoRoot, report: redactor.redactText(report), manifest, runId, inputRun: values.input });
  const executionEndState = await captureWorktreeState(repoRoot, priorRun ? [] : manifest.files, priorRun ? [] : monitoredDirtyPaths);
  const finalDrift = priorRun ? drift : worktreeDrift(manifest, executionEndState);
  await writeJsonExclusive(runDirectory, "run-summary.json", {
    schemaVersion: manifest.schemaVersion,
    runId,
    replayOfRunId: priorRun?.summary?.runId ?? null,
    command: selectedCommand,
    auditStatus,
    startedAt: priorRun ? new Date().toISOString() : manifest.generatedAt,
    completedAt: new Date().toISOString(),
    endState: priorRun ? endState : executionEndState,
    worktreeDrift: finalDrift,
    replayExecutionEndState: priorRun ? executionEndState : null,
    publishedArtifact: published ? path.relative(repoRoot, published).replaceAll("\\", "/") : null,
    counts: {
      commands: results.length,
      findings: findings.length,
      deterministicFailures: deterministicFailures.length,
      newBlockingFindings: blocking.length,
    },
    gatePolicy: "Deterministic gate failures always fail. Findings block audit:ci only when new, reviewed-confirmed, high-confidence P0/P1 and absent from the reviewed baseline. Registry scans and Ponytail remain advisory.",
  }, redactor);
  console.log(`Audit ${selectedCommand} finished (${auditStatus}).`);
  console.log(`Artifacts: ${runDirectory}`);
  if (published) console.log(`Published report: ${published}`);
  console.log(`Checks: ${results.length}; findings: ${findings.length}; deterministic failures: ${deterministicFailures.length}.`);

  if (deterministicFailures.length || (selectedCommand === "ci" && blocking.length)) process.exitCode = 1;
}

async function loadOptionalRuntimeConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = path.join(repoRoot, ".env");
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
      throw new Error("Runtime environment file must be a non-symlink regular file no larger than 1 MiB.");
    }
    return parseEnv(await fs.readFile(file, "utf8")).DATABASE_URL ?? "";
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw new Error(`Could not load optional runtime environment (${error.code ?? error.name ?? "invalid_env"}).`);
  }
}

async function loadGateRegistries(root) {
  try {
    const [baseline, reviewed] = await Promise.all([
      readJson(path.join(root, "audit", "baseline-findings.json")),
      readJson(path.join(root, "audit", "reviewed-findings.json")),
    ]);
    return [validateBaselineFindingsRegistry(baseline), validateReviewedFindingsRegistry(reviewed)];
  } catch {
    throw new Error("Audit baseline or reviewed-findings registry is missing or invalid; refusing to apply an ambiguous gate.");
  }
}

async function readBoundedJson(file, maximumBytes) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) throw new Error(`JSON input must be a non-symlink regular file no larger than ${maximumBytes} bytes.`);
  const realFile = await fs.realpath(file);
  if (realFile.toLowerCase() !== path.resolve(file).toLowerCase()) throw new Error("JSON input must not traverse a symbolic link or junction.");
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function assertSafePriorRunDirectory(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("--input must name a non-symlink audit run directory.");
  const realDirectory = await fs.realpath(directory);
  if (realDirectory.toLowerCase() !== path.resolve(directory).toLowerCase()) throw new Error("--input must not traverse a symbolic link or junction.");
  for (const file of ["manifest.json", "command-results.json", "findings.json", "run-summary.json"]) {
    const item = await fs.lstat(path.join(directory, file));
    if (!item.isFile() || item.isSymbolicLink()) throw new Error(`Unsafe or missing prior-run artifact: ${file}`);
  }
}

function importResult(status, reason) {
  return {
    id: "codeql-import",
    domain: "security",
    command: "import bounded SARIF",
    deterministic: false,
    gate: false,
    status,
    exitCode: status === "passed" ? 0 : null,
    signal: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    environmentMode: "read_only_sarif_import",
    stdoutLog: null,
    stderrLog: null,
    stdoutTruncated: false,
    stderrTruncated: false,
    reason,
  };
}

function validatePriorRunArtifacts(manifest, results, findings, summary) {
  if (!manifest || manifest.schemaVersion !== AUDIT_SCHEMA_VERSION || manifest.kind !== "vahan-ey-audit-manifest") {
    throw new Error("Prior-run manifest has an unsupported schema or kind.");
  }
  validateCommitSha(manifest.repository?.head);
  validateCommitSha(manifest.repository?.baselineCommit);
  if (!Number.isFinite(Date.parse(manifest.generatedAt)) || !Array.isArray(manifest.files)) throw new Error("Prior-run manifest has invalid time or file inventory fields.");
  if (!Array.isArray(results) || results.some((item) => !item || typeof item.id !== "string" || typeof item.status !== "string")) {
    throw new Error("Prior-run command results are malformed.");
  }
  if (!Array.isArray(findings)) throw new Error("Prior-run findings are malformed.");
  for (const item of findings) validateFinding(item);
  if (!summary || summary.schemaVersion !== AUDIT_SCHEMA_VERSION || typeof summary.runId !== "string" || !summary.endState || !summary.worktreeDrift) {
    throw new Error("Prior-run summary is malformed.");
  }
}

async function copyPriorRunArtifacts(inputDirectory, runDirectory, redactor) {
  for (const directory of ["logs", "screenshots"]) {
    const sourceDirectory = path.join(inputDirectory, directory);
    const entries = await fs.readdir(sourceDirectory, { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    if (entries.length > 500) throw new Error(`Prior-run ${directory} directory contains too many artifacts.`);
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[A-Za-z0-9._-]+$/.test(entry.name)) throw new Error(`Unsafe prior-run ${directory} artifact: ${entry.name}`);
      const source = path.join(sourceDirectory, entry.name);
      if (directory === "logs") {
        const stat = await fs.lstat(source);
        if (stat.size > 9 * 1024 * 1024) throw new Error(`Prior-run log is oversized: ${entry.name}`);
        await writeTextExclusive(runDirectory, `${directory}/${entry.name}`, await fs.readFile(source, "utf8"), redactor);
      } else {
        await copyBinaryExclusive(runDirectory, `${directory}/${entry.name}`, source);
      }
    }
  }
}

function printHelp() {
  console.log(`Usage: node scripts/audit.mjs <command> [options]

Commands:
  inventory          Hash and classify the current checkout without running checks
  static             Run allowlisted deterministic checks, Graphify, npm audit and Semgrep
  runtime:readonly   Inspect DATABASE_URL only inside BEGIN READ ONLY / ROLLBACK
  browser            Run controlled loopback Playwright checks with outbound traffic blocked
  full               Run static and browser checks; runtime remains opt-in
  report             Generate a report, optionally from --input <prior-run-directory>
  ci                 Run deterministic CI gates and repository-local Semgrep rules

Options:
  --out <directory>       Artifact base (default: audit-output)
  --baseline <git-ref>    Attribution baseline (default: HEAD)
  --include-runtime       Include enforced read-only DB inspection in full
  --codeql <sarif>        Import hosted CodeQL SARIF without copying source snippets
  --input <run-dir>       Prior artifact directory for report regeneration
  --publish               Write the sanitized report to docs/audits (never overwrite)
  --run                   Explicitly authorize allowlisted checkout-code execution
  -h, --help              Show this help

The command allow-list never includes scrapers, workers, imports, migrations, schema changes,
task registration, report rebuilding, production write endpoints, or npm audit fix.`);
}
