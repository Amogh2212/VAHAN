import assert from "node:assert/strict";
import {
  PUBLIC_MONTHLY_MAKER_UNAVAILABLE_REASON,
  fetchPublicRtoRegistrationSegment,
  fetchPublicRtoStockSegment,
  parsePublicMonthlyCounts,
  reconcileMonthlyTopMakers,
} from "../lib/public-dashboard-client.mjs";
import { resolvePublicRto, resolvePublicState, publicSelectOptions, verifiedRtoRegistrationSourceSql, verifiedRtoSourceSql } from "../lib/public-dashboard-scope.mjs";
import { validateRtoDailyReport } from "../lib/rto-daily-snapshots.mjs";
import { withRegistrationEvidence } from "./fixtures/rto-stock-evidence.mjs";

const html = `<select id="stateCode"><option value="">All</option><option value="OR">Odisha</option></select>
<select id="vehicleSubCategory"><option value="TWO WHEELER(NT)">TWO WHEELER(NT)</option><option value="TWO WHEELER(T)">TWO WHEELER(T)</option></select>
<select id="vehicleClass"><option value="">All</option></select>
<select id="vehicleFuel"><option value="PURE EV">PURE EV</option><option value="ELECTRIC(BOV)">ELECTRIC(BOV)</option></select>`;
const catalog = [{ stateCode: "OR", rtoCode: 1, rtoName: "BALASORE RTO - OR1" }, { stateCode: "OR", rtoCode: 2, rtoName: "BHUBANESWAR RTO - OR2" }];
const rto = "BALASORE RTO - OD1( 07-NOV-2017 )";
const options = { state: "Odisha", rto, vehicleCategories: ["TWO WHEELER(NT)", "TWO WHEELER(T)"], vehicleClasses: [], fuels: ["PURE EV", "ELECTRIC(BOV)"] };
assert.equal(resolvePublicState(publicSelectOptions(html, "stateCode"), "Odisha").value, "OR");
assert.deepEqual(publicSelectOptions('<select id="x"><option value="A&amp;quot;">Jammu &amp; Kashmir &amp;lt;</option></select>', "x"),
  [{ value: "A&quot;", label: "Jammu & Kashmir &lt;" }], "decode entities once, never recursively");
for (const label of ['<script>alert(1)</script>', '<scr<script>ipt>', '<b>Odisha</b>']) {
  assert.throws(() => publicSelectOptions(`<select id="x"><option value="OR">${label}</option></select>`, "x"), /unexpected markup/);
}
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
    if (u.pathname.endsWith("durationWiseRegistrationTable")) return Response.json([{ yearAsString: "2026 September", registeredVehicleCount: String(total) }]);
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

const monthlyMock = source({ total: 27 });
const monthly = await fetchPublicRtoRegistrationSegment({ ...options, targetMonth: "2026-09", fetchImpl: monthlyMock.fetchImpl });
assert.equal(monthly.total, 27);
assert.equal(monthly.metricKind, "registration_month_to_date");
assert.equal(monthly.validation.contract, "public-registration-mtd-v1");
assert.equal(monthly.validation.calendarType, "3");
assert.equal(monthly.validation.timePeriod, "0");
assert.equal(monthly.filters.targetMonth, "2026-09");
assert.equal(monthly.oem.status, "unavailable");
assert.equal(monthly.oem.reason, PUBLIC_MONTHLY_MAKER_UNAVAILABLE_REASON);
const monthlyRequest = monthlyMock.requests.find((u) => u.pathname.endsWith("durationWiseRegistrationTable"));
assert.deepEqual(monthlyRequest.searchParams.getAll("vehicleFuels[]"), options.fuels);
assert.deepEqual(monthlyRequest.searchParams.getAll("vehicleSubCategories[]"), options.vehicleCategories);
assert.equal(monthlyRequest.searchParams.get("calendarType"), "3");
assert.equal(monthlyRequest.searchParams.get("timePeriod"), "0");
assert.equal(monthlyRequest.searchParams.get("archiveTypePA"), "");
assert.equal(monthlyMock.requests.some((u) => u.pathname.endsWith("top5Makerchart")), false, "unproven yearly maker evidence must not be fetched as monthly OEM data");
await assert.rejects(fetchPublicRtoRegistrationSegment({ ...options, targetMonth: "2026-08", fetchImpl: source({ total: 27 }).fetchImpl }), /missing evidence is not zero/);
assert.throws(() => parsePublicMonthlyCounts([
  { yearAsString: "2026 September", registeredVehicleCount: "27" },
  { yearAsString: "2026 September", registeredVehicleCount: "28" },
], 2026), /duplicate monthly registration rows/,
"duplicate target-month rows must not silently overwrite an observation");
assert.deepEqual(reconcileMonthlyTopMakers({ headlineTotal: 100, makers: [
  { maker: "A", count: 40, rank: 1 }, { maker: "B", count: 25, rank: 2 },
] }), { topFiveTotal: 65, otherUntracked: 35 });
assert.throws(() => reconcileMonthlyTopMakers({ headlineTotal: 10, makers: [{ maker: "A", count: 11, rank: 1 }] }), /exceeds/);

const verifiedDynamicOems = withRegistrationEvidence({
  state: "Uttarakhand",
  rto: "Haridwar RTO",
  status: "success",
  fuelGroup: "EV",
  vehicleCategory: "2W",
  filtersConfirmed: true,
  reportTotal: 100,
  rows: [
    { maker: "Dynamic Maker A", vehicle_count: 40, rank: 1 },
    { maker: "Dynamic Maker B", vehicle_count: 25, rank: 2 },
  ],
  targetMonth: "2026-09",
  scrapedAt: "2026-09-09T08:00:00Z",
}, { oemStatus: "verified" });
assert.equal(validateRtoDailyReport(verifiedDynamicOems), true);
assert.equal(verifiedDynamicOems.rows.length, 2, "a short top-maker response must remain partial; missing makers are not zero-filled");
assert.equal(verifiedDynamicOems.evidence.oem.topFiveTotal, 65);
assert.equal(verifiedDynamicOems.evidence.oem.otherUntracked, 35);
const mismatchedMakerMonth = structuredClone(verifiedDynamicOems);
mismatchedMakerMonth.evidence.oem.validation.requestUrl = mismatchedMakerMonth.evidence.oem.validation.requestUrl.replace("targetMonth=2026-09", "targetMonth=2026-08");
assert.throws(
  () => validateRtoDailyReport(mismatchedMakerMonth),
  /monthly registration source evidence is unverified/i,
  "verified OEM evidence must fail when its target-month request does not match the headline",
);

const report = withRegistrationEvidence({ state: "Uttarakhand", rto: "Haridwar RTO", status: "success", fuelGroup: "EV", vehicleCategory: "2W", filtersConfirmed: true, reportTotal: 20, rows: [], targetMonth: "2026-09", scrapedAt: "2026-09-09T08:00:00Z" });
assert.equal(validateRtoDailyReport(report), true);
for (const mutate of [
  r => { delete r.evidence.validation; },
  r => { r.evidence.validation.mapping.rto = "Other RTO"; },
  r => { r.evidence.validation.timePeriod = "1"; },
  r => { r.evidence.validation.monthToDateTotal = 99; },
  r => { r.evidence.filters.targetMonth = "2026-08"; },
  r => { r.evidence.oem = { status: "unavailable", reason: "", makers: [] }; },
  r => { r.metricKind = "registration_flow"; },
  r => { r.fuelGroup = "ICE"; },
]) { const invalid = structuredClone(report); mutate(invalid); assert.throws(() => validateRtoDailyReport(invalid)); }
assert.match(verifiedRtoSourceSql(), /topMakerRows[\s\S]+s.report_id = r.id/, "readiness must compare actual persisted OEM rows to source evidence");
assert.match(verifiedRtoRegistrationSourceSql(), /registration_month_to_date/, "registration readiness must require the monthly metric");
assert.match(verifiedRtoRegistrationSourceSql(), /calendarType/, "registration readiness must require the monthly source contract");
console.log("RTO source checks passed: exact registration filters, explicit month evidence, stock isolation, and fail-closed OEM handling.");
