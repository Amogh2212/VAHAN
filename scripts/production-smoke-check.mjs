import { spawn } from "node:child_process";
import process from "node:process";

const PORT = Number(process.env.TEST_PORT || 3110);
let baseUrl = `http://127.0.0.1:${PORT}`;

function startServer(overrides = {}) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "production",
      DATABASE_URL: "",
      REQUIRE_DATABASE_FOR_READINESS: "0",
      APP_BASE_URL: "https://vahan.invalid",
      CSRF_SECRET: "production-smoke-check-secret-at-least-32-characters",
      RATE_LIMIT_STORE: "memory",
      ALLOW_IN_MEMORY_RATE_LIMIT: "1",
      TRUST_PROXY_HOPS: "0",
      AI_QUERY_PROVIDER: "none",
      FACTOR_AGENT_PROVIDER: "none",
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      OLLAMA_QUERY_MODEL: "qwen3:4b",
      OLLAMA_FACTOR_MODEL: "qwen3:4b",
      OLLAMA_TIMEOUT_MS: "10000",
      GEMINI_API_KEY: "",
      GROQ_API_KEY: "",
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_ENABLE_POLLING: "0",
      VAHAN_DISABLE_LIVE_REFRESH: "1",
      MAX_JSON_BODY_BYTES: "1024",
      EXPENSIVE_RATE_LIMIT_WINDOW_MS: "60000",
      EXPENSIVE_RATE_LIMIT_MAX: "4",
      ...overrides,
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

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const { response, body } = await fetchJson("/health");
      if (response.ok) return body;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error("health check timed out");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function postQuery(query) {
  return fetchJson("/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 1500);
  });
}

async function main() {
  const server = startServer();
  try {
    const health = await waitForHealth();
    assert(health.status === "ok", "health should report ok");
    assert(health.liveRefreshDisabled === true, "production smoke should disable live refresh");
    assert(health.queryRouting?.configuredMode === "enforced", "production query routing should default to enforced");
    assert(health.queryRouting?.totalQueries === 0, "initial health should expose zero aggregate query-routing events");

    const ready = await fetchJson("/ready");
    assert(ready.response.ok, `ready should pass without required database, got ${ready.response.status}`);
    assert(ready.response.headers.get("content-security-policy")?.includes("script-src 'self'"), "ready should include a restrictive CSP");
    assert(ready.response.headers.get("strict-transport-security")?.includes("max-age="), "production responses should include HSTS");
    assert(ready.response.headers.get("x-content-type-options") === "nosniff", "ready should disable content sniffing");
    assert(Boolean(ready.response.headers.get("x-request-id")), "ready should include a request id");

    const staticPage = await fetch(`${baseUrl}/index.html`);
    assert(staticPage.ok, `static page should be served, got ${staticPage.status}`);
    assert(staticPage.headers.get("content-security-policy")?.includes("script-src 'self'"), "static pages should include CSP");
    await staticPage.arrayBuffer();

    const me = await fetchJson("/api/me");
    assert(me.response.ok, `/api/me should be public, got ${me.response.status}`);
    assert(me.body.authenticated === false, "/api/me should show unauthenticated without a session");

    const tracked = await fetchJson("/api/tracked-queries");
    assert(tracked.response.status === 401, `tracked queries should require auth, got ${tracked.response.status}`);

    const google = await fetchJson("/auth/google");
    assert(google.response.status === 503, `missing Google config should return 503, got ${google.response.status}`);

    const smokeQueryText = "EV registrations in Maharashtra in Jan 2024";
    const query = await postQuery(smokeQueryText);
    assert(query.response.ok, `query smoke failed with ${query.response.status}: ${query.body.error}`);
    assert(query.body.liveRefresh === null, "live refresh should not start in production smoke");
    const routedHealth = await fetchJson("/health");
    assert(routedHealth.body.queryRouting?.totalQueries === 1, "health should count the completed dashboard query");
    assert(routedHealth.body.queryRouting?.outcomes?.localDeterministicSuccesses === 1, "health should count the local deterministic success");
    assert(!JSON.stringify(routedHealth.body.queryRouting).includes(smokeQueryText), "health telemetry must not contain raw queries");

    const map = await fetchJson("/api/map/summary?from=2025-12&to=2025-12");
    assert(map.response.ok, `map summary failed with ${map.response.status}: ${map.body.error}`);
    assert(map.body.coverage?.availableStates > 0, "map summary should include saved state coverage");

    const oversized = await fetchJson("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "x".repeat(2048) }),
    });
    assert(oversized.response.status === 413, `oversized body should return 413, got ${oversized.response.status}`);

    const spamOne = await fetchJson("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.1" },
      body: JSON.stringify({ query: "Delhi EV registrations in January 2026" }),
    });
    const spamTwo = await fetchJson("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.2" },
      body: JSON.stringify({ query: "Delhi EV registrations in January 2026" }),
    });
    const spamThree = await fetchJson("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.3" },
      body: JSON.stringify({ query: "Delhi EV registrations in January 2026" }),
    });
    assert(spamOne.response.ok, `rate setup query one failed with ${spamOne.response.status}`);
    assert(spamTwo.response.ok, `rate setup query two failed with ${spamTwo.response.status}`);
    assert(spamThree.response.status === 429, `rate limit should return 429, got ${spamThree.response.status}`);

    await stopServer(server.child);
    let missingDatabaseReadinessStatus = null;
    const requiredDbServer = startServer({
      PORT: String(PORT + 1),
      REQUIRE_DATABASE_FOR_READINESS: "1",
    });
    const originalBaseUrl = baseUrl;
    baseUrl = `http://127.0.0.1:${PORT + 1}`;
    try {
      await waitForHealth();
      const missingDbReady = await fetchJson("/ready");
      missingDatabaseReadinessStatus = missingDbReady.response.status;
      assert(missingDbReady.response.status === 503, `missing database readiness should return 503, got ${missingDbReady.response.status}`);
    } finally {
      baseUrl = originalBaseUrl;
      await stopServer(requiredDbServer.child);
    }

    console.log(JSON.stringify({
      health,
      queryRouting: routedHealth.body.queryRouting,
      ready: ready.body,
      query: {
        total: query.body.summary?.total,
        rows: query.body.rows?.length,
      },
      map: {
        availableStates: map.body.coverage?.availableStates,
        rowCount: map.body.coverage?.rowCount,
      },
      protectedRouteStatus: tracked.response.status,
      googleConfigStatus: google.response.status,
      oversizedStatus: oversized.response.status,
      rateLimitStatus: spamThree.response.status,
      missingDatabaseReadinessStatus,
    }, null, 2));
  } finally {
    await stopServer(server.child);
    const output = server.getOutput();
    if (process.exitCode && output) console.error(output);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
