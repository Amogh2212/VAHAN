import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { query, closePool } from "../lib/db.mjs";
import { annualOemHtml } from "../lib/rto-oem-annual.mjs";
import { chromium } from "playwright";
const local = new URL(process.env.DATABASE_URL ?? "postgres://invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(local.hostname)) throw new Error("API verification requires local PostgreSQL.");
const saved = (await query("select state,rto,observation_date::text as date from rto_oem_annual_observations where status='verified' order by observed_at desc limit 1")).rows[0];
await closePool();
if (!saved) throw new Error("Collect a local annual OEM pilot before running this check.");
const port = 34500 + process.pid % 500;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server.mjs"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: "test", VAHAN_DISABLE_LIVE_REFRESH: "1", FACTOR_AGENT_ENABLED: "0", TELEGRAM_ENABLE_POLLING: "0", AI_QUERY_PROVIDER: "none" }, stdio: ["ignore", "ignore", "pipe"] });
let stderr = "";
server.stderr.on("data", (chunk) => { stderr += chunk; });
try {
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { healthy = (await fetch(`${base}/health`)).ok; } catch {}
    if (healthy) break;
    if (server.exitCode !== null) throw new Error(stderr);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(healthy, "local server starts");
  const endpoint = `${base}/api/rto-reports/oem-rankings?${new URLSearchParams(saved)}`;
  const response = await fetch(endpoint);
  assert.equal(response.status, 200);
  const ranking = await response.json();
  assert.equal(ranking.metricKind, "registration_calendar_year");
  assert.equal(ranking.segments.length, 6);
  assert.ok(ranking.segments.every((s) => s.status === "verified"));
  assert.ok(ranking.segments.every((s) => s.observationDate === saved.date));
  assert.equal((await fetch(`${base}/api/rto-reports/oem-rankings?state=x&rto=y&date=2026-02-30`)).status, 400);
  const past = await (await fetch(`${base}/api/rto-reports/oem-rankings?${new URLSearchParams({ ...saved, date: "2025-12-31" })}`)).json();
  assert.ok(past.segments.every((s) => s.status === "unavailable" && s.total === null));
  await fs.mkdir("reports", { recursive: true });
  const exportCss = "@page{size:A4;margin:14mm}body{font-family:Segoe UI,sans-serif;color:#182139;margin:24px}h1{font-size:22px}h2{font-size:18px}p{font-size:13px}table{border-collapse:collapse;width:100%;font-size:12px}thead{display:table-header-group}th,td{padding:8px;border-bottom:1px solid #dde1e8;text-align:left}td:nth-child(2){white-space:nowrap}tr{break-inside:avoid}@media print{body{margin:0}}";
  await fs.writeFile(`reports/rto-oem-annual-local-${saved.date}.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Saved local annual OEM evidence</title><style>${exportCss}</style><h1>${ranking.rto.replace(/[&<>]/g, " ")}</h1><p>Verified local saved-data API output. Observed ${saved.date} (IST).</p>${annualOemHtml(ranking)}</html>`);
  // The annual API remains compatible; the interactive report panel now uses saved daily tracking.
  const preview = await fs.readFile(`reports/rto-oem-annual-local-${saved.date}.html`, "utf8");
  await fs.writeFile(`reports/rto-oem-annual-preview-${saved.date}.html`, preview);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1050, height: 850 } });
    await page.setContent(preview);
    const expectedRows = ranking.segments.reduce((sum, segment) => sum + Math.max(1, segment.makers.length), 0);
    assert.equal(await page.locator("tbody tr").count(), expectedRows);
    assert.match(await page.locator("tbody tr").first().innerText(), new RegExp(ranking.segments[0].makers[0].name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
    await page.screenshot({ path: `reports/rto-oem-annual-preview-${saved.date}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator("tbody tr").count(), expectedRows);
    await page.screenshot({ path: `reports/rto-oem-annual-preview-mobile-${saved.date}.png`, fullPage: true });
    await page.setContent(await fs.readFile(`reports/rto-oem-annual-local-${saved.date}.html`, "utf8"));
    await page.pdf({ path: `reports/rto-oem-annual-local-${saved.date}.pdf`, format: "A4", printBackground: true });
  } finally { await browser.close(); }
  console.log(JSON.stringify({ rto: ranking.rto, year: ranking.year, observationDate: saved.date, segments: ranking.segments.map((s) => ({ fuel: s.fuelGroup, category: s.vehicleCategory, total: s.total, namedMakers: s.makers.length, rankingComplete: s.rankingComplete })) }));
  console.log("Local annual OEM API checks passed: saved real data, six combinations, invalid date, and year isolation.");
} finally { server.kill(); }
