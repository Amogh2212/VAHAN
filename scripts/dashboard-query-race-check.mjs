import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const PORT = Number(process.env.DASHBOARD_RACE_CHECK_PORT ?? 34_000 + (process.pid % 1_000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PUBLIC_DIR = path.resolve("public");
const MAHARASHTRA_QUERY = "light motor vehicle registrations in Maharashtra in 2026";
const DELHI_QUERY = "EV registrations in Delhi in Jan 2026";

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, BASE_URL);
  if (request.method === "POST" && url.pathname === "/api/query") {
    const body = await readJson(request);
    const isMaharashtra = body.query === MAHARASHTRA_QUERY;
    await delay(isMaharashtra ? 350 : 25);
    sendJson(response, dashboardPayload({
      query: body.query,
      state: isMaharashtra ? "Maharashtra" : "Delhi",
      total: isMaharashtra ? 111 : 222,
    }));
    return;
  }

  const relativePath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(filePath);
    response.writeHead(200, { "content-type": contentType(filePath) });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

let browser;
try {
  await listen(server, PORT);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  // Keep the stale request alive so the request-id guard is tested even when
  // browser cancellation is unavailable or a response is already in flight.
  await page.addInitScript(() => {
    const NativeAbortController = window.AbortController;
    window.AbortController = class NonCancellingAbortController extends NativeAbortController {
      abort() {}
    };
  });

  await page.goto(`${BASE_URL}/?query=${encodeURIComponent(MAHARASHTRA_QUERY)}`, { waitUntil: "domcontentloaded" });
  await page.locator("#queryInput").fill(DELHI_QUERY);
  await page.locator("#queryForm").evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => document.querySelector("#total")?.textContent === "222");
  await page.waitForTimeout(500);

  assert.equal(await page.locator("#queryInput").inputValue(), DELHI_QUERY);
  assert.match(await page.locator("#answerHeading").innerText(), /EV registrations in Delhi in Jan 2026/);
  assert.equal(await page.locator("#total").textContent(), "222");
  assert.match(await page.locator("#filters").innerText(), /Delhi/);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadCsvBtn").evaluate((button) => button.click());
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^ev-registrations-in-delhi-in-jan-2026-/);
  const csv = await streamToString(await download.createReadStream());
  assert.match(csv, /Query,EV registrations in Delhi in Jan 2026/);
  assert.match(csv, /Total registrations,222/);
  assert.doesNotMatch(csv, /Maharashtra|111/);
  assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`);

  console.log("Dashboard query race check passed: stale Maharashtra data could not overwrite or label the Delhi result.");
} finally {
  await browser?.close().catch(() => {});
  await close(server);
}

function dashboardPayload({ query, state, total }) {
  return {
    filters: {
      semanticIntent: query,
      semanticConfidence: 1,
      aiProvider: "Browser regression fixture",
      selectedFuelTypes: state === "Delhi" ? ["ELECTRIC(BOV)"] : [],
      selectedVehicleCategories: state === "Maharashtra" ? ["LIGHT MOTOR VEHICLE"] : [],
      state,
      from: "2026-01",
      to: "2026-01",
    },
    summary: {
      total,
      monthlyAverage: total,
      peakMonth: "2026-01",
      peakMonthCount: total,
    },
    freshness: {
      source: "Browser regression fixture",
      latestMonth: "2026-01",
    },
    trend: [{ month: "2026-01", count: total }],
    fuelBreakdown: [{ fuelType: state === "Delhi" ? "ELECTRIC(BOV)" : "PETROL", count: total }],
    rows: [{
      year: 2026,
      month: 1,
      state,
      rto: "ALL",
      fuel_segment: state === "Delhi" ? "EV" : "ICE",
      fuel_type: state === "Delhi" ? "ELECTRIC(BOV)" : "PETROL",
      fuel_filter: "ALL",
      vehicle_category_filter: state === "Maharashtra" ? "LIGHT MOTOR VEHICLE" : "ALL",
      norms_filter: "ALL",
      vehicle_class_filter: "ALL",
      vehicle_count: total,
      scraped_at: "2026-07-27T00:00:00.000Z",
      source_url: "https://example.invalid/browser-regression",
    }],
    warnings: [],
    dataStatus: "complete",
    persistenceStatus: "saved",
    liveRefresh: null,
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, body) {
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listen(target, port) {
  return new Promise((resolve, reject) => {
    target.once("error", reject);
    target.listen(port, "127.0.0.1", resolve);
  });
}

function close(target) {
  if (!target.listening) return Promise.resolve();
  return new Promise((resolve, reject) => target.close((error) => error ? reject(error) : resolve()));
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
