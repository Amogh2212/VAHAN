import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { runFinalComparison } from "./final-vahan-comparison.mjs";

const PUBLIC_DIR = path.resolve("public");
const QUERY = "Show BS VI diesel motor car registrations in Maharashtra in February 2026";
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vahan-final-browser-"));
let publicApplyCalls = 0;

const server = http.createServer(async (request, response) => {
  const baseUrl = `http://${request.headers.host}`;
  const url = new URL(request.url, baseUrl);
  if (request.method === "GET" && url.pathname === "/health") return sendJson(response, { status: "ok", liveRefreshDisabled: true });
  if (request.method === "POST" && url.pathname === "/api/query") { assert.equal((await readJson(request)).query, QUERY); return sendJson(response, dashboardPayload()); }
  if (request.method === "GET" && url.pathname === "/analytics/json_rtos") return sendJson(response, [{ rtoCode: "MH12", rtoName: "Pune" }]);
  if (request.method === "GET" && url.pathname === "/analytics/publicdashboard/vahandashboard/durationWiseRegistrationTable") { publicApplyCalls += 1; return sendJson(response, [{ yearAsString: "2026-Feb", registeredVehicleCount: "20" }]); }
  if (request.method === "GET" && url.pathname === "/government") return response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(governmentHtml());
  const relativePath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, "index.html")) return response.writeHead(403).end("Forbidden");
  try {
    const body = await fs.readFile(filePath);
    if (!response.headersSent) response.writeHead(200, { "content-type": contentType(filePath) });
    if (!response.writableEnded) response.end(body);
  } catch {
    if (!response.headersSent) response.writeHead(404);
    if (!response.writableEnded) response.end("Not found");
  }
});

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const summary = await runFinalComparison({ deployedUrl: baseUrl, query: QUERY, headed: false, keepOpen: false, allowLiveRefresh: false, channel: "" }, { repoRoot: tempRoot, governmentUrl: `${baseUrl}/government` });
  assert.equal(summary.outcome, "captured");
  assert.equal(summary.government.comparison.status, "match");
  assert.equal(summary.government.comparison.appTotal, 20);
  assert.equal(summary.government.comparison.governmentTotal, 20);
  assert.equal(publicApplyCalls, 1, "the visible Public Dashboard Apply Filters control must request the monthly table");
  assert.equal(path.basename(summary.artifacts.government), "vahan-public-dashboard.png");
  for (const artifact of [summary.artifacts.vahanEy, summary.artifacts.government, summary.artifacts.summary]) assert((await fs.stat(artifact)).size > 0, `${artifact} must be non-empty`);
  const written = JSON.parse(await fs.readFile(summary.artifacts.summary, "utf8"));
  assert.equal(written.government.selectedFilters.state, "Maharashtra");
  assert.deepEqual(written.government.selectedFilters.fuels, ["DIESEL"]);
  assert.deepEqual(written.government.selectedFilters.norms, ["BHARAT STAGE VI"]);
  console.log("Final Vahan comparison browser check passed.");
} finally { await close(server); await fs.rm(tempRoot, { recursive: true, force: true }); }

function dashboardPayload() {
  return { filters: { semanticIntent: QUERY, selectedFuelTypes: ["DIESEL"], selectedVehicleGroups: [], selectedVehicleClasses: ["MOTOR CAR"], selectedVehicleCategories: ["LIGHT MOTOR VEHICLE"], selectedNorms: ["BHARAT STAGE VI"], excludedFuelTypes: [], excludedVehicleGroups: [], excludedVehicleClasses: [], excludedVehicleCategories: [], excludedNorms: [], state: "Maharashtra", rto: null, from: "2026-02", to: "2026-02" }, summary: { total: 20, monthlyAverage: 20, peakMonth: "2026-02", peakMonthCount: 20 }, freshness: { source: "Browser fixture", latestMonth: "2026-02" }, trend: [{ month: "2026-02", count: 20 }], fuelBreakdown: [{ fuelType: "DIESEL", count: 20 }], rows: [], warnings: [], dataStatus: "complete", persistenceStatus: "saved", liveRefresh: null };
}

function governmentHtml() {
  const option = (value) => `<option value="${value}">${value}</option>`;
  return `<!doctype html><html><body>
    <form id="vahanPublicForm"><label>State <select id="stateCode"><option value="">--- Select State ---</option><option value="MH">Maharashtra</option></select></label>
    <label>RTO <select id="rtoCode"><option value="0">--- Select RTO ---</option></select></label>
    <label>From <input id="fromYear" value="2026" /></label><label>To <input id="toYear" value="2026" /></label>
    <input type="radio" id="calendarYear" name="yearType" value="0" /><label for="calendarYear">Calendar Year</label>
    <label>Fuel <select id="vehicleFuel" multiple>${option("DIESEL")}</select></label>
    <label>Sub-Category <select id="vehicleSubCategory" multiple>${option("LIGHT MOTOR VEHICLE")}</select></label>
    <label>Class <select id="vehicleClass" multiple>${option("MOTOR CAR")}</select></label>
    <label>Emission <select id="vehicleEmission" multiple>${option("BHARAT STAGE VI")}</select></label>
    <label>Category Group <select id="vehicleCategoryGroup" multiple>${option("Four Wheeler")}</select></label>
    <button id="applyButton" type="button">Apply Filters</button></form><section id="result"></section>
    <script>
      document.querySelector('#stateCode').addEventListener('change', async () => { const rows = await fetch('/analytics/json_rtos?stateCode=MH').then((r) => r.json()); const select = document.querySelector('#rtoCode'); select.innerHTML = '<option value="0">--- Select RTO ---</option>' + rows.map((row) => '<option value="' + row.rtoCode + '">' + row.rtoName + '</option>').join(''); });
      document.querySelector('#applyButton').addEventListener('click', async () => { const rows = await fetch('/analytics/publicdashboard/vahandashboard/durationWiseRegistrationTable').then((r) => r.json()); document.querySelector('#result').textContent = 'Total Registration ' + rows[0].registeredVehicleCount; });
    </script></body></html>`;
}

async function readJson(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
function sendJson(response, body) { response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
function contentType(filePath) { if (filePath.endsWith(".html")) return "text/html; charset=utf-8"; if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8"; if (filePath.endsWith(".css")) return "text/css"; return "application/octet-stream"; }
function listen(target) { return new Promise((resolve, reject) => { target.once("error", reject); target.listen(0, "127.0.0.1", () => resolve(target.address().port)); }); }
function close(target) { return target.listening ? new Promise((resolve, reject) => target.close((error) => error ? reject(error) : resolve())) : Promise.resolve(); }
