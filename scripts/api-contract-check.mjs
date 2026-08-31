import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";

const PORT = Number(process.env.API_CONTRACT_CHECK_PORT ?? 34_000 + (process.pid % 1_000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
let serverOutput = "";

function assertLocalDatabase() {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname), "API contract checks only run against local PostgreSQL");
}

function startServer() {
  return spawn(process.execPath, ["--env-file=.env", "server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "test",
      AI_QUERY_PROVIDER: "none",
      FACTOR_AGENT_PROVIDER: "none",
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      OLLAMA_QUERY_MODEL: "qwen3:4b",
      OLLAMA_FACTOR_MODEL: "qwen3:4b",
      OLLAMA_TIMEOUT_MS: "10000",
      GEMINI_API_KEY: "",
      GROQ_API_KEY: "",
      PUBLIC_DASHBOARD_DISABLE_LIVE_REFRESH: "1",
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_ENABLE_POLLING: "0",
      FACTOR_AGENT_ENABLED: "0",
      RATE_LIMIT_STORE: "memory",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth(server) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`API contract server exited with code ${server.exitCode}.`);
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for API contract server health.");
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const body = await response.json().catch(() => null);
  return { response, body };
}

function assertErrorContract(result, status, message = null) {
  assert.equal(result.response.status, status);
  assert.equal(typeof result.body?.error, "string", `HTTP ${status} responses must expose a string error field`);
  if (message) assert.match(result.body.error, message);
}

async function main() {
  assertLocalDatabase();
  const server = startServer();
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

  try {
    await waitForHealth(server);

    const me = await requestJson("/api/me");
    assert.equal(me.response.status, 200);
    assert.equal(typeof me.body.authenticated, "boolean");
    assert.ok("user" in me.body);
    assert.ok("csrfToken" in me.body);

    const queryInvalidJson = await requestJson("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assertErrorContract(queryInvalidJson, 400, /valid JSON/i);

    const queryRefreshMissing = await requestJson("/api/query-refresh/does-not-exist");
    assertErrorContract(queryRefreshMissing, 404, /Refresh job not found/i);

    const dailyCoverage = await requestJson("/api/rto-daily/coverage");
    assert.equal(dailyCoverage.response.status, 200);
    assert.equal(typeof dailyCoverage.body.summary, "object");
    assert.equal(typeof dailyCoverage.body.summary.completionPercent, "number");
    assert.equal(typeof dailyCoverage.body.summary.coveragePercent, "number");

    const dailyPins = await requestJson("/api/rto-daily/pins");
    assertErrorContract(dailyPins, 401, /Login required/i);

    const reportsReadiness = await requestJson("/api/rto-reports/readiness");
    assert.equal(reportsReadiness.response.status, 200);
    assert.equal(typeof reportsReadiness.body.eligible, "boolean");
    assert.ok("reason" in reportsReadiness.body);

    const missingReport = await requestJson("/api/rto-reports/999999999");
    assertErrorContract(missingReport, 404, /RTO report not found/i);

    const insightsCoverage = await requestJson("/api/rto-insights/coverage");
    assert.equal(insightsCoverage.response.status, 200);
    assert.equal(typeof insightsCoverage.body.totalRtos, "number");
    assert.equal(typeof insightsCoverage.body.signalRows, "number");

    const factorAdminDisabled = await requestJson("/api/admin/rto-factor-sources");
    assertErrorContract(factorAdminDisabled, 503, /factor agent is disabled/i);

    const unknownRoute = await requestJson("/api/does-not-exist");
    assertErrorContract(unknownRoute, 404, /Route not found/i);

    console.log("API contract checks passed.");
  } finally {
    if (server.exitCode === null) server.kill();
  }
}

main().catch((error) => {
  if (serverOutput.trim()) process.stderr.write(serverOutput);
  console.error(error);
  process.exitCode = 1;
});
