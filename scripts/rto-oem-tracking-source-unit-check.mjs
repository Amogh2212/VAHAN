import assert from "node:assert/strict";
import { annualSourceFixture } from "./fixtures/rto-oem-annual.mjs";
import { fetchOemTrackingBaselineSegment, fetchTrackedOemSegment, validateOemBaselineEvidence, validateOemDailyEvidence, resolveOemTrackingMaker } from "../lib/rto-oem-tracking-source.mjs";
import { RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS } from "../lib/rto-daily-snapshots.mjs";

const context = { state: "Uttarakhand", rto: "DEHRADUN RTO - UK7", fuelGroup: "EV", vehicleCategory: "2W" };
const input = { ...context, ...RTO_DAILY_CATEGORY_FILTERS["2W"], fuels: RTO_DAILY_FUEL_FILTERS.EV };
function fixture({ chart = { labels: ["Maker A", "Maker B"], datasets: [{ data: [15, 10] }] }, total = 25, mapping = ["Maker A", "Maker B"], single = {}, invalidBatch = false } = {}) {
  const annual = annualSourceFixture();
  const requests = [];
  const fetchImpl = async (url) => {
    const u = new URL(url); requests.push(u);
    if (u.pathname.endsWith("/vehicle-makers")) return Response.json(mapping.filter((name) => name.toUpperCase().includes(u.searchParams.get("search").toUpperCase())));
    const ids = u.searchParams.get("vehicleMakers")?.split(",") ?? [];
    if (u.pathname.endsWith("top5Makerchart") && ids.length) return invalidBatch ? new Response("Unavailable", { status: 404 }) : Response.json(chart);
    if (u.pathname.endsWith("dashboardcount") && ids.length) return Response.json({ totalTransactions: String(ids.length === 1 && Object.hasOwn(single, ids[0]) ? single[ids[0]] : total) });
    return annual.fetchImpl(url);
  };
  return { fetchImpl, requests };
}

const f = fixture();
const baseline = await fetchOemTrackingBaselineSegment({ ...input, year: 2025, fetchImpl: f.fetchImpl });
assert.equal(baseline.selectionYear, 2025);
assert.equal(baseline.rankingComplete, false);
assert.deepEqual(baseline.makers.map((m) => m.id), ["Maker A", "Maker B"]);
assert.equal(validateOemBaselineEvidence(baseline, { ...context, selectionYear: 2025 }), true);
assert.ok(baseline.requests.every((url) => new URL(url).searchParams.get("fromYear") === "2025"));
assert.throws(() => validateOemBaselineEvidence({ ...baseline, makers: [{ ...baseline.makers[0], count: 99 }] }, { ...context, selectionYear: 2025 }));
await assert.rejects(resolveOemTrackingMaker("Maker A", { fetchImpl: fixture({ mapping: [] }).fetchImpl }), /missing or ambiguous/);
await assert.rejects(resolveOemTrackingMaker("Maker A", { fetchImpl: fixture({ mapping: ["Maker A", "MAKER A"] }).fetchImpl }), /missing or ambiguous/);
await assert.rejects(resolveOemTrackingMaker("Others"), /named source OEM/);

const tracked = await fetchTrackedOemSegment({ ...input, year: 2026, makers: baseline.makers, fetchImpl: f.fetchImpl });
assert.deepEqual(tracked.makers.map((m) => m.count), [15, 10]);
for (const row of tracked.makers) assert.equal(validateOemDailyEvidence(row.evidence, { ...context, year: 2026, makerId: row.id, makerName: row.name }), true);
const filteredRequests = f.requests.filter((u) => u.searchParams.has("vehicleMakers"));
assert.ok(filteredRequests.every((u) => u.searchParams.get("vehicleMakers") === "Maker A,Maker B"));

const fallback = await fetchTrackedOemSegment({ ...input, year: 2026, makers: baseline.makers,
  fetchImpl: fixture({ chart: { labels: ["Maker A", "Others"], datasets: [{ data: [15, 10] }] }, single: { "Maker B": 10 } }).fetchImpl });
assert.equal(fallback.makers[0].evidence.mode, "batch");
assert.equal(fallback.makers[1].evidence.mode, "individual");
assert.equal(fallback.makers[1].count, 10);
assert.equal(fallback.makers[1].evidence.filterIdentity, tracked.makers[1].evidence.filterIdentity);
assert.equal(validateOemDailyEvidence(fallback.makers[1].evidence, { ...context, year: 2026, makerId: "Maker B", makerName: "Maker B" }), true);

const explicitZero = await fetchTrackedOemSegment({ ...input, year: 2026, makers: baseline.makers, fetchImpl: fixture({ chart: { labels: [], datasets: [{ data: [] }] }, total: 0 }).fetchImpl });
assert.deepEqual(explicitZero.makers.map((m) => m.count), [0, 0]);
assert.equal(validateOemDailyEvidence(explicitZero.makers[0].evidence, { ...context, year: 2026, makerId: "Maker A", makerName: "Maker A" }), true);
const outside = await fetchTrackedOemSegment({ ...input, year: 2026, makers: baseline.makers,
  fetchImpl: fixture({ chart: { labels: ["Foreign OEM"], datasets: [{ data: [25] }] }, single: { "Maker A": 15, "Maker B": 10 } }).fetchImpl });
assert.ok(outside.makers.every((m) => m.evidence.mode === "individual"));
const bad = tracked.makers[0].evidence;
assert.throws(() => validateOemDailyEvidence({ ...bad, count: 999 }, { ...context, year: 2026, makerId: "Maker A", makerName: "Maker A" }));
assert.throws(() => validateOemDailyEvidence(bad, { ...context, year: 2025, makerId: "Maker A", makerName: "Maker A" }));
assert.throws(() => validateOemDailyEvidence(bad, { ...context, year: 2026, makerId: "Maker B", makerName: "Maker B" }));
const { raw, ...compact } = bad;
assert.throws(() => validateOemDailyEvidence(compact, { ...context, year: 2026, makerId: "Maker A", makerName: "Maker A" }));
assert.equal(validateOemDailyEvidence({ ...compact, rawRetained: false }, { ...context, year: 2026, makerId: "Maker A", makerName: "Maker A" }, { allowCompacted: true }), true);
// Worker-owned retries must not multiply the legacy per-endpoint retry default.
for (const mode of ["baseline", "daily"]) {
  const catalogFixture = fixture();
  let catalogAttempts = 0;
  const fetchImpl = async (url) => {
    if (new URL(url).pathname.endsWith("json_rtos")) { catalogAttempts += 1; return new Response("Missing catalog", { status: 404 }); }
    return catalogFixture.fetchImpl(url);
  };
  const request = { ...input, year: mode === "baseline" ? 2025 : 2026, maxRequestAttempts: 1, fetchImpl, makers: baseline.makers };
  await assert.rejects(mode === "baseline" ? fetchOemTrackingBaselineSegment(request) : fetchTrackedOemSegment(request), /HTTP 404/);
  assert.equal(catalogAttempts, 1);
}
const stopped = Object.assign(new Error("Budget exhausted"), { code: "OEM_COLLECTION_STOPPED" });
let calls = 0;
await assert.rejects(fetchTrackedOemSegment({ ...input, year: 2026, makers: baseline.makers, fetchImpl: fixture().fetchImpl, beforeRequest: async () => { if (++calls > 2) throw stopped; } }), (err) => err === stopped);
// A stop after an individual success carries that verified response for the worker's checkpoint.
const interruptedFixture = fixture({ invalidBatch: true, single: { "Maker A": 15, "Maker B": 10 } });
const interruptedStop = Object.assign(new Error("Budget exhausted before the next maker"), { code: "OEM_COLLECTION_STOPPED" });
await assert.rejects(fetchTrackedOemSegment({ ...input, year: 2026, makers: baseline.makers, fetchImpl: interruptedFixture.fetchImpl,
  beforeRequest: async () => {
    if (interruptedFixture.requests.some((url) => url.pathname.endsWith("dashboardcount") && url.searchParams.get("vehicleMakers") === "Maker A")) throw interruptedStop;
  },
}), (error) => {
  assert.equal(error, interruptedStop);
  assert.equal(error.trackingResults.length, 1);
  assert.equal(error.trackingResults[0].id, "Maker A");
  assert.equal(error.trackingResults[0].evidence.mode, "individual");
  assert.equal(validateOemDailyEvidence(error.trackingResults[0].evidence, { ...context, year: 2026, makerId: "Maker A", makerName: "Maker A" }), true);
  return true;
});
console.log("OEM tracking source checks passed: 2025 selection, official identity, saved-only batch/fallback, explicit zeros, evidence integrity, stop propagation and partial checkpoints.");
