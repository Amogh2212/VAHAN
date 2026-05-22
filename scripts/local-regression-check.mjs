import { spawn } from "node:child_process";
import process from "node:process";

const PORT = Number(process.env.TEST_PORT || 3101);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const checks = [
  {
    label: "single month name",
    query: "EV registrations in Maharashtra in Jan 2024",
    expect: {
      state: "Maharashtra",
      fuelSegment: "EV",
      from: "2024-01",
      to: "2024-01",
      minRows: 1,
    },
  },
  {
    label: "dashboard link month format",
    query: "EV registrations in Maharashtra from 2024-01 to 2024-01",
    expect: {
      state: "Maharashtra",
      fuelSegment: "EV",
      from: "2024-01",
      to: "2024-01",
      minRows: 1,
    },
  },
  {
    label: "vehicle class filter",
    query: "diesel fork lift registrations in Maharashtra from Jan 2024 to Jan 2024",
    expect: {
      state: "Maharashtra",
      fuelType: "DIESEL",
      vehicleClass: "FORK LIFT",
      from: "2024-01",
      to: "2024-01",
      minRows: 1,
    },
  },
  {
    label: "city alias stays conservative",
    query: "Noida petrol registrations in January 2026",
    expect: {
      state: "Uttar Pradesh",
      fuelType: "PETROL",
      from: "2026-01",
      to: "2026-01",
    },
  },
];

function startServer() {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: "",
      GEMINI_API_KEY: "",
      VAHAN_DISABLE_LIVE_REFRESH: "1",
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
    await new Promise((resolve) => setTimeout(resolve, 500));
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
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

async function callMapSummary() {
  const response = await fetch(`${BASE_URL}/api/map/summary?from=2025-12&to=2025-12`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertQuery(item, data) {
  const { expect } = item;
  assert(data.liveRefresh === null, `${item.label}: local check should not start live refresh`);
  if (expect.state) assert(data.filters.state === expect.state, `${item.label}: expected state ${expect.state}, got ${data.filters.state}`);
  if (expect.fuelSegment) assert(data.filters.fuelSegment === expect.fuelSegment, `${item.label}: expected fuel segment ${expect.fuelSegment}, got ${data.filters.fuelSegment}`);
  if (expect.fuelType) assert(data.filters.fuelType === expect.fuelType, `${item.label}: expected fuel type ${expect.fuelType}, got ${data.filters.fuelType}`);
  if (expect.vehicleClass) assert(data.filters.vehicleClasses?.includes(expect.vehicleClass), `${item.label}: expected vehicle class ${expect.vehicleClass}`);
  if (expect.from) assert(data.filters.from === expect.from, `${item.label}: expected from ${expect.from}, got ${data.filters.from}`);
  if (expect.to) assert(data.filters.to === expect.to, `${item.label}: expected to ${expect.to}, got ${data.filters.to}`);
  if (expect.minRows) assert(data.rows.length >= expect.minRows, `${item.label}: expected at least ${expect.minRows} row(s), got ${data.rows.length}`);
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
    const queryResults = [];
    for (const item of checks) {
      const data = await callQuery(item.query);
      assertQuery(item, data);
      queryResults.push({
        label: item.label,
        status: data.dataStatus,
        rows: data.rows.length,
        total: data.summary.total,
      });
    }

    const map = await callMapSummary();
    assert(map.coverage.availableStates > 0, `map summary: expected saved states, got ${map.coverage.availableStates}`);
    assert(map.liveRefresh === null, "map summary: should not start a live refresh");

    console.log(JSON.stringify({
      health,
      queries: queryResults,
      map: {
        availableStates: map.coverage.availableStates,
        rowCount: map.coverage.rowCount,
        latestMonth: map.coverage.latestMonth,
      },
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
