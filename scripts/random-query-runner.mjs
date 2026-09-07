import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const PORT = Number(process.env.TEST_PORT || 3102);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const COUNT = Number(argValue("--count") || 100);
const SEED = Number(argValue("--seed") || Date.now());
const LIVE = hasFlag("--live");
const RESUME = hasFlag("--resume");
const POLL_MS = Number(argValue("--poll-ms") || 5000);
const RETRY_REFRESH_FAILED_FROM = argValue("--retry-refresh-failed-from");
const OUTPUT =
  argValue("--output") ||
  path.join("reports", `random-query-run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
let stopRequested = false;

const states = [
  "Andhra Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Tamil Nadu",
  "Telangana",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

const cityRtos = [
  { city: "Noida", state: "Uttar Pradesh" },
  { city: "Lucknow", state: "Uttar Pradesh" },
  { city: "Haridwar", state: "Uttarakhand" },
  { city: "Dehradun", state: "Uttarakhand" },
  { city: "Mumbai", state: "Maharashtra" },
  { city: "Pune", state: "Maharashtra" },
  { city: "Delhi RTO", state: "Delhi" },
  { city: "Bengaluru", state: "Karnataka" },
  { city: "Mysore", state: "Karnataka" },
  { city: "Chennai", state: "Tamil Nadu" },
  { city: "Hyderabad", state: "Telangana" },
  { city: "Ahmedabad", state: "Gujarat" },
  { city: "Jaipur", state: "Rajasthan" },
  { city: "Gurugram", state: "Haryana" },
  { city: "Ludhiana", state: "Punjab" },
  { city: "Kolkata", state: "West Bengal" },
  { city: "Patna", state: "Bihar" },
  { city: "Kochi", state: "Kerala" },
  { city: "Bhopal", state: "Madhya Pradesh" },
  { city: "Bhubaneswar", state: "Odisha" },
  { city: "Guwahati", state: "Assam" },
  { city: "Ranchi", state: "Jharkhand" },
  { city: "Raipur", state: "Chhattisgarh" },
  { city: "Vijayawada", state: "Andhra Pradesh" },
];

const ruleTypes = [
  { text: "EV", expect: "fuel segment" },
  { text: "electric", expect: "fuel segment" },
  { text: "hybrid", expect: "fuel family" },
  { text: "diesel", expect: "fuel type" },
  { text: "petrol", expect: "fuel type" },
  { text: "CNG", expect: "fuel type" },
  { text: "", expect: "all fuels" },
];

const vehicleClasses = [
  "cars",
  "motor car",
  "motorcycle",
  "scooter",
  "bus",
  "school bus",
  "goods carrier",
  "tractor",
  "fork lift",
  "e-rickshaw",
  "passenger e-rickshaw",
  "goods e-rickshaw",
  "three wheeler",
  "three wheeler passenger",
  "three wheeler goods",
];

const vehicleCategories = [
  "LMV",
  "HMV",
  "MMV",
  "light motor vehicle",
  "heavy motor vehicle",
  "medium motor vehicle",
];

const templates = [
  ({ rule, vehicle, location, range }) => `${rule} ${vehicle} registrations in ${location} ${range}`,
  ({ rule, vehicle, location, range }) => `${location} ${rule} registrations for ${vehicle} ${range}`,
  ({ rule, vehicle, location, range }) => `show ${rule} ${vehicle} in ${location} from ${range}`,
  ({ rule, vehicle, location, range }) => `${vehicle} ${rule} registrations at ${location} ${range}`,
];

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function mulberry32(seed) {
  return function next() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(SEED);
const pick = (items) => items[Math.floor(random() * items.length)];

function randomDateRange() {
  const startYear = 2024 + Math.floor(random() * 3);
  const startMonth = 1 + Math.floor(random() * (startYear === 2026 ? 6 : 12));
  const maxSpan = Math.min(6, (startYear === 2026 ? 6 : 12) - startMonth + 1);
  const span = Math.floor(random() * maxSpan);
  const endMonth = startMonth + span;
  const monthName = (month) =>
    new Date(Date.UTC(2024, month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  if (span === 0) return `in ${monthName(startMonth)} ${startYear}`;
  return `${monthName(startMonth)} ${startYear} to ${monthName(endMonth)} ${startYear}`;
}

function randomLocation() {
  if (random() < 0.45) return pick(cityRtos);
  const state = pick(states);
  return { city: state, state };
}

function makeQuery(index) {
  const location = randomLocation();
  const rule = pick(ruleTypes);
  const vehiclePool = random() < 0.7 ? vehicleClasses : vehicleCategories;
  const vehicle = pick(vehiclePool);
  const query = pick(templates)({
    rule: rule.text,
    vehicle,
    location: location.city,
    range: randomDateRange(),
  }).replace(/\s+/g, " ").trim();
  return {
    index,
    query,
    generated: {
      state: location.state,
      location: location.city,
      ruleType: rule.expect,
      ruleText: rule.text || "all",
      vehicle,
    },
  };
}

function startServer() {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: "",
      AI_QUERY_PROVIDER: "none",
      FACTOR_AGENT_PROVIDER: "none",
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      OLLAMA_QUERY_MODEL: "qwen3:4b",
      OLLAMA_FACTOR_MODEL: "qwen3:4b",
      OLLAMA_TIMEOUT_MS: "10000",
      GEMINI_API_KEY: "",
      GROQ_API_KEY: "",
      VAHAN_DISABLE_LIVE_REFRESH: LIVE ? "0" : "1",
      TELEGRAM_ENABLE_POLLING: "0",
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
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return response.json();
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw lastError ?? new Error("health check timed out");
}

async function callQuery(text) {
  const response = await fetch(`${BASE_URL}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: text }),
  });
  const body = await response.json();
  return { ok: response.ok, status: response.status, body };
}

async function callRefresh(jobId) {
  const response = await fetch(`${BASE_URL}/api/query-refresh/${encodeURIComponent(jobId)}`);
  const body = await response.json();
  return { ok: response.ok, status: response.status, body };
}

async function waitForRefresh(initialBody) {
  const jobId = initialBody.liveRefresh?.jobId;
  if (!jobId) return { body: initialBody, refreshDurationMs: 0 };

  const startedAt = Date.now();
  let lastBody = initialBody;
  while (!stopRequested) {
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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function compactResult(item, response, finalBody, timings) {
  const body = finalBody ?? response.body;
  const liveRefresh = body.liveRefresh ?? response.body.liveRefresh ?? null;
  const passed =
    response.ok &&
    body.filters?.state &&
    body.filters.from &&
    body.filters.to &&
    Array.isArray(body.rows) &&
    (!LIVE || !liveRefresh || ["complete", "failed"].includes(liveRefresh.status));
  return {
    ...item,
    ok: response.ok,
    passed,
    status: response.status,
    durationMs: timings.durationMs,
    refreshDurationMs: timings.refreshDurationMs ?? 0,
    dataStatus: body.dataStatus ?? null,
    rowCount: body.rows?.length ?? 0,
    total: body.summary?.total ?? null,
    filters: body.filters ?? null,
    scraper: body.scraper ?? null,
    liveRefresh,
    warnings: body.warnings ?? [],
    error: response.ok ? null : body.error ?? "unknown error",
    completedAt: new Date().toISOString(),
  };
}

function summarizeResults(results) {
  return {
    completed: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    okResponses: results.filter((item) => item.ok).length,
    refreshed: results.filter((item) => item.liveRefresh).length,
    refreshCompleted: results.filter((item) => item.liveRefresh?.status === "complete").length,
    refreshFailed: results.filter((item) => item.liveRefresh?.status === "failed").length,
    nonZeroRows: results.filter((item) => item.rowCount > 0).length,
    averageDurationMs: results.length
      ? Math.round(results.reduce((sum, item) => sum + item.durationMs + (item.refreshDurationMs ?? 0), 0) / results.length)
      : 0,
  };
}

function buildQueue() {
  return Array.from({ length: COUNT }, (_, index) => makeQuery(index + 1));
}

async function buildRetryQueue() {
  const source = JSON.parse(await fs.readFile(RETRY_REFRESH_FAILED_FROM, "utf8"));
  return (source.results ?? [])
    .filter((item) => item.liveRefresh?.status === "failed")
    .map((item, index) => ({
      index: index + 1,
      query: item.query,
      generated: item.generated,
      retryOf: {
        report: RETRY_REFRESH_FAILED_FROM,
        index: item.index,
        requiredMonths: item.liveRefresh?.requiredMonths ?? [],
        previousError: item.scraper?.failedRuns?.[0]?.error ?? item.liveRefresh?.error ?? null,
      },
    }));
}

async function loadOrCreateReport(health) {
  if (RESUME && await fileExists(OUTPUT)) {
    const report = JSON.parse(await fs.readFile(OUTPUT, "utf8"));
    report.resumedAt = new Date().toISOString();
    report.health = health;
    report.mode = LIVE ? "live" : "local";
    report.summary = summarizeResults(report.results ?? []);
    return report;
  }

  const queue = RETRY_REFRESH_FAILED_FROM ? await buildRetryQueue() : buildQueue();
  return {
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    seed: SEED,
    count: queue.length,
    mode: LIVE ? "live" : "local",
    sourceReport: RETRY_REFRESH_FAILED_FROM ?? null,
    health,
    queue,
    summary: summarizeResults([]),
    results: [],
  };
}

async function saveReport(report, status = "running") {
  report.updatedAt = new Date().toISOString();
  report.status = status;
  report.summary = summarizeResults(report.results);
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  process.on("SIGINT", () => {
    stopRequested = true;
    console.log("Stop requested; finishing current checkpoint...");
  });
  process.on("SIGTERM", () => {
    stopRequested = true;
  });

  const server = startServer();
  try {
    const health = await waitForHealth();
    const report = await loadOrCreateReport(health);
    const completed = new Set(report.results.map((item) => item.index));
    await saveReport(report, "running");

    for (const item of report.queue) {
      if (stopRequested) break;
      if (completed.has(item.index)) continue;

      const startedAt = Date.now();
      const response = await callQuery(item.query);
      const durationMs = Date.now() - startedAt;
      const refresh = LIVE && response.body.liveRefresh?.status === "pending"
        ? await waitForRefresh(response.body)
        : { body: response.body, refreshDurationMs: 0 };

      if (refresh.stopped) break;

      const result = compactResult(item, response, refresh.body, {
        durationMs,
        refreshDurationMs: refresh.refreshDurationMs,
      });
      report.results.push(result);
      await saveReport(report, "running");
      console.log(`${item.index}/${report.count} ${result.passed ? "PASS" : "FAIL"} ${item.query}`);
    }

    const done = report.results.length >= report.queue.length;
    await saveReport(report, stopRequested && !done ? "stopped" : done ? "complete" : "partial");
    console.log(`Wrote ${OUTPUT}`);
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
