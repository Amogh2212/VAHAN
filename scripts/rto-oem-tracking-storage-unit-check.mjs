import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { trackingSourceFixture } from "./fixtures/rto-oem-tracking.mjs";
import { fetchOemTrackingBaselineSegment, fetchTrackedOemSegment } from "../lib/rto-oem-tracking-source.mjs";
import { dailyOemPayload, dailyOemCsvRows, dailyOemHtml, validateOemDailyRequest, getDailyOemTrackingBatch, createOemBaseline, saveOemBaselineScope, saveOemDailyObservation } from "../lib/rto-oem-tracking.mjs";
import { RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS } from "../lib/rto-daily-snapshots.mjs";
import { oemTrackingSchemaDatabaseUrl } from "./apply-rto-oem-tracking-schema.mjs";

const params = { state: "Uttarakhand", rto: "DEHRADUN RTO - UK7", date: "2026-10-04" };
const context = { ...params, fuelGroup: "EV", vehicleCategory: "2W" };
assert.throws(() => oemTrackingSchemaDatabaseUrl({}), /not configured/);
assert.throws(() => oemTrackingSchemaDatabaseUrl({ DATABASE_URL: "https://example.test" }, true), /PostgreSQL URL/);
assert.throws(() => oemTrackingSchemaDatabaseUrl({ DATABASE_URL: "postgres://user:YOUR_PASSWORD@ep-test-pooler.eu.aws.neon.tech/db" }), /explicit --production/);
assert.equal(new URL(oemTrackingSchemaDatabaseUrl({ DATABASE_URL: "postgres://user:YOUR_PASSWORD@ep-test-pooler.eu.aws.neon.tech/db" }, true)).hostname, "ep-test.eu.aws.neon.tech");
assert.equal(new URL(oemTrackingSchemaDatabaseUrl({ DATABASE_URL: "postgres://user:YOUR_PASSWORD@ep-test-pooler.eu.aws.neon.tech/db", DATABASE_URL_UNPOOLED: "postgres://user:YOUR_PASSWORD@localhost:5433/db" })).hostname, "localhost");
const cohort = Array.from({ length: 100 }, (_, index) => ({ rank: index + 1, state: index ? "Other state" : params.state, rto: index ? `Other RTO ${index}` : params.rto }));
const baseline = { id: "1", selection_year: 2025, cohort };
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, canonical(v[key])])) : v;
const hash = (v) => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
const compact = (evidence) => { const { raw, ...rest } = evidence; return { ...rest, rawRetained: false }; };
const sourceOptions = { ...params, year: 2025, ...RTO_DAILY_CATEGORY_FILTERS["2W"], fuels: RTO_DAILY_FUEL_FILTERS.EV };
const baselineEvidence = await fetchOemTrackingBaselineSegment({ ...sourceOptions, fetchImpl: trackingSourceFixture().fetchImpl });
baselineEvidence.observedAt = "2026-10-02T10:00:00Z";
const scopeEvidence = compact(baselineEvidence);
const scope = { baseline_id: "1", state: params.state, rto: params.rto, fuel_group: "EV", vehicle_category: "2W", status: "verified",
  ranking_complete: false, explicit_zero: false, evidence: scopeEvidence, evidence_hash: hash(scopeEvidence), observed_at: scopeEvidence.observedAt, makers: baselineEvidence.makers };
const makeObservation = async (date, counts = { "Maker A": 18, "Maker B": 11 }, options = {}) => {
  const source = trackingSourceFixture({ counts, ...options });
  const result = await fetchTrackedOemSegment({ ...sourceOptions, year: Number(date.slice(0, 4)), makers: baselineEvidence.makers, fetchImpl: source.fetchImpl });
  return result.makers.filter((maker) => maker.evidence).map((maker) => {
    const evidence = compact({ ...maker.evidence, observedAt: `${date}T10:00:00Z` });
    return { baseline_id: "1", ...params, fuel_group: "EV", vehicle_category: "2W", maker_id: maker.id, observation_date: date,
      calendar_year: Number(date.slice(0, 4)), observed_at: evidence.observedAt, status: "verified", cumulative_count: String(evidence.count),
      filter_identity: evidence.filterIdentity, evidence, evidence_hash: hash(evidence) };
  });
};
const previous = await makeObservation("2026-10-03", { "Maker A": 15, "Maker B": 12 });
const current = await makeObservation(params.date);
const payload = dailyOemPayload(params, { baseline, scopes: [scope], observations: [...previous, ...current] });
assert.equal(payload.selectionYear, 2025);
assert.equal(payload.year, 2026);
assert.equal(payload.segments.length, 6);
assert.equal(payload.segments[0].makers[0].dailyChange, 3);
assert.equal(payload.segments[0].makers[1].dailyChange, -1);
assert.equal(payload.segments[0].makers[1].status, "correction");
assert.equal(payload.segments[0].status, "verified");
assert.equal(payload.segments[0].rankingComplete, false);
assert.ok(payload.segments.slice(1).every((s) => s.status === "unavailable" && s.makers.length === 0));
assert.match(dailyOemHtml(payload), /Selected from 2025 rankings/);
assert.match(dailyOemHtml(payload), />3<\/td>/);
assert.equal(dailyOemCsvRows(payload).filter((row) => row[9] === "Maker A")[0][13], 3);
assert.throws(() => validateOemDailyRequest({ ...params, date: "2026-02-30" }), /valid observation/);
assert.throws(() => validateOemDailyRequest({ ...params, state: "" }), /required/);

let value = dailyOemPayload(params, { baseline, scopes: [scope], observations: current });
assert.equal(value.segments[0].makers[0].currentCount, 18);
assert.equal(value.segments[0].makers[0].dailyChange, null);
assert.match(value.segments[0].makers[0].reason, /preceding-day/);
value = dailyOemPayload(params, { baseline, scopes: [scope], observations: [...await makeObservation("2026-10-02"), ...current] });
assert.equal(value.segments[0].makers[0].dailyChange, null);
// Actual source retrieval can change from filtered batch to individual without changing comparison identity.
const individual = await makeObservation(params.date, undefined, { omitChart: ["Maker A"] });
value = dailyOemPayload(params, { baseline, scopes: [scope], observations: [...previous, ...individual] });
assert.equal(value.segments[0].makers[0].dailyChange, 3);
const unchanged = await makeObservation(params.date, { "Maker A": 15, "Maker B": 12 });
value = dailyOemPayload(params, { baseline, scopes: [scope], observations: [...previous, ...unchanged] });
assert.equal(value.segments[0].makers[0].status, "unconfirmed_no_change");
assert.equal(value.segments[0].makers[0].dailyChange, null);
unchanged[0].evidence.sourceReportedAt = "2026-10-04T09:00:00Z";
unchanged[0].evidence_hash = hash(unchanged[0].evidence);
value = dailyOemPayload(params, { baseline, scopes: [scope], observations: [...previous, ...unchanged] });
assert.equal(value.segments[0].makers[0].dailyChange, 0);
const malformed = structuredClone(current);
malformed[0].cumulative_count = "0";
value = dailyOemPayload(params, { baseline, scopes: [scope], observations: [...previous, ...malformed] });
assert.equal(value.segments[0].makers[0].currentCount, null);
assert.equal(value.segments[0].makers[1].dailyChange, -1);
value = dailyOemPayload(params, { baseline, scopes: [{ ...scope, makers: [{ ...scope.makers[0], id: "Outside OEM" }] }], observations: current });
assert.equal(value.segments[0].makers.length, 0);
value = dailyOemPayload(params, { baseline: { ...baseline, id: "2" }, scopes: [scope], observations: [...previous, ...current] });
assert.equal(value.segments[0].makers.length, 0);
value = dailyOemPayload({ ...params, date: "2027-01-01" }, { baseline, scopes: [scope], observations: await makeObservation("2027-01-01") });
assert.match(value.segments[0].makers[0].reason, /year reset/);
for (const tagName of ["script", "SCRIPT", "ScRiPt"]) {
  const escaped = structuredClone(payload);
  escaped.segments[0].makers[0].name = `<${tagName}>alert("x")</${tagName}>`;
  const html = dailyOemHtml(escaped);
  assert.doesNotMatch(html, /<\/?script\b/i);
  assert.ok(html.includes(`&lt;${tagName}&gt;alert(&quot;x&quot;)&lt;/${tagName}&gt;`));
}

let calls = 0;
const results = await getDailyOemTrackingBatch({ members: [params, { state: "Test", rto: "Missing" }], date: params.date }, async (sql) => {
  calls += 1;
  if (sql.includes("activated_at")) { assert.match(sql, /activated_at at time zone/); return { rows: [baseline] }; }
  return { rows: sql.includes("from rto_oem_tracking_scopes s") ? [scope] : [...previous, ...current] };
});
assert.equal(calls, 3);
assert.equal(results[0].segments[0].makers[0].dailyChange, 3);
assert.equal(results[1].segments[0].makers.length, 0);
const unconfigured = await getDailyOemTrackingBatch({ members: [params], date: params.date }, async () => { const e = new Error("missing relation"); e.code = "42P01"; throw e; });
assert.match(unconfigured[0].segments[0].reason, /migration/);

let scopesCreated = false;
await createOemBaseline({ sourceCohortRunId: 1, cohort }, async (callback) => callback(async (sql, values) => {
  if (sql.includes("insert into rto_oem_tracking_baselines")) return { rows: [baseline] };
  assert.match(sql, /cross join.*values \('EV'\),\('ICE'\)/);
  assert.equal(JSON.parse(values[1]).length, 100); scopesCreated = true; return { rows: [] };
}));
assert.ok(scopesCreated);
await assert.rejects(createOemBaseline({ sourceCohortRunId: 1, cohort: cohort.slice(0, 99) }), /exactly 100/);
const frozenResult = await saveOemBaselineScope({ ...context, baselineId: 1, evidence: baselineEvidence }, async (callback) => callback(async (sql) => ({ rows: sql.includes("baselines") ? [baseline] : [{ status: "verified" }] })));
assert.equal(frozenResult.saved, false);
await assert.rejects(saveOemDailyObservation({ ...context, runId: 1, baselineId: 1, makerId: "Maker A", evidence: { ...current[0].evidence, observedAt: "2026-10-03T10:00:00Z" } }), /actual IST date/);
console.log("OEM tracking storage unit checks passed: fixed historical selection, adjacent daily evidence, corrections, freshness, partial isolation, version identity, bounded history reads and frozen rankings.");
