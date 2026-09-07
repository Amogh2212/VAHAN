import fs from "node:fs/promises";
import path from "node:path";
import { COVERAGE_DOMAINS } from "./policy.mjs";

const CATEGORY_PRIORITY = Object.freeze({
  data_trust_risk: 0,
  security_risk: 0,
  operational_risk: 1,
  confirmed_bug: 2,
  test_gap: 2,
  maintainability_issue: 3,
  documentation_configuration_gap: 4,
});
const CATEGORY_GROUP = Object.freeze({
  data_trust_risk: "data integrity and security",
  security_risk: "data integrity and security",
  operational_risk: "production reliability",
  confirmed_bug: "correctness and regression coverage",
  test_gap: "correctness and regression coverage",
  maintainability_issue: "architecture and maintainability",
  documentation_configuration_gap: "documentation and cleanup",
});
const SEVERITY_PRIORITY = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });
const CONFIDENCE_PRIORITY = Object.freeze({ high: 0, medium: 1, low: 2 });

export function buildCoverage({ manifest, results, codeqlImported = false }) {
  const checkStatuses = new Map(results.map((result) => [result.id, effectiveResultStatus(result)]));
  checkStatuses.set("manifest", "passed");
  checkStatuses.set("workflow-inventory", manifest.inventory.workflows.length ? "passed" : "skipped");
  checkStatuses.set("graphify-freshness", manifest.graphify.fresh ? "passed" : manifest.graphify.status === "unavailable" ? "skipped" : "failed");
  checkStatuses.set("graphify-query", aggregateStatuses(results.filter((result) => result.id.startsWith("graphify-query-")).map(effectiveResultStatus)));
  const codeqlResults = results.filter((result) => result.id === "codeql-import");
  checkStatuses.set("codeql", codeqlImported ? "passed" : codeqlResults.length ? aggregateStatuses(codeqlResults.map(effectiveResultStatus)) : "not_run");
  checkStatuses.set("manual-review", "not_run");
  checkStatuses.set("ponytail-manual", "not_run");

  return COVERAGE_DOMAINS.map((entry) => {
    const checks = entry.checks.map((id) => ({
      id,
      status: resolveStatus(id, checkStatuses, results),
      details: checkDetails(id, results),
    }));
    return { ...entry, status: aggregateStatuses(checks.map((item) => item.status)), checks };
  });
}

export function auditStatusFromCoverage(coverage) {
  if (!Array.isArray(coverage) || !coverage.length) return "incomplete";
  const statuses = coverage.map((entry) => entry.status);
  if (statuses.some((status) => status === "failed")) return "incomplete";
  if (statuses.every((status) => status === "passed")) return "complete";
  return "partial";
}

export function buildBacklog(findings) {
  return findings
    .filter((finding) => finding.status !== "accepted_false_positive")
    .sort(compareBacklogFindings)
    .map((finding, index) => ({
      rank: index + 1,
      findingId: finding.id,
      severity: finding.severity,
      category: finding.category,
      priorityGroup: CATEGORY_GROUP[finding.category] ?? "documentation and cleanup",
      title: finding.title,
      acceptanceCriteria: [
        finding.expected_invariant,
        `Evidence confirms the remediation: ${finding.recommended_remediation}`,
        "All deterministic audit gates pass and no data/source boundary is weakened.",
      ],
      regressionTest: finding.required_regression_test,
      status: "not_started",
    }));
}

export function buildMarkdownReport({ manifest, results, findings, coverage, backlog, endState, drift, command }) {
  const effectiveResults = results.map((result) => ({ ...result, effectiveStatus: effectiveResultStatus(result) }));
  const counts = countBy(effectiveResults, (item) => item.effectiveStatus);
  const severityCounts = countBy(findings, (item) => item.severity);
  const skipped = effectiveResults.filter((item) => ["skipped", "not_run", "partial"].includes(item.effectiveStatus));
  const failures = effectiveResults.filter((item) => item.effectiveStatus === "failed");
  const auditStatus = auditStatusFromCoverage(coverage);
  const nodeVersion = manifest.tools.node?.version ?? "unavailable";
  const declaredNode = manifest.inventory.nodeEngine ?? "unspecified";
  const lines = [
    "# Vahan EY codebase audit",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Audit command: \`${command}\``,
    `Baseline: \`${manifest.repository.baselineCommit}\``,
    `Checkout HEAD: \`${manifest.repository.head}\``,
    "",
    "## Outcome",
    "",
    `Audit status: **${auditStatus}**. This status describes coverage completeness and is separate from the process exit code.`,
    "",
    `${findings.length} normalized finding(s): ${severitySummary(severityCounts)}. ${failures.length} failed check(s), ${skipped.length} skipped/not-run/partial check(s), and ${counts.passed ?? 0} fully passed check(s) were recorded.`,
    "",
    manifest.repository.dirty
      ? `The checkout was already dirty when the audit began: ${manifest.boundaries.preExistingModifiedSourceCount} modified source file(s), ${manifest.boundaries.sourceLikeUntrackedCount} source-like untracked file(s), and ${manifest.boundaries.generatedArtifactCount} generated/runtime artifact(s) were classified. Findings are not attributed to the audit solely because a file is dirty.`
      : "The checkout was clean when the audit began.",
    "",
    drift.changedDuringAudit
      ? "Warning: the HEAD or worktree status changed while this audit was running. Treat checkout attribution as provisional."
      : "The audit did not change HEAD or the recorded worktree-status set during execution.",
    "",
    `Runtime used ${nodeVersion}; the repository declares Node ${declaredNode}. Node 22 CI is authoritative when the local runtime is outside this range.`,
    "",
    "The harness selected no scraper, queue worker, database migration/import, production write endpoint, dependency autofix, or scheduled workflow command.",
    "",
    "## Source and architecture baseline",
    "",
    `- Included and hashed source files: ${manifest.boundaries.includedSourceCount}`,
    `- Committed source files: ${manifest.boundaries.committedSourceCount}`,
    `- Pre-existing modified source files: ${manifest.boundaries.preExistingModifiedSourceCount}`,
    `- Source-like untracked files: ${manifest.boundaries.sourceLikeUntrackedCount}`,
    `- Suspicious environment-file paths (contents never read): ${manifest.boundaries.suspiciousFileCount}`,
    `- Unclassified dirty paths: ${manifest.boundaries.unclassifiedFileCount}`,
    `- Graphify: ${manifest.graphify.fresh ? "fresh" : manifest.graphify.status === "unavailable" ? "unavailable" : "stale"}; build commit ${manifest.graphify.builtCommit ?? "unknown"}; ${manifest.graphify.mismatchedEntries?.length ?? 0} hash mismatch(es); ${manifest.graphify.missingCandidates?.length ?? 0} missing graph candidate(s).`,
    "",
    "## Coverage matrix",
    "",
    "| Domain | Status | Checks | Source areas |",
    "| --- | --- | --- | --- |",
    ...coverage.map((entry) => `| ${md(entry.domain)} | ${md(entry.status)} | ${md(entry.checks.map(formatCoverageCheck).join(", "))} | ${md(entry.sourceAreas.join(", "))} |`),
    "",
    "## Check evidence",
    "",
    "| Check | Domain | Status | Exit | Duration | Stdout | Stderr | Reason / nested checks |",
    "| --- | --- | --- | ---: | ---: | --- | --- | --- |",
    ...effectiveResults.map((result) => `| ${md(result.id)} | ${md(result.domain)} | ${md(result.effectiveStatus)} | ${result.exitCode ?? "-"} | ${result.durationMs} ms | ${md(result.stdoutLog ?? "none")} | ${md(result.stderrLog ?? "none")} | ${md(resultReason(result))} |`),
    "",
    "A skipped, nested-skipped, partial, unavailable, or not-run check is never counted as fully passed.",
    "",
    "## Findings",
    "",
  ];

  if (!findings.length) {
    lines.push("No normalized findings were produced by the checks that actually ran. This does not convert skipped, unavailable, hosted-only, or manual checks into passes.", "");
  } else {
    for (const finding of findings) {
      lines.push(
        `### ${finding.id} - ${finding.title}`,
        "",
        `- Severity / confidence / status: ${finding.severity} / ${finding.confidence} / ${finding.status}`,
        `- Category: ${finding.category}`,
        `- Affected files: ${finding.affected_files.length ? finding.affected_files.map((file) => `\`${mdCode(file)}\``).join(", ") : "not localized"}`,
        `- Impact: ${finding.impact}`,
        `- Evidence: ${finding.evidence.map(renderEvidence).join("; ")}`,
        `- Detection: ${finding.reproduction_or_detection_method}`,
        `- Expected invariant: ${finding.expected_invariant}`,
        `- Recommended remediation: ${finding.recommended_remediation}`,
        `- Required regression test: ${finding.required_regression_test}`,
        `- Source: ${finding.source_tool}`,
        `- Introduced in current checkout: ${finding.introduced_in_current_checkout == null ? "not attributable" : finding.introduced_in_current_checkout}`,
        "",
      );
    }
  }

  lines.push("## Prioritized remediation backlog", "");
  if (!backlog.length) {
    lines.push("No remediation item was generated.", "");
  } else {
    lines.push("| Rank | Finding | Priority group | Severity | Acceptance and regression gate |", "| ---: | --- | --- | --- | --- |");
    for (const item of backlog) {
      lines.push(`| ${item.rank} | ${md(`${item.findingId}: ${item.title}`)} | ${md(item.priorityGroup)} | ${item.severity} | ${md(`${item.acceptanceCriteria.join(" ")} Regression: ${item.regressionTest}`)} |`);
    }
    lines.push("");
  }

  lines.push(
    "## Explicitly unverified or advisory work",
    "",
    ...explicitlyUnverified(coverage, results).map((item) => `- ${item}`),
    "",
    "Ponytail output, if commissioned with the repository prompt, is advisory and must be reconciled against source, Graphify, Semgrep, CodeQL, deterministic checks, and test evidence before becoming a confirmed finding.",
    "",
    "## Reproduce",
    "",
    "```powershell",
    "npm.cmd run audit:inventory",
    "npm.cmd run audit:static",
    "npm.cmd run audit:browser",
    "npm.cmd run audit:full",
    "npm.cmd run audit:runtime:readonly",
    "npm.cmd run audit:report -- --input audit-output/<run-id> --publish",
    "npm.cmd run audit:ci",
    "```",
    "",
    "Use `--out <directory>` to choose an artifact base, `--baseline <git-ref>` to compare another commit, `--include-runtime` to opt a full audit into database inspection, and `--codeql <sanitized-sarif>` to import hosted CodeQL results. Regenerate an existing run only with `--input audit-output/<run-id>`. Runtime access always uses `BEGIN READ ONLY` and `ROLLBACK`.",
    "",
    `End-state HEAD: \`${endState.head}\``,
    "",
  );
  return `${lines.join("\n")}\n`;
}

export async function publishReport({ repoRoot, report, manifest, runId }) {
  if (typeof runId !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}-[0-9a-f]{6}$/i.test(runId)) {
    throw new Error("Cannot publish an audit report with an invalid run ID.");
  }
  if (!manifest || typeof manifest !== "object") throw new Error("Cannot publish an audit report without a manifest.");
  const directory = path.join(repoRoot, "docs", "audits");
  await preparePublishDirectory(repoRoot, directory);
  const date = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Cannot derive a safe current publication date.");
  const file = path.join(directory, `${date}-${runId}-codebase-audit.md`);
  const handle = await fs.open(file, "wx");
  try {
    await handle.writeFile(report, "utf8");
  } finally {
    await handle.close();
  }
  return file;
}

async function preparePublishDirectory(repoRoot, directory) {
  const root = path.resolve(repoRoot);
  const docs = path.join(root, "docs");
  const expected = path.join(docs, "audits");
  if (path.resolve(directory).toLowerCase() !== expected.toLowerCase()) throw new Error("Audit reports may only be published under docs/audits.");

  await ensurePlainDirectory(docs);
  await ensurePlainDirectory(expected);
  const [realRoot, realDirectory] = await Promise.all([fs.realpath(root), fs.realpath(expected)]);
  const relative = path.relative(realRoot, realDirectory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("docs/audits resolves outside the repository or aliases the repository root.");
  }
}

async function ensurePlainDirectory(directory) {
  const existing = await fs.lstat(directory).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error(`Refusing linked or non-directory report path: ${directory}`);
    return;
  }
  await fs.mkdir(directory);
  const created = await fs.lstat(directory);
  if (!created.isDirectory() || created.isSymbolicLink()) throw new Error(`Refusing linked or non-directory report path: ${directory}`);
}

function explicitlyUnverified(coverage, results) {
  const items = [];
  for (const entry of coverage.filter((item) => item.status !== "passed")) {
    items.push(`${entry.domain}: ${entry.status}.`);
    for (const check of entry.checks ?? []) {
      if (check.status !== "passed") items.push(`${entry.domain}/${check.id}: ${check.status}.`);
    }
  }
  for (const result of results) {
    const effective = effectiveResultStatus(result);
    if (["skipped", "not_run", "partial"].includes(effective)) items.push(`${result.id}: ${result.reason ?? effective}`);
    for (const child of nestedChecks(result)) {
      if (child.status !== "passed") items.push(`${result.id}/${child.id ?? "nested-check"}: ${child.status}; ${child.message ?? "no reason recorded"}`);
    }
  }
  return [...new Set(items)].length ? [...new Set(items)] : ["None recorded."];
}

function resolveStatus(id, statuses, results) {
  if (statuses.has(id)) return statuses.get(id);
  const matching = results.filter((result) => result.id === id || result.id.startsWith(`${id}-`));
  return aggregateStatuses(matching.map(effectiveResultStatus));
}

function effectiveResultStatus(result) {
  const own = normalizeStatus(result.status);
  const children = nestedChecks(result);
  return children.length ? aggregateStatuses([own, ...children.map((item) => normalizeStatus(item.status))]) : own;
}

function nestedChecks(result) {
  const output = [];
  const visit = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== "object") continue;
      output.push(item);
      visit(item.checks);
    }
  };
  visit(result.checks);
  return output;
}

function aggregateStatuses(statuses) {
  const normalized = statuses.map(normalizeStatus).filter(Boolean);
  if (!normalized.length) return "not_run";
  if (normalized.some((status) => status === "failed")) return "failed";
  if (normalized.every((status) => status === "passed")) return "passed";
  if (normalized.every((status) => status === "skipped")) return "skipped";
  if (normalized.every((status) => status === "not_run")) return "not_run";
  return "partial";
}

function normalizeStatus(status) {
  if (["failed", "timed_out"].includes(status)) return "failed";
  if (["passed", "skipped", "not_run", "partial"].includes(status)) return status;
  return "not_run";
}

function checkDetails(id, results) {
  const matching = results.filter((result) => result.id === id || result.id.startsWith(`${id}-`));
  return matching.flatMap((result) => nestedChecks(result)
    .filter((item) => item.status !== "passed")
    .map((item) => ({ id: item.id ?? "nested-check", status: normalizeStatus(item.status), reason: item.message ?? null })));
}

function formatCoverageCheck(item) {
  const details = item.details?.length
    ? ` [${item.details.map((detail) => `${detail.id}: ${detail.status}`).join("; ")}]`
    : "";
  return `${item.id}: ${item.status}${details}`;
}

function resultReason(result) {
  const parts = [];
  if (result.reason) parts.push(result.reason);
  for (const item of nestedChecks(result)) {
    if (item.status !== "passed") parts.push(`${item.id ?? "nested-check"}: ${item.status}${item.message ? ` (${item.message})` : ""}`);
  }
  return parts.length ? parts.join("; ") : "none";
}

function renderEvidence(item) {
  const parts = [];
  if (item.file) parts.push(`location=\`${mdCode(`${item.file}${item.line ? `:${item.line}` : ""}`)}\``);
  else if (item.line) parts.push(`line=${item.line}`);
  if (item.rule) parts.push(`rule=\`${mdCode(item.rule)}\``);
  if (item.artifact) parts.push(`artifact=\`${mdCode(item.artifact)}\``);
  if (item.stdout_artifact) parts.push(`stdout=\`${mdCode(item.stdout_artifact)}\``);
  if (item.stderr_artifact) parts.push(`stderr=\`${mdCode(item.stderr_artifact)}\``);
  if (item.advisory) parts.push(`advisory=\`${mdCode(item.advisory)}\``);
  if (item.installed_versions?.length) parts.push(`installed=${item.installed_versions.map((version) => `\`${mdCode(version)}\``).join(", ")}`);
  if (item.message) parts.push(md(item.message));
  return parts.length ? parts.join("; ") : "recorded evidence";
}

function compareBacklogFindings(left, right) {
  return (CATEGORY_PRIORITY[left.category] ?? 99) - (CATEGORY_PRIORITY[right.category] ?? 99)
    || SEVERITY_PRIORITY[left.severity] - SEVERITY_PRIORITY[right.severity]
    || CONFIDENCE_PRIORITY[left.confidence] - CONFIDENCE_PRIORITY[right.confidence]
    || left.id.localeCompare(right.id);
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function severitySummary(counts) {
  return ["P0", "P1", "P2", "P3"].map((level) => `${level}=${counts[level] ?? 0}`).join(", ");
}

function md(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function mdCode(value) {
  return String(value ?? "").replaceAll("`", "'").replace(/\r?\n/g, " ");
}
