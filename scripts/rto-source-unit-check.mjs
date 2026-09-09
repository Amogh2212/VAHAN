import assert from "node:assert/strict";
import { fetchPublicRtoStockSegment } from "../lib/public-dashboard-client.mjs";
import { resolvePublicRto, resolvePublicState, publicSelectOptions, verifiedRtoSourceSql } from "../lib/public-dashboard-scope.mjs";
import { validateRtoDailyReport } from "../lib/rto-daily-snapshots.mjs";
import { withStockEvidence } from "./fixtures/rto-stock-evidence.mjs";

const html = `<select id="stateCode"><option value="">All</option><option value="OR">Odisha</option></select>
<select id="vehicleSubCategory"><option value="TWO WHEELER(NT)">TWO WHEELER(NT)</option><option value="TWO WHEELER(T)">TWO WHEELER(T)</option></select>
<select id="vehicleClass"><option value="">All</option></select>
<select id="vehicleFuel"><option value="PURE EV">PURE EV</option><option value="ELECTRIC(BOV)">ELECTRIC(BOV)</option></select>`;
const catalog = [{ stateCode: "OR", rtoCode: 1, rtoName: "BALASORE RTO - OR1" }, { stateCode: "OR", rtoCode: 2, rtoName: "BHUBANESWAR RTO - OR2" }];
const rto = "BALASORE RTO - OD1( 07-NOV-2017 )";
const options = { state: "Odisha", rto, vehicleCategories: ["TWO WHEELER(NT)", "TWO WHEELER(T)"], vehicleClasses: [], fuels: ["PURE EV", "ELECTRIC(BOV)"] };
assert.equal(resolvePublicState(publicSelectOptions(html, "stateCode"), "Odisha").value, "OR");
assert.equal(resolvePublicRto(catalog, rto, "OR").rtoCode, 1);
assert.equal(resolvePublicRto([{ ...catalog[0], rtoCode: 501 }], rto, "OR").rtoCode, 501, "use the actual dropdown value, not the label's numeric prefix");
assert.throws(() => resolvePublicRto(catalog, "UNKNOWN OFFICE - OD1", "OR"), /exact RTO mapping/);
assert.throws(() => resolvePublicRto([...catalog, catalog[0]], rto, "OR"), /ambiguous/);
assert.throws(() => resolvePublicRto(catalog, rto, "MH"), /mismatch/);
assert.equal(resolvePublicRto([{ stateCode: "DL", rtoCode: 3, rtoName: "SOUTH DELHI - DL3" }], "SOUTH (LADO SARAI) - DL3", "DL").rtoCode, 3);
assert.throws(() => resolvePublicRto([{ stateCode: "DL", rtoCode: 3, rtoName: "UNKNOWN NEW OFFICE - DL3" }], "SOUTH (LADO SARAI) - DL3", "DL"), /mapping/);

function source({ total = 20, headline = String(total), category = "TWO WHEELER(NT)", makers = [12, 7], invalid = false, status = 200 } = {}) {
  const requests = [];
  const fetchImpl = async (url) => {
    const u = new URL(url); requests.push(u);
    if (u.pathname.endsWith("/vahan")) return new Response(html);
    if (u.pathname.endsWith("/json_rtos")) return Response.json(catalog);
    if (status !== 200) return new Response("blocked", { status });
    if (invalid) return new Response("<html>CAPTCHA</html>");
    if (u.pathname.endsWith("top5Makerchart")) return Response.json({ labels: makers.map((_, i) => `Maker ${i}`), datasets: [{ data: makers }] });
    if (u.pathname.endsWith("categoriesdonutchart")) return Response.json({ labels: total ? [category] : [], data: total ? [total] : [] });
    if (u.pathname.endsWith("dashboardcount")) return Response.json(headline === null ? {} : { totalTransactions: headline });
    throw new Error(`Unexpected request ${u.pathname}`);
  };
  return { requests, fetchImpl };
}
const mock = source();
const segment = await fetchPublicRtoStockSegment({ ...options, fetchImpl: mock.fetchImpl });
assert.equal(segment.total, 20);
assert.equal(segment.validation.contract, "public-stock-v2");
assert.equal(segment.metricKind, "active_stock");
for (const u of mock.requests.filter(u => /chart|dashboardcount/.test(u.pathname))) {
  assert.equal(u.searchParams.get("stateCode"), "OR");
  assert.equal(u.searchParams.get("rtoCode"), "1");
  assert.equal(u.searchParams.get("timePeriod"), "2");
  assert.equal(u.searchParams.get("archiveTypeAC"), "ACTIVE_COMPLIANT");
  assert.equal(u.searchParams.get("archiveTypeANC"), "ACTIVE_NON_COMPLIANT");
  assert.ok(u.searchParams.get("fromYear"));
}
const headlineRequest = mock.requests.find(u => u.pathname.endsWith("dashboardcount"));
assert.deepEqual(headlineRequest.searchParams.getAll("vehicleFuels[]"), options.fuels);
assert.equal((await fetchPublicRtoStockSegment({ ...options, fetchImpl: mock.fetchImpl })).total, 20, "unchanged verified stock is valid, not evidence of new registrations");
for (const [scenario, pattern] of [
  [{ headline: "999999" }, /disagree/],
  [{ category: "MOTOR CAR" }, /outside/],
  [{ makers: [] }, /without a top-maker/],
  [{ makers: [21] }, /exceeds/],
  [{ total: 0, makers: [], headline: null }, /explicitly confirm/],
  [{ invalid: true }, /JSON/],
  [{ status: 429 }, /HTTP 429/],
]) await assert.rejects(fetchPublicRtoStockSegment({ ...options, fetchImpl: source(scenario).fetchImpl }), pattern);
const zero = await fetchPublicRtoStockSegment({ ...options, fetchImpl: source({ total: 0, makers: [] }).fetchImpl });
assert.equal(zero.explicitZero, true);
assert.equal(zero.validation.zeroConfirmed, true);

const report = withStockEvidence({ state: "Uttarakhand", rto: "Haridwar RTO", status: "success", fuelGroup: "EV", vehicleCategory: "2W", filtersConfirmed: true, reportTotal: 20, rows: [{ maker: "A", vehicle_count: 12, rank: 1 }] });
assert.equal(validateRtoDailyReport(report), true);
for (const mutate of [
  r => { delete r.evidence.validation; },
  r => { r.evidence.validation.mapping.rto = "Other RTO"; },
  r => { r.evidence.validation.timePeriod = "1"; },
  r => { r.evidence.validation.headlineTotal = 99; },
  r => { r.evidence.validation.topFiveTotal = 1; },
  r => { r.rows = []; },
  r => { r.metricKind = "registration_flow"; },
  r => { r.fuelGroup = "ICE"; },
]) { const invalid = structuredClone(report); mutate(invalid); assert.throws(() => validateRtoDailyReport(invalid)); }
assert.match(verifiedRtoSourceSql(), /topMakerRows[\s\S]+s.report_id = r.id/, "readiness must compare actual persisted OEM rows to source evidence");
console.log("RTO source checks passed: exact mapping, request scope, corroborated totals, genuine zeroes, failures, and OEM evidence.");
