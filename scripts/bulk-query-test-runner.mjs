import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const PORT = Number(process.env.TEST_PORT || 3103);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const INPUT = argValue("--input") || path.join("data", "query-tests", "bulk-queries.csv");
const OUTPUT =
  argValue("--output") ||
  path.join("reports", `bulk-query-test-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const MARKDOWN_OUTPUT = argValue("--markdown") || replaceExtension(OUTPUT, ".md");
const FAILED_ONLY_FROM = argValue("--failed-only-from");
const EMIT_REGRESSION_CASES = argValue("--emit-regression-cases");
const POLL_MS = Number(argValue("--poll-ms") || 5000);
const REFRESH_TIMEOUT_MS = Number(argValue("--refresh-timeout-ms") || 600000);
const QUERY_TIMEOUT_MS = Number(argValue("--query-timeout-ms") || 120000);
const NO_LIVE = hasFlag("--no-live");
let stopRequested = false;

const ARRAY_FIELDS = new Set(["vehicleClasses", "vehicleCategories", "norms"]);
const EXPECTATION_FIELDS = new Set([
  "state",
  "rto",
  "from",
  "to",
  "fuelType",
  "fuelSegment",
  "vehicleClasses",
  "vehicleCategories",
  "norms",
  "minRows",
  "total",
  "dataStatus",
]);

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function replaceExtension(filePath, extension) {
  return filePath.replace(/\.[^.\\/]+$/, "") + extension;
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "")
    .split(/[|;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeValue(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  return text;
}

function parseExpected(row) {
  const expect = {};
  for (const field of EXPECTATION_FIELDS) {
    const value = row[field];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    if (ARRAY_FIELDS.has(field)) {
      expect[field] = splitList(value);
    } else if (field === "minRows" || field === "total") {
      const number = Number(value);
      if (Number.isFinite(number)) expect[field] = number;
    } else if (field === "rto" && String(value).trim().toLowerCase() === "null") {
      expect[field] = null;
    } else {
      expect[field] = normalizeValue(value);
    }
  }
  return expect;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);

  const nonEmpty = rows.filter((item) => item.some((cell) => String(cell).trim()));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map((header) => header.trim());
  return nonEmpty.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

async function loadInputRows(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  const rawRows = filePath.toLowerCase().endsWith(".json") ? JSON.parse(text) : parseCsv(text);
  const rows = Array.isArray(rawRows) ? rawRows : rawRows.queries;
  if (!Array.isArray(rows)) throw new Error(`Expected ${filePath} to contain an array of query rows.`);
  return rows.map((row, index) => {
    const query = normalizeValue(row.query);
    if (!query) throw new Error(`Input row ${index + 1} is missing query.`);
    return {
      index: index + 1,
      label: normalizeValue(row.label) || `Query ${index + 1}`,
      query,
      expect: parseExpected(row),
    };
  });
}

async function loadFailedOnlyRows(reportPath) {
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  return (report.results ?? [])
    .filter((item) => !item.passed)
    .map((item, index) => ({
      index: index + 1,
      label: item.label || `Failed query ${index + 1}`,
      query: item.query,
      expect: item.expect ?? {},
      retryOf: {
        report: reportPath,
        index: item.index,
        category: item.category,
        issues: item.issues ?? [],
      },
    }));
}

function startServer() {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      AI_QUERY_PROVIDER: "none",
      FACTOR_AGENT_PROVIDER: "none",
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      OLLAMA_QUERY_MODEL: "qwen3:4b",
      OLLAMA_FACTOR_MODEL: "qwen3:4b",
      OLLAMA_TIMEOUT_MS: "10000",
      GEMINI_API_KEY: "",
      GROQ_API_KEY: "",
      VAHAN_DISABLE_LIVE_REFRESH: NO_LIVE ? "1" : "0",
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_ALLOWED_CHAT_IDS: "",
      TELEGRAM_ENABLE_POLLING: "0",
      TELEGRAM_PUBLIC_DAILY_LIMIT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return { child, getOutput: () => output };
}

async function waitForHealth() {
  const deadline = Date.now() + 30000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return response.json();
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error("health check timed out");
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function callQuery(text) {
  return fetchJsonWithTimeout(
    `${BASE_URL}/api/query`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: text }),
    },
    QUERY_TIMEOUT_MS,
  );
}

async function callRefresh(jobId) {
  return fetchJsonWithTimeout(`${BASE_URL}/api/query-refresh/${encodeURIComponent(jobId)}`, {}, QUERY_TIMEOUT_MS);
}

async function waitForRefresh(initialBody) {
  const jobId = initialBody.liveRefresh?.jobId;
  if (!jobId || NO_LIVE) return { body: initialBody, refreshDurationMs: 0 };

  const startedAt = Date.now();
  let lastBody = initialBody;
  while (!stopRequested) {
    if (Date.now() - startedAt > REFRESH_TIMEOUT_MS) {
      return {
        body: {
          ...lastBody,
          liveRefresh: {
            ...(lastBody.liveRefresh ?? initialBody.liveRefresh),
            status: "failed",
            error: `Timed out after ${REFRESH_TIMEOUT_MS}ms`,
          },
        },
        refreshDurationMs: Date.now() - startedAt,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const response = await callRefresh(jobId);
    lastBody = response.body;
    const status = lastBody.liveRefresh?.status;
    if (!response.ok || status === "complete" || status === "failed") {
      return { body: lastBody, refreshDurationMs: Date.now() - startedAt };
    }
    const required = lastBody.liveRefresh?.requiredMonths?.join(",") ?? "";
    console.log(`  refresh ${jobId}: ${status ?? "unknown"} ${required}`);
  }

  return { body: lastBody, refreshDurationMs: Date.now() - startedAt, stopped: true };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 1500);
  });
}

function arrayIncludesAll(actual, expected) {
  const actualSet = new Set((actual ?? []).map(String));
  return expected.every((item) => actualSet.has(String(item)));
}

function pushMismatch(issues, field, expected, actual) {
  issues.push({
    type: "parser_mismatch",
    field,
    expected,
    actual,
    message: `${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  });
}

function evaluateExpectations(item, body) {
  const expect = item.expect ?? {};
  const filters = body.filters ?? {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const issues = [];

  for (const field of ["state", "rto", "from", "to", "fuelType", "fuelSegment"]) {
    if (Object.hasOwn(expect, field) && filters[field] !== expect[field]) pushMismatch(issues, field, expect[field], filters[field] ?? null);
  }
  if (Object.hasOwn(expect, "vehicleClasses") && !arrayIncludesAll(filters.vehicleClasses, expect.vehicleClasses)) {
    pushMismatch(issues, "vehicleClasses", expect.vehicleClasses, filters.vehicleClasses ?? []);
  }
  if (Object.hasOwn(expect, "vehicleCategories") && !arrayIncludesAll(filters.selectedVehicleCategories, expect.vehicleCategories)) {
    pushMismatch(issues, "vehicleCategories", expect.vehicleCategories, filters.selectedVehicleCategories ?? []);
  }
  if (Object.hasOwn(expect, "norms") && !arrayIncludesAll(filters.selectedNorms, expect.norms)) {
    pushMismatch(issues, "norms", expect.norms, filters.selectedNorms ?? []);
  }
  if (Object.hasOwn(expect, "dataStatus") && body.dataStatus !== expect.dataStatus) {
    issues.push({
      type: "data_mismatch",
      field: "dataStatus",
      expected: expect.dataStatus,
      actual: body.dataStatus ?? null,
      message: `dataStatus: expected ${expect.dataStatus}, got ${body.dataStatus ?? null}`,
    });
  }
  if (Object.hasOwn(expect, "total") && Number(body.summary?.total ?? 0) !== expect.total) {
    issues.push({
      type: "data_mismatch",
      field: "total",
      expected: expect.total,
      actual: Number(body.summary?.total ?? 0),
      message: `total: expected ${expect.total}, got ${Number(body.summary?.total ?? 0)}`,
    });
  }
  if (Object.hasOwn(expect, "minRows") && rows.length < expect.minRows) {
    issues.push({
      type: "data_missing",
      field: "minRows",
      expected: expect.minRows,
      actual: rows.length,
      message: `minRows: expected at least ${expect.minRows}, got ${rows.length}`,
    });
  }
  return issues;
}

function scrapeIssue(body) {
  const liveRefresh = body.liveRefresh;
  if (liveRefresh?.status === "failed") {
    return {
      type: "scrape_failed",
      message: liveRefresh.error || body.scraper?.failedRuns?.[0]?.error || "Live refresh failed",
    };
  }
  return null;
}

function categorize(ok, issues) {
  if (!ok || issues.some((issue) => issue.type === "api_error")) return "api_server_error";
  if (issues.some((issue) => issue.type === "parser_mismatch")) return "parser_mismatch";
  if (issues.some((issue) => issue.type === "scrape_failed")) return "scrape_failed";
  if (issues.some((issue) => issue.type === "data_missing" || issue.type === "data_mismatch")) return "data_missing";
  return "pass";
}

function compactResult(item, response, finalBody, timings) {
  const body = finalBody ?? response.body;
  const issues = [];
  if (!response.ok) {
    issues.push({
      type: "api_error",
      message: body.error ?? `HTTP ${response.status}`,
    });
  } else {
    issues.push(...evaluateExpectations(item, body));
    const refreshIssue = scrapeIssue(body);
    if (refreshIssue) issues.push(refreshIssue);
  }
  const category = categorize(response.ok, issues);
  return {
    ...item,
    ok: response.ok,
    passed: category === "pass",
    category,
    status: response.status,
    durationMs: timings.durationMs,
    refreshDurationMs: timings.refreshDurationMs ?? 0,
    dataStatus: body.dataStatus ?? null,
    rowCount: body.rows?.length ?? 0,
    total: body.summary?.total ?? null,
    filters: body.filters ?? null,
    scraper: body.scraper ?? null,
    liveRefresh: body.liveRefresh ?? response.body.liveRefresh ?? null,
    warnings: body.warnings ?? [],
    issues,
    responseBody: body,
    completedAt: new Date().toISOString(),
  };
}

function summarizeResults(results) {
  const byCategory = Object.fromEntries(["pass", "parser_mismatch", "data_missing", "scrape_failed", "api_server_error"].map((key) => [key, 0]));
  for (const result of results) byCategory[result.category] = (byCategory[result.category] ?? 0) + 1;
  return {
    completed: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    okResponses: results.filter((item) => item.ok).length,
    refreshed: results.filter((item) => item.liveRefresh).length,
    refreshCompleted: results.filter((item) => item.liveRefresh?.status === "complete").length,
    refreshFailed: results.filter((item) => item.liveRefresh?.status === "failed").length,
    nonZeroRows: results.filter((item) => item.rowCount > 0).length,
    byCategory,
    averageDurationMs: results.length
      ? Math.round(results.reduce((sum, item) => sum + item.durationMs + (item.refreshDurationMs ?? 0), 0) / results.length)
      : 0,
  };
}

function markdownTable(rows) {
  if (!rows.length) return "_None_\n";
  const lines = ["| # | Label | Query | Status | Rows | Total | Issues |", "| - | - | - | - | -: | -: | - |"];
  for (const item of rows) {
    lines.push(`| ${item.index} | ${md(item.label)} | ${md(item.query)} | ${md(item.dataStatus ?? item.category)} | ${item.rowCount} | ${item.total ?? ""} | ${md(item.issues.map((issue) => issue.message).join("; ") || "OK")} |`);
  }
  return `${lines.join("\n")}\n`;
}

function md(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function buildMarkdownReport(report) {
  const sections = [
    ["Pass", "pass"],
    ["Parser Mismatch", "parser_mismatch"],
    ["Data Missing Or Mismatch", "data_missing"],
    ["Scrape Failed", "scrape_failed"],
    ["API Or Server Error", "api_server_error"],
  ];
  return [
    "# Bulk Query Test Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Input: ${report.input ?? report.sourceReport}`,
    `JSON report: ${OUTPUT}`,
    "",
    "## Summary",
    "",
    `Completed: ${report.summary.completed}`,
    `Passed: ${report.summary.passed}`,
    `Failed: ${report.summary.failed}`,
    `Refreshed: ${report.summary.refreshed}`,
    `Refresh failed: ${report.summary.refreshFailed}`,
    "",
    ...sections.flatMap(([title, category]) => [
      `## ${title}`,
      "",
      markdownTable(report.results.filter((item) => item.category === category)),
      "",
    ]),
  ].join("\n");
}

async function saveReport(report, status = "running") {
  report.updatedAt = new Date().toISOString();
  report.status = status;
  report.summary = summarizeResults(report.results);
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  await fs.mkdir(path.dirname(MARKDOWN_OUTPUT), { recursive: true });
  await fs.writeFile(MARKDOWN_OUTPUT, buildMarkdownReport(report));
}

function regressionCases(results) {
  return results
    .filter((item) => !item.passed)
    .map((item) => ({
      label: item.label,
      query: item.query,
      expect: {
        state: item.filters?.state ?? undefined,
        rto: item.filters?.rto ?? undefined,
        fuelType: item.filters?.fuelType ?? undefined,
        fuelSegment: item.filters?.fuelSegment ?? undefined,
        selectedVehicleCategories: item.filters?.selectedVehicleCategories?.length ? item.filters.selectedVehicleCategories : undefined,
        vehicleClasses: item.filters?.vehicleClasses?.length ? item.filters.vehicleClasses : undefined,
        selectedNorms: item.filters?.selectedNorms?.length ? item.filters.selectedNorms : undefined,
        from: item.filters?.from ?? undefined,
        to: item.filters?.to ?? undefined,
        minRows: item.rowCount > 0 ? item.rowCount : undefined,
      },
    }));
}

async function emitRegressionCases(results) {
  if (!EMIT_REGRESSION_CASES) return;
  const cases = regressionCases(results);
  const body = `const checks = ${JSON.stringify(cases, null, 2)};\n`;
  await fs.mkdir(path.dirname(EMIT_REGRESSION_CASES), { recursive: true });
  await fs.writeFile(EMIT_REGRESSION_CASES, body);
}

async function buildQueue() {
  return FAILED_ONLY_FROM ? loadFailedOnlyRows(FAILED_ONLY_FROM) : loadInputRows(INPUT);
}

async function main() {
  process.on("SIGINT", () => {
    stopRequested = true;
    console.log("Stop requested; finishing current checkpoint...");
  });
  process.on("SIGTERM", () => {
    stopRequested = true;
  });

  const queue = await buildQueue();
  const server = startServer();
  try {
    const health = await waitForHealth();
    const report = {
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      input: FAILED_ONLY_FROM ? null : INPUT,
      sourceReport: FAILED_ONLY_FROM ?? null,
      mode: NO_LIVE ? "local" : "live",
      health,
      count: queue.length,
      queue,
      summary: summarizeResults([]),
      results: [],
    };
    await saveReport(report, "running");

    for (const item of queue) {
      if (stopRequested) break;
      const startedAt = Date.now();
      let response;
      try {
        response = await callQuery(item.query);
      } catch (error) {
        response = { ok: false, status: 0, body: { error: error.message } };
      }
      const durationMs = Date.now() - startedAt;
      const refresh = !NO_LIVE && response.body.liveRefresh?.status === "pending"
        ? await waitForRefresh(response.body)
        : { body: response.body, refreshDurationMs: 0 };
      if (refresh.stopped) break;

      const result = compactResult(item, response, refresh.body, {
        durationMs,
        refreshDurationMs: refresh.refreshDurationMs,
      });
      report.results.push(result);
      await saveReport(report, "running");
      console.log(`${item.index}/${report.count} ${result.passed ? "PASS" : "FAIL"} ${result.category} ${item.query}`);
    }

    const done = report.results.length >= report.queue.length;
    await saveReport(report, stopRequested && !done ? "stopped" : done ? "complete" : "partial");
    await emitRegressionCases(report.results);
    console.log(`Wrote ${OUTPUT}`);
    console.log(`Wrote ${MARKDOWN_OUTPUT}`);
    if (EMIT_REGRESSION_CASES) console.log(`Wrote ${EMIT_REGRESSION_CASES}`);
    console.log(JSON.stringify(report.summary, null, 2));
    if (report.summary.failed) process.exitCode = 1;
  } finally {
    await stopServer(server.child);
    const output = server.getOutput();
    if (process.exitCode && output) console.error(output);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
