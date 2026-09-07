import crypto from "node:crypto";
import { normalizeRepoPath } from "./policy.mjs";

const REQUIRED_FIELDS = Object.freeze([
  "id",
  "category",
  "severity",
  "confidence",
  "status",
  "title",
  "affected_files",
  "evidence",
  "impact",
  "reproduction_or_detection_method",
  "expected_invariant",
  "recommended_remediation",
  "required_regression_test",
  "source_tool",
  "baseline_commit",
  "introduced_in_current_checkout",
]);

const EVIDENCE_FIELDS = new Set([
  "message",
  "artifact",
  "stdout_artifact",
  "stderr_artifact",
  "advisory",
  "file",
  "line",
  "rule",
  "installed_versions",
]);
const CATEGORIES = new Set(["confirmed_bug", "security_risk", "data_trust_risk", "operational_risk", "maintainability_issue", "test_gap", "documentation_configuration_gap"]);
const SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);
const CONFIDENCES = new Set(["high", "medium", "low"]);
const STATUSES = new Set(["confirmed", "needs_validation", "accepted_false_positive"]);
const FINDING_ID_PATTERN = /^VEY-[A-F0-9]{12}$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/i;
const REVIEW_REGISTRY_FIELDS = new Set(["schemaVersion", "policy", "promotions"]);
const REVIEW_PROMOTION_FIELDS = new Set([
  "findingId",
  "severity",
  "status",
  "confidence",
  "introducedInCurrentCheckout",
  "baselineCommit",
  "reviewedAt",
  "reviewedBy",
  "reviewEvidence",
  "introductionEvidence",
]);
const BASELINE_REGISTRY_FIELDS = new Set(["schemaVersion", "baselineCommit", "reviewedAt", "reviewedBy", "policy", "findingIds"]);

export function findingsFromCommandResults(results, baselineCommit) {
  return results
    .filter((result) => ["failed", "timed_out"].includes(result.status))
    .map((result) => finding({
      idSeed: `command:${result.id}`,
      category: result.domain === "security" ? "security_risk" : result.domain === "data_trust" ? "data_trust_risk" : "operational_risk",
      severity: result.gate ? "P1" : "P2",
      confidence: result.deterministic ? "high" : "medium",
      status: result.deterministic ? "confirmed" : "needs_validation",
      title: `${result.id} audit check ${result.status.replace("_", " ")}`,
      affectedFiles: result.affectedFiles ?? [],
      evidence: [compactEvidence({
        stdout_artifact: result.stdoutLog,
        stderr_artifact: result.stderrLog,
        message: `Exit code ${result.exitCode ?? "unavailable"}; duration ${result.durationMs} ms.`,
      })],
      impact: "The affected audit domain cannot be treated as verified until this check succeeds.",
      detection: result.command ?? result.id,
      invariant: "A deterministic audit gate must complete successfully in the isolated audit environment.",
      remediation: "Inspect the sanitized command logs, fix the underlying code or harness failure, and rerun the same audit command.",
      regression: `Make ${result.id} pass under Node 22 without database, credentials, Telegram, AI providers, or live VAHAN access.`,
      sourceTool: result.id,
      baselineCommit,
      introduced: null,
    }));
}

export function findingsFromNpmAudit(result, baselineCommit, packageLock = null) {
  if (result.status !== "passed" && result.exitCode !== 1) return [];
  const parsed = parseJson(result._capturedStdout);
  if (!parsed?.vulnerabilities || typeof parsed.vulnerabilities !== "object") return [];
  const lock = parsePackageLock(packageLock);
  return Object.values(parsed.vulnerabilities).map((vulnerability) => {
    const installedVersions = installedVersionsFor(vulnerability, lock);
    const installedText = installedVersions.length ? installedVersions.join(", ") : "not resolved from package-lock.json";
    const via = (vulnerability.via ?? []).filter((item) => item && typeof item === "object");
    const evidence = via.slice(0, 10).map((item) => compactEvidence({
      message: `${item.title ?? item.name ?? "Advisory"}; installed version(s) ${installedText}; vulnerable range ${item.range ?? vulnerability.range ?? "unknown"}.`,
      advisory: typeof item.url === "string" ? item.url : null,
      installed_versions: installedVersions,
    }));
    if (!evidence.length) {
      evidence.push(compactEvidence({
        message: `Installed version(s) ${installedText}; vulnerable range ${vulnerability.range ?? "unknown"}; installed nodes ${(vulnerability.nodes ?? []).length}.`,
        installed_versions: installedVersions,
      }));
    }
    return finding({
      idSeed: `npm:${vulnerability.name}`,
      category: "security_risk",
      severity: npmSeverity(vulnerability.severity),
      confidence: "high",
      status: "needs_validation",
      title: `Dependency advisory affects ${vulnerability.name}`,
      affectedFiles: ["package.json", "package-lock.json"],
      evidence,
      impact: `${vulnerability.isDirect ? "Direct" : "Transitive"} production dependency exposure; exploitability in Vahan EY requires source-path validation.`,
      detection: "npm audit --omit=dev --json reconciled with package-lock.json",
      invariant: "Production dependencies must not expose confirmed high-impact vulnerable execution paths.",
      remediation: describeNpmFix(vulnerability.fixAvailable),
      regression: "Rerun npm audit and the complete Node 22 release gate after an intentionally reviewed dependency change.",
      sourceTool: "npm-audit",
      baselineCommit,
      introduced: null,
    });
  });
}

export function findingsFromSemgrep(result, baselineCommit, changedPaths) {
  if (result.status !== "passed" && result.exitCode !== 1) return [];
  const parsed = parseJson(result._capturedStdout);
  const findings = (parsed?.results ?? []).map((match) => {
    const file = normalizeRepoPath(match.path ?? "unknown");
    const rule = safeScannerRule(match.check_id, "unknown-semgrep-rule");
    const line = positiveInteger(match.start?.line);
    const category = semgrepCategory(match.extra?.metadata);
    const title = staticRuleTitle("Semgrep", rule);
    return finding({
      idSeed: staticFindingSeed(category, file, rule),
      category,
      severity: semgrepSeverity(match.extra?.severity),
      confidence: semgrepConfidence(match.extra?.metadata?.confidence),
      status: "needs_validation",
      title,
      affectedFiles: [file],
      evidence: [compactEvidence({ file, line, rule, message: "Semgrep matched this source location; inspect the sanitized log for rule metadata." })],
      impact: "Static pattern match may indicate a security, correctness, or workflow trust-boundary violation.",
      detection: `Semgrep rule ${rule}`,
      invariant: "Untrusted input and privileged operations must remain behind explicit validation and policy boundaries.",
      remediation: "Review the complete source flow, apply the smallest safe correction if confirmed, and document false positives explicitly.",
      regression: "Add a focused regression test and a sanitized static-analysis fixture before marking this finding confirmed.",
      sourceTool: `semgrep:${rule}`,
      baselineCommit,
      introduced: changedPaths.has(file) ? true : false,
    });
  });
  return deduplicateFindings(findings);
}

export function findingsFromSarif(sarif, baselineCommit, changedPaths) {
  const validation = validateCodeqlSarif(sarif);
  if (!validation.valid) throw new Error(validation.reason);
  const findings = [];
  for (const run of sarif?.runs ?? []) {
    for (const result of run.results ?? []) {
      const location = result.locations?.[0]?.physicalLocation;
      const file = sarifPath(location?.artifactLocation?.uri ?? "unknown");
      const line = positiveInteger(location?.region?.startLine);
      const rule = safeScannerRule(result.ruleId, "unknown-codeql-rule");
      const category = "security_risk";
      const title = staticRuleTitle("CodeQL", rule);
      findings.push(finding({
        idSeed: staticFindingSeed(category, file, rule),
        category,
        severity: sarifSeverity(result.level),
        confidence: "medium",
        status: "needs_validation",
        title,
        affectedFiles: [file],
        evidence: [compactEvidence({ file, line, rule, message: "CodeQL reported a sanitized data-flow or pattern result at this location." })],
        impact: "The reported flow may cross a security or data-trust boundary.",
        detection: `CodeQL SARIF rule ${rule}`,
        invariant: "HTTP, external, session, and authentication data must not reach sensitive sinks without validation and redaction.",
        remediation: "Trace the complete source-to-sink path, confirm reachability, and make the smallest safe boundary correction.",
        regression: "Add a source-level regression test that exercises the confirmed source-to-sink path.",
        sourceTool: `CodeQL:${rule}`,
        baselineCommit,
        introduced: changedPaths.has(file) ? true : false,
      }));
    }
  }
  return deduplicateFindings(findings);
}

export function validateCodeqlSarif(sarif) {
  if (!isPlainObject(sarif) || sarif.version !== "2.1.0" || !Array.isArray(sarif.runs) || sarif.runs.length === 0) {
    return { valid: false, reason: "CodeQL import is not a SARIF 2.1.0 document with at least one run." };
  }
  for (const [index, run] of sarif.runs.entries()) {
    if (!isPlainObject(run)
      || !isPlainObject(run.tool)
      || !isPlainObject(run.tool.driver)
      || typeof run.tool.driver.name !== "string"
      || !/codeql/i.test(run.tool.driver.name)
      || !Array.isArray(run.results)
      || run.results.some((result) => !isPlainObject(result))) {
      return { valid: false, reason: `CodeQL import run ${index} is malformed, is not produced by a CodeQL tool driver, or has no results array.` };
    }
  }
  return { valid: true, reason: null };
}

export function graphifyFreshnessFinding(graphify, baselineCommit) {
  if (graphify.fresh || graphify.status === "unavailable") return [];
  return [finding({
    idSeed: "graphify:stale",
    category: "documentation_configuration_gap",
    severity: "P2",
    confidence: "high",
    status: "confirmed",
    title: "Graphify architecture evidence is stale for the current checkout",
    affectedFiles: ["graphify-out/GRAPH_REPORT.md", ...graphify.missingCandidates.slice(0, 20), ...graphify.mismatchedEntries.slice(0, 20).map((entry) => entry.path)],
    evidence: [{ message: `Commit matches: ${graphify.commitMatches}; hash mismatches: ${graphify.mismatchedEntries.length}; missing graph candidates: ${graphify.missingCandidates.length}.` }],
    impact: "Architecture and coupling conclusions may omit or misattribute current source changes.",
    detection: "Audit manifest Graphify commit/hash/candidate comparison.",
    invariant: "Graphify must represent the exact audited source checkout, including source-like dirty files.",
    remediation: "Run graphify update . after audit-harness changes, then regenerate the inventory manifest.",
    regression: "Require graphify freshness to report commitMatches=true, no hash mismatches, and no missing graph candidates.",
    sourceTool: "graphify-freshness",
    baselineCommit,
    introduced: true,
  })];
}

export function deduplicateFindings(findings) {
  validateFindings(findings);
  const unique = new Map();
  for (const item of [...findings].sort(compareFindings)) {
    const existing = unique.get(item.id);
    unique.set(item.id, existing ? mergeFindings(existing, item) : cloneFinding(item));
  }
  const reconciled = [...unique.values()].sort(compareFindings);
  validateFindings(reconciled);
  return reconciled;
}

export function validateFindings(value) {
  if (!Array.isArray(value)) throw new Error("Findings must be an array.");
  for (const item of value) validateFinding(item);
  return value;
}

export function validateFinding(item) {
  assertPlainObject(item, "Finding");
  assertExactKeys(item, new Set(REQUIRED_FIELDS), `Finding ${item.id ?? "<unknown>"}`);
  if (!FINDING_ID_PATTERN.test(item.id)) throw new Error(`Invalid finding id: ${item.id}`);
  if (!CATEGORIES.has(item.category)) throw new Error(`Invalid finding category: ${item.category}`);
  if (!SEVERITIES.has(item.severity)) throw new Error(`Invalid finding severity: ${item.severity}`);
  if (!CONFIDENCES.has(item.confidence)) throw new Error(`Invalid finding confidence: ${item.confidence}`);
  if (!STATUSES.has(item.status)) throw new Error(`Invalid finding status: ${item.status}`);
  assertNonemptyString(item.title, `Finding ${item.id} title`);
  assertUniqueStringArray(item.affected_files, `Finding ${item.id} affected_files`);
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) throw new Error(`Finding ${item.id} evidence must be a nonempty array.`);
  for (const [index, evidence] of item.evidence.entries()) validateEvidence(evidence, `${item.id} evidence[${index}]`);
  for (const field of ["impact", "reproduction_or_detection_method", "expected_invariant", "recommended_remediation", "required_regression_test", "source_tool"]) {
    assertNonemptyString(item[field], `Finding ${item.id} ${field}`);
  }
  if (!COMMIT_PATTERN.test(item.baseline_commit)) throw new Error(`Finding ${item.id} has invalid baseline_commit.`);
  if (![true, false, null].includes(item.introduced_in_current_checkout)) throw new Error(`Finding ${item.id} has invalid checkout attribution.`);
  return item;
}

export function validateBaselineFindingsRegistry(value) {
  assertPlainObject(value, "Baseline findings registry");
  assertExactKeys(value, BASELINE_REGISTRY_FIELDS, "Baseline findings registry");
  if (value.schemaVersion !== "1.0.0") throw new Error("Unsupported baseline findings schemaVersion.");
  if (value.baselineCommit !== null && !COMMIT_PATTERN.test(value.baselineCommit)) throw new Error("Invalid baselineCommit in baseline findings registry.");
  if (value.reviewedAt !== null && !isIsoDate(value.reviewedAt)) throw new Error("Invalid reviewedAt in baseline findings registry.");
  if (value.reviewedBy !== null) assertNonemptyString(value.reviewedBy, "Baseline reviewedBy");
  assertNonemptyString(value.policy, "Baseline policy");
  assertUniqueFindingIdArray(value.findingIds, "Baseline findingIds");
  if (value.findingIds.length && (!value.baselineCommit || !value.reviewedAt || !value.reviewedBy)) {
    throw new Error("A nonempty baseline requires baselineCommit, reviewedAt, and reviewedBy.");
  }
  return value;
}

export function baselineFindingIds(value) {
  validateBaselineFindingsRegistry(value);
  return new Set(value.findingIds);
}

export function validateReviewedFindingsRegistry(value) {
  assertPlainObject(value, "Reviewed findings registry");
  assertExactKeys(value, REVIEW_REGISTRY_FIELDS, "Reviewed findings registry");
  if (value.schemaVersion !== "1.0.0") throw new Error("Unsupported reviewed findings schemaVersion.");
  assertNonemptyString(value.policy, "Reviewed findings policy");
  if (!Array.isArray(value.promotions)) throw new Error("Reviewed findings promotions must be an array.");
  const seen = new Set();
  for (const [index, promotion] of value.promotions.entries()) {
    const label = `Reviewed promotion[${index}]`;
    assertPlainObject(promotion, label);
    assertExactKeys(promotion, REVIEW_PROMOTION_FIELDS, label);
    if (!FINDING_ID_PATTERN.test(promotion.findingId)) throw new Error(`${label} has an invalid findingId.`);
    if (seen.has(promotion.findingId)) throw new Error(`Duplicate reviewed promotion: ${promotion.findingId}`);
    seen.add(promotion.findingId);
    if (!["P0", "P1"].includes(promotion.severity)) throw new Error(`${label} severity must be P0 or P1.`);
    if (promotion.status !== "confirmed" || promotion.confidence !== "high") throw new Error(`${label} must explicitly record confirmed/high.`);
    if (promotion.introducedInCurrentCheckout !== true) throw new Error(`${label} must explicitly prove introducedInCurrentCheckout=true.`);
    if (!COMMIT_PATTERN.test(promotion.baselineCommit)) throw new Error(`${label} has an invalid baselineCommit.`);
    if (!isIsoDate(promotion.reviewedAt)) throw new Error(`${label} has an invalid reviewedAt.`);
    for (const field of ["reviewedBy", "reviewEvidence", "introductionEvidence"]) assertNonemptyString(promotion[field], `${label} ${field}`);
  }
  return value;
}

export function applyReviewedPromotions(findings, registry) {
  validateFindings(findings);
  const promotions = reviewedPromotionMap(registry);
  return findings.map((item) => {
    const promotion = promotions.get(item.id);
    if (!promotion) return cloneFinding(item);
    if (item.baseline_commit.toLowerCase() !== promotion.baselineCommit.toLowerCase()) {
      throw new Error(`Reviewed promotion ${item.id} targets a different baseline commit.`);
    }
    return validateFinding({
      ...cloneFinding(item),
      severity: promotion.severity,
      confidence: "high",
      status: "confirmed",
      introduced_in_current_checkout: true,
      evidence: [...item.evidence, {
        message: `Manual review by ${promotion.reviewedBy} at ${promotion.reviewedAt}: ${promotion.reviewEvidence} Introduction evidence: ${promotion.introductionEvidence}`,
      }],
    });
  }).sort(compareFindings);
}

export function blockingFindings(findings, baselineRegistry, reviewedRegistry = null) {
  validateFindings(findings);
  const baselineIds = baselineFindingIds(baselineRegistry);
  if (!reviewedRegistry) return [];
  const promotions = reviewedPromotionMap(reviewedRegistry);
  return findings.filter((item) => {
    const promotion = promotions.get(item.id);
    return promotion
      && ["P0", "P1"].includes(item.severity)
      && item.severity === promotion.severity
      && item.confidence === "high"
      && item.status === "confirmed"
      && item.introduced_in_current_checkout === true
      && item.baseline_commit.toLowerCase() === promotion.baselineCommit.toLowerCase()
      && !baselineIds.has(item.id);
  });
}

function finding({ idSeed, category, severity, confidence, status, title, affectedFiles, evidence, impact, detection, invariant, remediation, regression, sourceTool, baselineCommit, introduced }) {
  return validateFinding({
    id: findingId(idSeed),
    category,
    severity,
    confidence,
    status,
    title: clean(title),
    affected_files: [...new Set(affectedFiles.filter(Boolean).map(normalizeRepoPath))].sort(compareText),
    evidence,
    impact: clean(impact),
    reproduction_or_detection_method: clean(detection),
    expected_invariant: clean(invariant),
    recommended_remediation: clean(remediation),
    required_regression_test: clean(regression),
    source_tool: clean(sourceTool),
    baseline_commit: String(baselineCommit ?? ""),
    introduced_in_current_checkout: introduced,
  });
}

function findingId(seed) {
  return `VEY-${crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 12).toUpperCase()}`;
}

function staticFindingSeed(category, file, rule) {
  return `static:${category}:${normalizeRepoPath(file).toLowerCase()}:${safeScannerRule(rule, "unknown-rule").toLowerCase()}`;
}

function staticRuleTitle(tool, rule) {
  return `${tool} static-analysis rule ${safeScannerRule(rule, "unknown-rule")}`;
}

function safeScannerRule(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._:/@-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
  return normalized || fallback;
}

function mergeFindings(left, right) {
  if (left.baseline_commit.toLowerCase() !== right.baseline_commit.toLowerCase()) {
    throw new Error(`Cannot reconcile ${left.id} across different baseline commits.`);
  }
  const statuses = [left.status, right.status];
  const merged = {
    ...left,
    severity: strongest(SEVERITY_RANK, left.severity, right.severity),
    confidence: strongest(CONFIDENCE_RANK, left.confidence, right.confidence),
    status: statuses.every((status) => status === "confirmed")
      ? "confirmed"
      : statuses.every((status) => status === "accepted_false_positive") ? "accepted_false_positive" : "needs_validation",
    title: deterministicText(left.title, right.title),
    affected_files: [...new Set([...left.affected_files, ...right.affected_files])].sort(compareText),
    evidence: uniqueEvidence([...left.evidence, ...right.evidence]),
    impact: joinDistinct(left.impact, right.impact),
    reproduction_or_detection_method: joinDistinct(left.reproduction_or_detection_method, right.reproduction_or_detection_method),
    expected_invariant: joinDistinct(left.expected_invariant, right.expected_invariant),
    recommended_remediation: joinDistinct(left.recommended_remediation, right.recommended_remediation),
    required_regression_test: joinDistinct(left.required_regression_test, right.required_regression_test),
    source_tool: [...new Set([...left.source_tool.split(", "), ...right.source_tool.split(", ")])].sort(compareText).join(", "),
    introduced_in_current_checkout: mergeAttribution(left.introduced_in_current_checkout, right.introduced_in_current_checkout),
  };
  return validateFinding(merged);
}

const SEVERITY_RANK = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });
const CONFIDENCE_RANK = Object.freeze({ high: 0, medium: 1, low: 2 });

function strongest(rank, left, right) {
  return rank[left] <= rank[right] ? left : right;
}

function mergeAttribution(left, right) {
  if (left === right) return left;
  if (left == null) return right;
  if (right == null) return left;
  return null;
}

function uniqueEvidence(evidence) {
  const unique = new Map();
  for (const item of evidence) unique.set(stableJson(item), { ...item });
  return [...unique.values()].sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function cloneFinding(item) {
  return { ...item, affected_files: [...item.affected_files], evidence: item.evidence.map((entry) => ({ ...entry, ...(entry.installed_versions ? { installed_versions: [...entry.installed_versions] } : {}) })) };
}

function reviewedPromotionMap(registry) {
  validateReviewedFindingsRegistry(registry);
  return new Map(registry.promotions.map((promotion) => [promotion.findingId, promotion]));
}

function validateEvidence(value, label) {
  assertPlainObject(value, label);
  if (!Object.keys(value).length) throw new Error(`${label} must not be empty.`);
  for (const key of Object.keys(value)) if (!EVIDENCE_FIELDS.has(key)) throw new Error(`${label} has unsupported property ${key}.`);
  for (const field of ["message", "artifact", "stdout_artifact", "stderr_artifact", "advisory", "file", "rule"]) {
    if (field in value) assertNonemptyString(value[field], `${label} ${field}`);
  }
  if ("line" in value && (!Number.isInteger(value.line) || value.line < 1)) throw new Error(`${label} line must be a positive integer.`);
  if ("installed_versions" in value) assertUniqueStringArray(value.installed_versions, `${label} installed_versions`);
}

function compactEvidence(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && (!Array.isArray(item) || item.length)));
}

function parsePackageLock(value) {
  if (value == null) return null;
  if (typeof value === "string") return parseJson(value);
  return value && typeof value === "object" ? value : null;
}

function installedVersionsFor(vulnerability, lock) {
  if (!lock || typeof lock !== "object") return [];
  const versions = new Set();
  for (const rawNode of Array.isArray(vulnerability.nodes) ? vulnerability.nodes : []) {
    const node = normalizeRepoPath(String(rawNode)).replace(/^\.\//, "");
    const version = lock.packages?.[node]?.version;
    if (typeof version === "string" && version.trim()) versions.add(version.trim());
  }
  const direct = lock.packages?.[`node_modules/${vulnerability.name}`]?.version ?? lock.dependencies?.[vulnerability.name]?.version;
  if (typeof direct === "string" && direct.trim()) versions.add(direct.trim());
  const pending = [lock.dependencies];
  const visited = new Set();
  while (pending.length) {
    const dependencies = pending.pop();
    if (!dependencies || typeof dependencies !== "object" || visited.has(dependencies)) continue;
    visited.add(dependencies);
    for (const [name, dependency] of Object.entries(dependencies)) {
      if (!dependency || typeof dependency !== "object") continue;
      if (name === vulnerability.name && typeof dependency.version === "string" && dependency.version.trim()) versions.add(dependency.version.trim());
      pending.push(dependency.dependencies);
    }
  }
  return [...versions].sort(compareVersions);
}

function npmSeverity(value) {
  if (["critical", "high"].includes(String(value).toLowerCase())) return "P1";
  if (String(value).toLowerCase() === "moderate") return "P2";
  return "P3";
}

function semgrepSeverity(value) {
  if (String(value).toUpperCase() === "ERROR") return "P1";
  if (String(value).toUpperCase() === "WARNING") return "P2";
  return "P3";
}

function sarifSeverity(value) {
  if (String(value).toLowerCase() === "error") return "P1";
  if (String(value).toLowerCase() === "warning") return "P2";
  return "P3";
}

function semgrepCategory(metadata = {}) {
  const text = `${metadata?.category ?? ""} ${metadata?.technology ?? ""}`.toLowerCase();
  if (text.includes("security")) return "security_risk";
  if (text.includes("correctness")) return "confirmed_bug";
  return "security_risk";
}

function semgrepConfidence(value) {
  const normalized = String(value ?? "").toLowerCase();
  return CONFIDENCES.has(normalized) ? normalized : "medium";
}

function describeNpmFix(fixAvailable) {
  if (fixAvailable === true) return "Review and apply the compatible npm remediation in a separate approved fix phase; do not run npm audit fix from the audit.";
  if (fixAvailable && typeof fixAvailable === "object") {
    return `Review an intentional upgrade to ${fixAvailable.name ?? "the affected package"} ${fixAvailable.version ?? "a remediated version"}; major-version risk: ${Boolean(fixAvailable.isSemVerMajor)}.`;
  }
  return "No automatic remediation is reported; validate reachability and evaluate a compatible replacement or upstream fix separately.";
}

function sarifPath(value) {
  const raw = safeDecodeURIComponent(String(value ?? "unknown"));
  if (!/^file:/i.test(raw)) return normalizeRepoPath(raw);
  try {
    const pathname = safeDecodeURIComponent(new URL(raw).pathname).replace(/^\/([A-Za-z]:\/)/, "$1");
    return normalizeRepoPath(pathname);
  } catch {
    return normalizeRepoPath(raw.replace(/^file:\/+/i, ""));
  }
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be a plain object.`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function assertExactKeys(value, allowed, label) {
  for (const field of allowed) if (!(field in value)) throw new Error(`${label} is missing ${field}.`);
  for (const field of Object.keys(value)) if (!allowed.has(field)) throw new Error(`${label} has unsupported property ${field}.`);
}

function assertNonemptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string.`);
}

function assertUniqueStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${label} must be an array of nonempty strings.`);
  if (new Set(value).size !== value.length) throw new Error(`${label} must contain unique values.`);
}

function assertUniqueFindingIdArray(value, label) {
  assertUniqueStringArray(value, label);
  for (const id of value) if (!FINDING_ID_PATTERN.test(id)) throw new Error(`${label} contains invalid finding id ${id}.`);
}

function isIsoDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function deterministicText(left, right) {
  return compareText(left, right) <= 0 ? left : right;
}

function joinDistinct(left, right) {
  return left === right ? left : [left, right].sort(compareText).join(" | ");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function compareVersions(left, right) {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), "en", { sensitivity: "base" });
}

function compareFindings(left, right) {
  return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id);
}
