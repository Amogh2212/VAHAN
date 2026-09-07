import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { containedPath, createRunDirectory, writeJsonExclusive, writeTextExclusive } from "../lib/audit/artifacts.mjs";
import { classifyNpmAuditResult, classifySemgrepResult } from "../lib/audit/command-runner.mjs";
import {
  applyReviewedPromotions,
  blockingFindings,
  deduplicateFindings,
  validateCodeqlSarif,
  validateFinding,
} from "../lib/audit/findings.mjs";
import { graphifyIntroducedCandidates, validateCommitSha, worktreeDrift } from "../lib/audit/manifest.mjs";
import {
  COVERAGE_DOMAINS,
  DETERMINISTIC_COMMANDS,
  FORBIDDEN_SCRIPT_PATTERNS,
  isGeneratedPath,
  safeAuditEnvironment,
} from "../lib/audit/policy.mjs";
import { createRedactor } from "../lib/audit/redact.mjs";
import { buildCoverage } from "../lib/audit/report.mjs";
import { runReadonlyRuntime } from "../lib/audit/runtime-readonly.mjs";

const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "vahan-audit-unit-"));
const runDirectory = path.join(temporaryDirectory, "run with spaces (safe)");
await fs.mkdir(runDirectory, { recursive: true });
const redactor = createRedactor({
  repoRoot: process.cwd(),
  homeDirectory: os.homedir(),
  environment: {
    GROQ_API_KEY: "gsk_example_super_secret_value",
    DATABASE_URL: "postgresql://audit:YOUR_PASSWORD@example.invalid/db?sslmode=require",
  },
});

try {
  redactionChecks();
  await artifactChecks();
  policyChecks();
  npmAuditClassificationChecks();
  semgrepClassificationChecks();
  manifestChecks();
  codeqlValidationChecks();
  findingChecks();
  reportChecks();
  await runtimeSkipCheck();
  await schemaChecks();
  console.log("Audit harness unit checks passed.");
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}

function redactionChecks() {
  const input = [
    "GROQ_API_KEY=gsk_example_super_secret_value",
    "postgresql://audit:YOUR_PASSWORD@example.invalid/db?sslmode=require",
    "Authorization: Bearer should-never-appear",
    "Cookie: session=private",
    "https://example.invalid/path?token=private#part",
    "https://alice:hunter2@example.invalid/path#private-fragment",
    "/api/query?unknown_secret=private",
    process.cwd(),
  ].join("\n");
  const output = redactor.redactText(input);
  assert.doesNotMatch(output, /gsk_example_super_secret_value/);
  assert.doesNotMatch(output, /audit:YOUR_PASSWORD/);
  assert.doesNotMatch(output, /should-never-appear/);
  assert.doesNotMatch(output, /session=private/);
  assert.doesNotMatch(output, /token=private/);
  assert.doesNotMatch(output, /alice:hunter2/);
  assert.doesNotMatch(output, /private-fragment/);
  assert.doesNotMatch(output, /unknown_secret=private/);
  assert.match(output, /<REPO>/);
  const object = redactor.redactObject({ apiKey: "value", safeFingerprint: "abc", nested: { cookie: "secret" } });
  assert.equal(object.apiKey, "[REDACTED]");
  assert.equal(object.safeFingerprint, "abc");
  assert.equal(object.nested.cookie, "[REDACTED]");
  assert.equal(redactor.redactObject({ tokenPresent: "unknown-secret-value" }).tokenPresent, "[REDACTED]");
  assert.equal(redactor.redactObject({ tokenPresent: true }).tokenPresent, true);
  const shared = { value: "safe" };
  const repeated = redactor.redactObject({ first: shared, second: shared });
  assert.deepEqual(repeated, { first: { value: "safe" }, second: { value: "safe" } });
  const circular = {};
  circular.self = circular;
  assert.equal(redactor.redactObject(circular).self, "[CIRCULAR]");
}

async function artifactChecks() {
  await writeTextExclusive(runDirectory, "logs/test.log", "token gsk_example_super_secret_value", redactor);
  const text = await fs.readFile(path.join(runDirectory, "logs", "test.log"), "utf8");
  assert.doesNotMatch(text, /gsk_example_super_secret_value/);
  await assert.rejects(() => writeTextExclusive(runDirectory, "logs/test.log", "overwrite", redactor), /EEXIST/);
  await writeJsonExclusive(runDirectory, "manifest.json", { password: "nope", value: "safe" }, redactor);
  const json = JSON.parse(await fs.readFile(path.join(runDirectory, "manifest.json"), "utf8"));
  assert.equal(json.password, "[REDACTED]");
  assert.throws(() => containedPath(runDirectory, "../escape.txt"), /escapes/);
  const target = path.join(temporaryDirectory, "junction-target");
  const link = path.join(temporaryDirectory, "junction-output");
  const isolatedRepo = path.join(temporaryDirectory, "isolated-repo");
  await fs.mkdir(target);
  await fs.mkdir(isolatedRepo);
  try {
    await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(() => createRunDirectory({ outputBase: link, repoRoot: isolatedRepo, head: "abc" }), /symbolic-link|junction/i);
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS"].includes(error.code)) throw error;
  }
}

function policyChecks() {
  for (const command of DETERMINISTIC_COMMANDS) {
    assert.equal(command.executable, "node");
    assert.equal(command.args.length, 1);
    assert.equal(FORBIDDEN_SCRIPT_PATTERNS.some((pattern) => pattern.test(command.args[0])), false, `${command.id} is prohibited`);
  }
  const environment = safeAuditEnvironment({
    PATH: "safe",
    TELEGRAM_BOT_TOKEN: "private",
    DATABASE_URL: "private",
    GROQ_API_KEY: "private",
    NODE_OPTIONS: "--require=malicious.js",
    NODE_PATH: "private",
    NODE_V8_COVERAGE: "private",
    npm_config_userconfig: "private",
    HTTPS_PROXY: "http://user:password@example.invalid",
    LD_PRELOAD: "private",
    GIT_CONFIG_COUNT: "9",
  });
  assert.equal(environment.PATH, "safe");
  assert.equal(environment.TELEGRAM_BOT_TOKEN, "");
  assert.equal(environment.DATABASE_URL, "");
  assert.equal(environment.GROQ_API_KEY, "");
  assert.equal(environment.VAHAN_DISABLE_LIVE_REFRESH, "1");
  assert.equal(environment.BIND_HOST, "127.0.0.1");
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "NODE_V8_COVERAGE", "npm_config_userconfig", "HTTPS_PROXY", "LD_PRELOAD", "GIT_CONFIG_COUNT"]) {
    assert.equal(Object.hasOwn(environment, key), false, `${key} must be stripped`);
  }
  assert.equal(isGeneratedPath("debug.log"), true);
  assert.equal(isGeneratedPath("scripts/audit.mjs"), false);
}

function npmAuditClassificationChecks() {
  const valid = auditResult('{"auditReportVersion":2,"vulnerabilities":{},"metadata":{"vulnerabilities":{"total":0}}}');
  assert.equal(classifyNpmAuditResult(valid).status, "passed");
  const networkError = auditResult('{"message":"request failed","error":{"code":"ENETUNREACH"}}');
  assert.equal(classifyNpmAuditResult(networkError).status, "skipped");
  assert.match(networkError.reason, /not verified/i);
  const malformed = auditResult("not JSON");
  assert.equal(classifyNpmAuditResult(malformed).status, "skipped");
}

function semgrepClassificationChecks() {
  const valid = scannerResult('{"version":"1","results":[],"errors":[]}');
  assert.equal(classifySemgrepResult(valid).status, "passed");
  const malformed = scannerResult("not JSON");
  assert.equal(classifySemgrepResult(malformed).status, "failed");
  const truncated = scannerResult('{"results":[],"errors":[]}', true);
  assert.equal(classifySemgrepResult(truncated).status, "failed");
  const errors = scannerResult('{"results":[],"errors":[{"type":"Parse error"}]}');
  assert.equal(classifySemgrepResult(errors).status, "failed");
}

function scannerResult(stdout, truncated = false) {
  return { status: "passed", reason: null, stdoutTruncated: truncated, stderrTruncated: false, _capturedStdout: stdout };
}

function manifestChecks() {
  assert.equal(validateCommitSha("a".repeat(40)), "a".repeat(40));
  assert.throws(() => validateCommitSha("--output=NUL"), /40-character/);
  const manifest = {
    repository: { head: "a".repeat(40) },
    gitStatus: [{ code: " M", path: "server.mjs" }],
    files: [{ path: "server.mjs", hashStatus: "stable", hash: "before" }],
    dirtyPathMetadata: [{ path: "debug.log", status: "present", kind: "file", size: 1, mtimeMs: 1, ctimeMs: 1 }],
  };
  const endState = {
    head: "a".repeat(40),
    status: [{ code: " M", path: "server.mjs" }],
    files: [{ path: "server.mjs", hashStatus: "stable", hash: "after" }],
    pathMetadata: [{ path: "debug.log", status: "present", kind: "file", size: 2, mtimeMs: 2, ctimeMs: 2 }],
  };
  const drift = worktreeDrift(manifest, endState);
  assert.equal(drift.statusChanged, false);
  assert.equal(drift.contentChanged, true);
  assert.deepEqual(drift.contentChangedPaths, ["server.mjs"]);
  assert.equal(drift.metadataChanged, true);
  assert.deepEqual(drift.metadataChangedPaths, ["debug.log"]);
  assert.deepEqual(graphifyIntroducedCandidates([
    { path: "lib/committed.mjs", sourceState: "committed", gitStatus: null },
    { path: "lib/modified.mjs", sourceState: "pre_existing_modified", gitStatus: " M" },
    { path: "lib/staged-new.mjs", sourceState: "pre_existing_modified", gitStatus: "A " },
    { path: "scripts/untracked.mjs", sourceState: "source_like_untracked", gitStatus: "??" },
    { path: "public/image.png", sourceState: "source_like_untracked", gitStatus: "??" },
  ]), ["lib/staged-new.mjs", "scripts/untracked.mjs"]);
}

function codeqlValidationChecks() {
  assert.equal(validateCodeqlSarif({}).valid, false);
  assert.equal(validateCodeqlSarif({ version: "2.1.0", runs: [{ tool: { driver: { name: "Other" } }, results: [] }] }).valid, false);
  assert.equal(validateCodeqlSarif({ version: "2.1.0", runs: [{ tool: { driver: { name: "CodeQL" } }, results: [] }] }).valid, true);
}

function auditResult(stdout) {
  const result = { status: "passed", reason: null, _capturedStdout: stdout };
  return result;
}

function findingChecks() {
  const item = {
    id: "VEY-AAAAAAAAAAAA",
    category: "security_risk",
    severity: "P1",
    confidence: "high",
    status: "confirmed",
    title: "Test finding",
    affected_files: ["server.mjs"],
    evidence: [{ message: "fixture" }],
    impact: "fixture",
    reproduction_or_detection_method: "fixture",
    expected_invariant: "fixture",
    recommended_remediation: "fixture",
    required_regression_test: "fixture",
    source_tool: "fixture",
    baseline_commit: "a".repeat(40),
    introduced_in_current_checkout: true,
  };
  assert.equal(validateFinding(item), item);
  assert.equal(deduplicateFindings([item, { ...item }]).length, 1);
  const baseline = baselineRegistry([]);
  const reviewed = reviewedRegistry(item);
  const promoted = applyReviewedPromotions([{ ...item, status: "needs_validation", confidence: "medium" }], reviewed);
  assert.equal(promoted[0].status, "confirmed");
  assert.equal(blockingFindings(promoted, baseline, reviewed).length, 1);
  assert.equal(blockingFindings(promoted, baselineRegistry([item.id]), reviewed).length, 0);
  assert.throws(() => validateFinding({ ...item, status: "passed" }), /Invalid finding status/);
  assert.throws(() => validateFinding({ ...item, id: "VEY-TEST" }), /Invalid finding id/);
  assert.throws(() => validateFinding({ ...item, title: "" }), /nonempty string/);
  assert.throws(() => validateFinding({ ...item, evidence: [] }), /nonempty array/);
  assert.throws(() => validateFinding({ ...item, baseline_commit: "abc" }), /baseline_commit/);
  assert.throws(() => validateFinding({ ...item, unexpected: true }), /unsupported property/);
}

function baselineRegistry(findingIds) {
  return {
    schemaVersion: "1.0.0",
    baselineCommit: findingIds.length ? "a".repeat(40) : null,
    reviewedAt: findingIds.length ? "2026-08-13T00:00:00.000Z" : null,
    reviewedBy: findingIds.length ? "audit reviewer" : null,
    policy: "Fixture baseline policy.",
    findingIds,
  };
}

function reviewedRegistry(item) {
  return {
    schemaVersion: "1.0.0",
    policy: "Fixture reviewed promotion policy.",
    promotions: [{
      findingId: item.id,
      severity: item.severity,
      status: "confirmed",
      confidence: "high",
      introducedInCurrentCheckout: true,
      baselineCommit: item.baseline_commit,
      reviewedAt: "2026-08-13T00:00:00.000Z",
      reviewedBy: "audit reviewer",
      reviewEvidence: "Confirmed reachable source-to-sink flow.",
      introductionEvidence: "Baseline comparison proves the flow was introduced.",
    }],
  };
}

function reportChecks() {
  const manifest = {
    inventory: { workflows: [".github/workflows/codeql.yml"] },
    graphify: { fresh: true, status: "verified" },
  };
  const coverage = buildCoverage({
    manifest,
    results: [
      { id: "security-unit", status: "passed" },
      { id: "secret-scan", status: "passed" },
      { id: "semgrep", status: "skipped" },
    ],
    codeqlImported: false,
  });
  const security = coverage.find((entry) => entry.domain === "security");
  assert.notEqual(security.status, "passed", "skipped Semgrep and absent CodeQL must not become a pass");
  assert.equal(security.checks.find((item) => item.id === "semgrep").status, "skipped");
  assert.equal(security.checks.find((item) => item.id === "codeql").status, "not_run");
}

async function runtimeSkipCheck() {
  const result = await runReadonlyRuntime({ repoRoot: process.cwd(), runDirectory, redactor, connectionString: "" });
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /not configured/i);
}

async function schemaChecks() {
  const schema = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit", "findings.schema.json"), "utf8"));
  const baseline = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit", "baseline-findings.json"), "utf8"));
  const matrix = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit", "coverage-matrix.json"), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.ok(schema.$defs.finding.required.includes("required_regression_test"));
  assert.deepEqual(baseline.findingIds, []);
  assert.deepEqual(matrix.domains.map((item) => item.domain), COVERAGE_DOMAINS.map((item) => item.domain));
}
