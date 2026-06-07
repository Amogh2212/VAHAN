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

    const ready = await fetchJson("/ready");
    assert(ready.response.ok, `ready should pass without required database, got ${ready.response.status}`);

    const me = await fetchJson("/api/me");
    assert(me.response.ok, `/api/me should be public, got ${me.response.status}`);
    assert(me.body.authenticated === false, "/api/me should show unauthenticated without a session");

    const tracked = await fetchJson("/api/tracked-queries");
    assert(tracked.response.status === 401, `tracked queries should require auth, got ${tracked.response.status}`);

    const google = await fetchJson("/auth/google");
    assert(google.response.status === 503, `missing Google config should return 503, got ${google.response.status}`);

    const query = await postQuery("EV registrations in Maharashtra in Jan 2024");
    assert(query.response.ok, `query smoke failed with ${query.response.status}: ${query.body.error}`);
    assert(query.body.liveRefresh === null, "live refresh should not start in production smoke");

    const map = await fetchJson("/api/map/summary?from=2025-12&to=2025-12");
    assert(map.response.ok, `map summary failed with ${map.response.status}: ${map.body.error}`);
    assert(map.body.coverage?.availableStates > 0, "map summary should include saved state coverage");

    const oversized = await fetchJson("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "x".repeat(2048) }),
    });
    assert(oversized.response.status === 413, `oversized body should return 413, got ${oversized.response.status}`);

    const spamOne = await postQuery("Delhi EV registrations in January 2026");
    const spamTwo = await postQuery("Delhi EV registrations in January 2026");
    const spamThree = await postQuery("Delhi EV registrations in January 2026");
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
