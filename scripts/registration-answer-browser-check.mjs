import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { dashboardPayload } from "../server.mjs";

const root = path.resolve("public");
const filters = { state: "Uttar Pradesh", rto: "Noida - UP16", from: "2026-01", to: "2026-10" };
const counts = [17615, 13474, 14302, 14614, 14696, 14179, 16241, 15592, 17289, 963];
const base = { state: filters.state, rto: filters.rto, year: 2026, fuel_segment: "NON_EV", fuel_filter: "ALL", vehicle_category_filter: "ALL", norms_filter: "ALL", vehicle_class_filter: "ALL" };
const fresh = counts.map((vehicle_count, index) => ({ ...base, month: index + 1, fuel_type: "ALL", vehicle_count, scraped_at: "2026-10-04T12:58:25.174Z" }));
const old = { ...base, month: 1, fuel_type: "PETROL", vehicle_count: 17602, scraped_at: "2026-05-17T06:37:33.390Z" };
const final = dashboardPayload({ filters, rows: [...fresh, old], preFiltered: true, missingMonths: [], liveRefresh: { status: "complete", requiredMonths: ["2026-10"] } });
const initial = dashboardPayload({ filters, rows: [old], preFiltered: true, missingMonths: [], liveRefresh: { jobId: "fixture", status: "pending", requiredMonths: ["2026-10"] } });
let releaseRefresh;
const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/api/me") { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ authenticated: false })); return; }
  if (url.pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
  if (url.pathname === "/api/query" || url.pathname === "/api/query-refresh/fixture") {
    request.resume();
    if (url.pathname === "/api/query-refresh/fixture") await refreshGate;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(url.pathname === "/api/query" ? initial : final));
    return;
  }
  const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(file);
    const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "text/html";
    response.writeHead(200, { "content-type": type });
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
let browser;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?query=${encodeURIComponent("registrations in noida in 2026")}`);
  await page.waitForFunction(() => document.querySelector("#fuelBreakdown")?.textContent.includes("PETROL"));
  releaseRefresh();
  await page.waitForFunction(() => document.querySelector("#total")?.textContent.replace(/\D/g, "") === "138965", null, { timeout: 20000 });
  assert.match(await page.locator("#peak").textContent(), /17,615/);
  assert.match(await page.locator("#fuelBreakdown").textContent(), /unavailable/);
  assert.doesNotMatch(await page.locator("#fuelBreakdown").textContent(), /PETROL|ALL|17,602/);
  await page.locator('.trend-month-hit[data-month="2026-01"]').click();
  assert.match(await page.locator("#fuelBreakdown").textContent(), /unavailable/);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadCsvBtn").evaluate((button) => button.click());
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk.toString();
  assert.match(csv, /Total registrations,138965/);
  assert.doesNotMatch(csv, /228127|35217|PETROL/);
  assert.deepEqual(errors, []);
  await fs.mkdir("outputs", { recursive: true });
  await page.screenshot({ path: "outputs/noida-registration-total-fixed-2026-10-04.png", fullPage: true });
  const restored = await browser.newPage();
  await restored.addInitScript(({ initial }) => {
    sessionStorage.setItem("vahan-dashboard:last-answer:v1", JSON.stringify({
      query: "registrations in noida in 2026", data: { ...initial, liveRefresh: null, summary: { ...initial.summary, total: 228127 } }, savedAt: Date.now(),
    }));
  }, { initial });
  await restored.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.doesNotMatch(await restored.locator("#total").textContent(), /2,28,127|228127/, "old saved answers must not resurrect the incorrect total");
  console.log("Browser checks passed: 1,38,965 total, January 17,615, fresh refresh clears the old fuel chart, month drill-down and CSV export agree.");
} finally {
  releaseRefresh();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
