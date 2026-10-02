import assert from "node:assert/strict";
import { annualSourceFixture } from "./fixtures/rto-oem-annual.mjs";
import { fetchAnnualOemSegment, parseAnnualMakers, validateAnnualRequest, annualRankingPayload, getAnnualOemRankings, annualOemHtml, annualOemCsvRows } from "../lib/rto-oem-annual.mjs";
import { RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS } from "../lib/rto-daily-snapshots.mjs";
import { renderRtoReportCsv, renderRtoReportHtml } from "../lib/rto-reports.mjs";
const params = { state: "Uttarakhand", rto: "DEHRADUN RTO - UK7", date: "2026-10-01" };
assert.throws(() => validateAnnualRequest({ ...params, date: "2026-02-30" }), /valid observation/);
assert.throws(() => validateAnnualRequest({ ...params, state: "" }), /required/);
const observations = [];
for (const fuelGroup of ["EV", "ICE"]) for (const vehicleCategory of ["2W", "3W", "4W"]) {
  const source = annualSourceFixture();
  const evidence = await fetchAnnualOemSegment({ ...params, year: 2026, ...RTO_DAILY_CATEGORY_FILTERS[vehicleCategory], fuels: RTO_DAILY_FUEL_FILTERS[fuelGroup], fetchImpl: source.fetchImpl });
  assert.equal(evidence.total, 30);
  const chartRequests = source.requests.filter((u) => !u.pathname.endsWith("/vahan") && !u.pathname.endsWith("json_rtos"));
  assert.equal(chartRequests.length, 3);
  for (const request of chartRequests) {
    assert.equal(request.searchParams.get("timePeriod"), "0");
    assert.equal(request.searchParams.get("fromYear"), "2026");
    assert.equal(request.searchParams.get("toYear"), "2026");
    assert.equal(request.searchParams.has("calendarType"), false);
    assert.deepEqual(request.searchParams.get("vehicleFuels").split(","), RTO_DAILY_FUEL_FILTERS[fuelGroup]);
    assert.deepEqual(request.searchParams.get("vehicleSubCategories").split(","), RTO_DAILY_CATEGORY_FILTERS[vehicleCategory].vehicleCategories);
  }
  observations.push({ fuel_group: fuelGroup, vehicle_category: vehicleCategory, status: "verified", observation_date: params.date, evidence });
}
const ranking = annualRankingPayload(params, observations);
assert.equal(ranking.segments.length, 6);
assert.ok(ranking.segments.every((s) => s.makers.length === 2 && !s.rankingComplete));
assert.ok(ranking.segments.every((s) => s.makers[1].rank === 2));
assert.doesNotMatch(annualOemHtml(ranking), />Others</);
assert.equal(annualOemCsvRows(ranking).filter((r) => r[7] === "Maker A").length, 6);
assert.match(renderRtoReportCsv({ cadence: "weekly", payload: {}, annualOem: ranking }), /Calendar-year OEM registrations/);
for (const cadence of ["daily", "weekly", "monthly"]) {
  const report = { cadence, annualOem: ranking, payload: { cadence, status: "ready", generatedAt: `${params.date}T10:00:00Z`, rto: { name: params.rto }, period: { start: params.date, end: params.date, label: "Test report" }, source: {}, metrics: {}, categories: [], oems: [] } };
  const html = renderRtoReportHtml(report);
  assert.match(html, /Calendar-year OEM registrations/);
  assert.equal((html.match(/Maker A/g) ?? []).length, 6);
}
for (const scenario of [{ categoryTotal: 31 }, { invalidCategory: true }, { counts: [31, 0, 0] }, { labels: [], counts: [] }, { status: 404 }, { counts: [1, 20, 5] }]) {
  await assert.rejects(fetchAnnualOemSegment({ ...params, year: 2026, ...RTO_DAILY_CATEGORY_FILTERS["2W"], fuels: RTO_DAILY_FUEL_FILTERS.EV, maxRequestAttempts: 1, fetchImpl: annualSourceFixture(scenario).fetchImpl }));
}
await assert.rejects(fetchAnnualOemSegment({ ...params, rto: "UNKNOWN OFFICE - UK7", year: 2026, ...RTO_DAILY_CATEGORY_FILTERS["2W"], fuels: RTO_DAILY_FUEL_FILTERS.EV, fetchImpl: annualSourceFixture().fetchImpl }), /mapping/);
for (const counts of [[null], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]]) assert.throws(() => parseAnnualMakers({ labels: ["A"], datasets: [{ data: counts }] }));
assert.throws(() => parseAnnualMakers({ labels: ["A", "a"], datasets: [{ data: [2, 1] }] }), /duplicate/);
// An aggregate at the end need not follow the named makers' ranking order.
assert.equal(parseAnnualMakers({ labels: ["A", "Others"], datasets: [{ data: [1, 29] }] }).length, 2);
const zero = await fetchAnnualOemSegment({ ...params, year: 2026, ...RTO_DAILY_CATEGORY_FILTERS["2W"], fuels: RTO_DAILY_FUEL_FILTERS.EV, fetchImpl: annualSourceFixture({ total: 0, labels: [], counts: [] }).fetchImpl });
assert.equal(zero.explicitZero, true);
const partial = annualRankingPayload(params, observations.slice(0, 1));
assert.equal(partial.segments[0].status, "verified");
assert.equal(partial.segments[1].total, null);
let called = false;
await getAnnualOemRankings(params, async (sql, values) => { called = true; assert.deepEqual(values, [params.state, params.rto, 2026, params.date]); assert.match(sql, /calendar_year=\$3/); assert.match(sql, /observation_date <= \$4/); assert.match(sql, /observed_at desc/); return { rows: observations }; });
assert.ok(called);
// Retry only the failing endpoint; already successful chart calls are not repeated.
for (const endpoint of ["/vahan", "/json_rtos", "top5Makerchart", "categoriesdonutchart", "dashboardcount"]) {
  const source = annualSourceFixture();
  const calls = new Map();
  let paced = 0;
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    calls.set(path, (calls.get(path) ?? 0) + 1);
    if (path.endsWith(endpoint) && calls.get(path) === 1) return new Response("Temporary source failure", { status: 404 });
    return source.fetchImpl(url);
  };
  const evidence = await fetchAnnualOemSegment({ ...params, year: 2026, ...RTO_DAILY_CATEGORY_FILTERS["2W"], fuels: RTO_DAILY_FUEL_FILTERS.EV,
    fetchImpl, maxRequestAttempts: 2, beforeRequest: async () => { paced++; } });
  assert.equal(evidence.total, 30);
  assert.equal(paced, [...calls.values()].reduce((a,b) => a+b, 0), "each attempt observes request pacing");
  for (const [path, count] of calls) assert.equal(count, path.endsWith(endpoint) ? 2 : 1);
}
let failedCalls = 0;
const permanent = annualSourceFixture();
await assert.rejects(fetchAnnualOemSegment({ ...params, year: 2026, ...RTO_DAILY_CATEGORY_FILTERS["2W"], fuels: RTO_DAILY_FUEL_FILTERS.EV,
  maxRequestAttempts: 2, fetchImpl: async (url) => { if (new URL(url).pathname.endsWith("top5Makerchart")) { failedCalls++; return new Response("Missing", { status: 404 }); } return permanent.fetchImpl(url); } }),
  /top5Makerchart.*404.*2 attempts/);
assert.equal(failedCalls, 2, "persistent failures stay unavailable after bounded retries");
console.log("Annual OEM source, six-segment isolation, validation, partial coverage and export checks passed.");
