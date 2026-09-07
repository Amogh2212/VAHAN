import path from "node:path";

export const AUDIT_SCHEMA_VERSION = "1.0.0";

export const DEFAULT_OUTPUT_DIRECTORY = "audit-output";

export const EXCLUDED_PREFIXES = Object.freeze([
  ".git/",
  ".local/",
  ".playwright-cli/",
  "audit-output/",
  "backups/",
  "data/",
  "graphify-out/",
  "logs/",
  "node_modules/",
  "output/",
  "reports/",
  "tmp/",
  "ui-preview-screenshots/",
]);

export const GENERATED_PREFIXES = Object.freeze([
  "audit-output/",
  "backups/",
  "data/",
  "graphify-out/",
  "logs/",
  "node_modules/",
  "output/",
  "reports/",
  "tmp/",
  "ui-preview-screenshots/",
]);

export const GENERATED_EXTENSIONS = new Set([
  ".log",
]);

export const INCLUDED_DIRECTORIES = Object.freeze([
  ".github/workflows/",
  "audit/",
  "db/",
  "docs/",
  "lib/",
  "public/",
  "routes/",
  "scripts/",
]);

export const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".py",
  ".sql",
  ".txt",
  ".vbs",
  ".yaml",
  ".yml",
]);

export const ALLOWED_ENV_TEMPLATES = new Set([
  ".env.example",
  ".env.cockroach.test.example",
  "example.env",
]);

export const ROOT_SOURCE_FILES = new Set([
  ".gitignore",
  ".graphifyignore",
  ".semgrepignore",
]);

export const REQUIRED_TABLES = Object.freeze([
  "registrations",
  "maker_registrations",
  "users",
  "sessions",
  "request_rate_limits",
  "telegram_link_codes",
  "tracked_queries",
  "tracked_query_runs",
  "tracked_query_observations",
  "rto_daily_snapshot_configs",
  "rto_daily_pins",
  "rto_daily_collection_runs",
  "rto_daily_jobs",
  "rto_daily_scrape_reports",
  "rto_daily_snapshots",
  "rto_monthly_snapshot_aggregates",
  "rto_daily_run_cohort_members",
  "rto_daily_report_totals",
  "rto_daily_oem_totals",
  "rto_report_batches",
  "rto_reports",
  "rto_report_exports",
  "rto_geo_profiles",
  "rto_external_signals",
  "rto_pattern_findings",
  "rto_factor_sources",
  "rto_factor_documents",
  "rto_factor_events",
  "rto_factor_event_documents",
  "rto_factor_event_targets",
  "rto_factor_validations",
  "rto_factor_validation_controls",
  "rto_factor_validation_documents",
  "rto_report_explanations",
  "rto_report_explanation_documents",
  "rto_report_explanation_reviews",
]);

const queryChecks = [
  ["query-normalization", "scripts/query-normalization-unit-check.mjs"],
  ["query-composition", "scripts/query-composition-unit-check.mjs"],
  ["query-fuzzy", "scripts/query-fuzzy-unit-check.mjs"],
  ["query-routing", "scripts/query-routing-unit-check.mjs"],
  ["query-ai-repair", "scripts/query-ai-repair-unit-check.mjs"],
  ["query-acceptance", "scripts/query-acceptance-check.mjs"],
  ["query-telemetry", "scripts/query-routing-telemetry-unit-check.mjs"],
  ["query-contract", "scripts/query-contract-corpus-check.mjs"],
  ["http-router", "scripts/http-router-unit-check.mjs"],
];

const factorChecks = [
  ["rto-factor-events", "scripts/rto-factor-events-unit-check.mjs"],
  ["rto-factor-event-import", "scripts/rto-factor-event-import-unit-check.mjs"],
  ["rto-factor-source-collector", "scripts/rto-factor-source-collector-unit-check.mjs"],
  ["rto-factor-data", "scripts/rto-factor-data-unit-check.mjs"],
  ["rto-factor-validation", "scripts/rto-factor-validation-unit-check.mjs"],
  ["rto-factor-narrative", "scripts/rto-factor-narrative-unit-check.mjs"],
  ["rto-factor-agent", "scripts/rto-factor-agent-unit-check.mjs"],
  ["rto-factor-daily-automation", "scripts/rto-factor-daily-automation-unit-check.mjs"],
];

export const DETERMINISTIC_COMMANDS = Object.freeze([
  command("audit-source-syntax", "scripts/audit-source-syntax-check.mjs", "tests", 180_000),
  command("audit-harness", "scripts/audit-unit-check.mjs", "tests", 180_000),
  ...queryChecks.map(([id, script]) => command(id, script, "data_correctness")),
  command("security-unit", "scripts/security-unit-check.mjs", "security"),
  command("secret-scan", "scripts/secret-scan.mjs", "security"),
  command("vahan-scraper-unit", "scripts/vahan-scraper-unit-check.mjs", "runtime_safety"),
  command("monthly-oem-unit", "scripts/monthly-oem-unit-check.mjs", "data_correctness"),
  command("rto-daily-unit", "scripts/rto-daily-unit-check.mjs", "runtime_safety", 180_000),
  command("rto-reports-unit", "scripts/rto-reports-unit-check.mjs", "data_correctness", 180_000),
  ...factorChecks.map(([id, script]) => command(id, script, "data_trust")),
  command("rto-insights-unit", "scripts/rto-insights-unit-check.mjs", "data_trust"),
  command("daily-ev-report-unit", "scripts/daily-ev-report-try-unit-check.mjs", "data_correctness"),
  command("local-regression", "scripts/local-regression-check.mjs", "tests", 300_000),
  command("production-smoke", "scripts/production-smoke-check.mjs", "security", 180_000),
]);

export const CI_COMMAND_IDS = new Set([
  "audit-source-syntax",
  "audit-harness",
  "security-unit",
  "secret-scan",
  "query-contract",
  "http-router",
  "vahan-scraper-unit",
  "rto-daily-unit",
  "rto-reports-unit",
  "rto-factor-agent",
]);

export const GRAPHIFY_QUERIES = Object.freeze([
  "How does server.mjs compose routes, security, authentication, database access, and background services?",
  "How does queryData enforce deterministic parsing and keep AI repair subordinate to validation?",
  "How do the VAHAN scraper, RTO daily queue, heartbeats, retries, completion, and report_total persistence connect?",
  "Where are transaction boundaries and database write helpers owned?",
  "How do factor-agent evidence, validation, explanation, and human approval boundaries connect?",
  "Where are authentication, CSRF, rate limiting, health, and readiness enforced?",
  "Which high-connectivity functions have duplicated ownership or unsafe cross-module assumptions?",
]);

export const COVERAGE_DOMAINS = Object.freeze([
  coverage("inventory", ["all included source"], ["manifest"], "Automated source classification, hashing, dirty-state and tool inventory."),
  coverage("architecture", ["server.mjs", "lib", "routes", "scripts", "graphify-out"], ["graphify-freshness", "graphify-query"], "Graphify evidence plus manual reconciliation."),
  coverage("security", ["server.mjs", "lib/http-security.mjs", "routes", ".github/workflows"], ["security-unit", "secret-scan", "semgrep", "codeql"], "Static and hosted data-flow analysis."),
  coverage("dependencies", ["package.json", "package-lock.json"], ["npm-audit"], "Production dependency vulnerability inventory."),
  coverage("data_correctness", ["lib/query-*", "lib/rto-*", "scripts/*unit-check.mjs", "db/schema.sql"], ["query-contract", "rto-daily-unit", "rto-reports-unit", "daily-ev-report-unit"], "Deterministic totals, filter semantics, partial-run and report invariants."),
  coverage("data_trust", ["lib/rto-factor-*", "lib/rto-report-context.mjs"], ["rto-factor-agent", "rto-factor-validation", "rto-factor-narrative"], "Evidence and approval boundaries."),
  coverage("runtime_safety", ["scripts/vahan-scraper.mjs", "scripts/run-rto-daily-snapshots.mjs", "lib/rto-daily-snapshots.mjs"], ["vahan-scraper-unit", "rto-daily-unit", "runtime-readonly"], "No live VAHAN or database writes are permitted."),
  coverage("runtime_readonly", ["db/schema.sql", "deployment configuration"], ["runtime-readonly"], "Optional BEGIN READ ONLY database fingerprint and schema/data sanity."),
  coverage("browser", ["public", "server.mjs", "routes"], ["browser-controlled"], "Controlled loopback browser with outbound requests blocked."),
  coverage("operations", [".github/workflows", "scripts/register-*", "scripts/run-*"], ["workflow-inventory", "manual-review"], "Configuration review only; scheduled jobs are never invoked."),
  coverage("advisory_review", ["all included source"], ["ponytail-manual"], "Optional advisory pass after deterministic evidence; never a CI gate."),
]);

export const FORBIDDEN_SCRIPT_PATTERNS = Object.freeze([
  /^scripts\/apply.*schema/i,
  /^scripts\/backup/i,
  /^scripts\/cockroach-test-runner/i,
  /^scripts\/download/i,
  /^scripts\/import-/i,
  /^scripts\/migrate/i,
  /^scripts\/register-local-db-tasks/i,
  /^scripts\/restore/i,
  /^scripts\/run-rto-daily-snapshots/i,
  /^scripts\/run-rto-factor/i,
  /^scripts\/run-rto-reports/i,
  /^scripts\/run-tracked-queries/i,
  /^scripts\/start-local-postgres/i,
  /^scripts\/vahan-scraper\.mjs$/i,
]);

function command(id, script, domain, timeoutMs = 120_000) {
  return Object.freeze({ id, executable: "node", args: [script], domain, timeoutMs, deterministic: true, gate: true });
}

function coverage(domain, sourceAreas, checks, notes) {
  return Object.freeze({ domain, sourceAreas, checks, notes });
}

export function normalizeRepoPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isRealEnvironmentFile(file) {
  const normalized = normalizeRepoPath(file);
  const name = path.posix.basename(normalized);
  return (name === ".env" || name.startsWith(".env.")) && !ALLOWED_ENV_TEMPLATES.has(normalized);
}

export function isExcludedPath(file) {
  const normalized = normalizeRepoPath(file);
  return isRealEnvironmentFile(normalized) || EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isGeneratedPath(file) {
  const normalized = normalizeRepoPath(file);
  return GENERATED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || GENERATED_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase());
}

export function isSourceLike(file) {
  const normalized = normalizeRepoPath(file);
  if (isExcludedPath(normalized)) return false;
  if (ALLOWED_ENV_TEMPLATES.has(normalized)) return true;
  if (ROOT_SOURCE_FILES.has(normalized)) return true;
  if (INCLUDED_DIRECTORIES.some((prefix) => normalized.startsWith(prefix))) return true;
  return SOURCE_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase());
}

export function safeAuditEnvironment(baseEnvironment = process.env) {
  const environment = {};
  const inheritedName = /^(?:APPDATA|CI|COLORTERM|COMMONPROGRAMFILES(?:\(X86\))?|COMSPEC|FORCE_COLOR|HOME|HOMEDRIVE|HOMEPATH|LANG|LANGUAGE|LC_ALL|LOCALAPPDATA|NO_COLOR|PATH|PATHEXT|PLAYWRIGHT_BROWSERS_PATH|PROGRAMDATA|PROGRAMFILES(?:\(X86\))?|SYSTEMROOT|TEMP|TERM|TMP|TMPDIR|TZ|USERPROFILE|WINDIR)$/i;
  for (const [name, value] of Object.entries(baseEnvironment)) {
    if (inheritedName.test(name) && typeof value === "string") environment[name] = value;
  }
  return {
    ...environment,
    NODE_ENV: "test",
    DATABASE_URL: "",
    REQUIRE_DATABASE_FOR_READINESS: "0",
    AI_QUERY_PROVIDER: "none",
    FACTOR_AGENT_PROVIDER: "none",
    FACTOR_AGENT_ENABLED: "0",
    GEMINI_API_KEY: "",
    GROQ_API_KEY: "",
    OPENAI_API_KEY: "",
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_ENABLE_POLLING: "0",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    VAHAN_DISABLE_LIVE_REFRESH: "1",
    RATE_LIMIT_STORE: "memory",
    ALLOW_IN_MEMORY_RATE_LIMIT: "1",
    BIND_HOST: "127.0.0.1",
  };
}
