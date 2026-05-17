import { spawn } from "node:child_process";
import process from "node:process";
import { closePool, query as dbQuery } from "../lib/db.mjs";

const PORT = Number(process.env.TEST_PORT || 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const knownQueries = [
  { label: "Gujarat EV Apr 2026", query: "Gujarat EV registrations in April 2026" },
  { label: "Punjab diesel Mar 2026", query: "Punjab diesel registrations in March 2026" },
  { label: "Uttarakhand EV 2025", query: "Uttarakhand EV registrations in 2025" },
  { label: "Noida petrol Jan 2026", query: "Noida petrol registrations in January 2026" },
  { label: "Delhi EV Jan 2026", query: "Delhi EV registrations in January 2026" },
];

const newQueries = [
  { label: "Maharashtra Apr 2026", query: "Maharashtra registrations in April 2026", state: "Maharashtra", year: 2026, month: 4 },
  { label: "Karnataka Apr 2026", query: "Karnataka registrations in April 2026", state: "Karnataka", year: 2026, month: 4 },
  { label: "Delhi Apr 2026", query: "Delhi registrations in April 2026", state: "Delhi", year: 2026, month: 4 },
  { label: "Rajasthan Apr 2026", query: "Rajasthan registrations in April 2026", state: "Rajasthan", year: 2026, month: 4 },
  { label: "Punjab Apr 2026", query: "Punjab registrations in April 2026", state: "Punjab", year: 2026, month: 4 },
];

function startServer() {
  const child = spawn(process.execPath, ["--env-file=.env", "server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
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
  if (!response.ok) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return body;
}

async function countMonthRows({ state, year, month }) {
  const result = await dbQuery(
    `
      select count(*)::int as rows, coalesce(sum(vehicle_count), 0)::bigint as total
      from registrations
      where state = $1 and year = $2 and month = $3 and rto = 'All Vahan4 Running Office'
    `,
    [state, year, month],
  );
  return {
    rows: result.rows[0].rows,
    total: Number(result.rows[0].total),
  };
}

function summarizeResult(item, data) {
  return {
    label: item.label,
    query: item.query,
    pass: data.rows.length > 0 && data.summary.total >= 0 && !data.warnings.some((warning) => /multiple RTOs/i.test(warning)),
    dataStatus: data.dataStatus,
    rowCount: data.rows.length,
    total: data.summary.total,
    filters: data.filters,
    scraper: data.scraper,
    warnings: data.warnings,
  };
}

async function main() {
  const server = startServer();
  try {
    const health = await waitForHealth();
    const beforeTotal = (await dbQuery("select count(*)::int as count from registrations")).rows[0].count;

    const known = [];
    for (const item of knownQueries) {
      known.push(summarizeResult(item, await callQuery(item.query)));
    }

    const fresh = [];
    for (const item of newQueries) {
      const before = await countMonthRows(item);
      const result = await callQuery(item.query);
      const after = await countMonthRows(item);
      fresh.push({
        ...summarizeResult(item, result),
        before,
        after,
        savedToNeon: after.rows > before.rows || (before.rows === 0 && after.rows > 0),
      });
    }

    const afterTotal = (await dbQuery("select count(*)::int as count from registrations")).rows[0].count;
    console.log(JSON.stringify({ health, beforeTotal, afterTotal, known, fresh }, null, 2));
  } finally {
    server.child.kill();
    await closePool();
    setTimeout(() => process.exit(0), 250);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
