import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";
import { trackingSourceFixture } from "./fixtures/rto-oem-tracking.mjs";
import { fetchOemTrackingBaselineSegment, fetchTrackedOemSegment } from "../lib/rto-oem-tracking-source.mjs";
import { createOemBaseline, getActiveOemBaseline, finishOemBaseline, getOemBaselineScopes, saveOemBaselineScope,
  createOemDailyRun, saveOemDailyObservation, getOemDailyPending, getDailyOemTracking, finishOemDailyRun, pruneOemTrackingEvidence } from "../lib/rto-oem-tracking.mjs";
import { RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS, snapshotDateKey } from "../lib/rto-daily-snapshots.mjs";

const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("OEM integration checks require a local PostgreSQL database.");
const client = new pg.Client({ connectionString: url.href, ssl: false });
const schema = `oem_tracking_test_${process.pid}`;
const date = snapshotDateKey();
const prior = new Date(`${date}T00:00:00Z`); prior.setUTCDate(prior.getUTCDate() - 1);
const previousDate = prior.toISOString().slice(0, 10);
const context = { state: "Uttarakhand", rto: "DEHRADUN RTO - UK7", fuelGroup: "EV", vehicleCategory: "2W" };
const cohort = Array.from({ length: 100 }, (_, index) => ({ rank: index + 1, state: index ? "Test state" : context.state, rto: index ? `Test RTO ${index}` : context.rto }));
const execute = (sql, values) => client.query(sql, values);
const transact = async (callback) => { await execute("begin"); try { const result = await callback(execute); await execute("commit"); return result; } catch (error) { await execute("rollback"); throw error; } };
const options = { ...context, year: 2025, ...RTO_DAILY_CATEGORY_FILTERS["2W"], fuels: RTO_DAILY_FUEL_FILTERS.EV };
const baselineEvidence = await fetchOemTrackingBaselineSegment({ ...options, fetchImpl: trackingSourceFixture().fetchImpl });
const currentEvidence = async (day, counts = { "Maker A": 20, "Maker B": 9 }) => {
  const result = await fetchTrackedOemSegment({ ...options, year: Number(day.slice(0, 4)), makers: baselineEvidence.makers, fetchImpl: trackingSourceFixture({ counts }).fetchImpl });
  return result.makers.map((maker) => ({ ...maker.evidence, observedAt: `${day}T10:00:00Z` }));
};
await client.connect();
try {
  await execute(`create schema ${schema}`);
  await execute(`set search_path to ${schema}`);
  await execute(await fs.readFile(new URL("../db/rto-oem-tracking.sql", import.meta.url), "utf8"));
  const baseline = await createOemBaseline({ sourceCohortRunId: 1, cohort }, transact);
  assert.equal((await getOemBaselineScopes({ baselineId: baseline.id }, execute)).length, 600);
  assert.equal(await getActiveOemBaseline(execute), null);
  await assert.rejects(finishOemBaseline({ baselineId: baseline.id, activate: true }, execute, transact), /empty baseline/);
  const scopeContext = { ...context, baselineId: baseline.id };
  await saveOemBaselineScope({ ...scopeContext, evidence: baselineEvidence }, transact);
  const before = await getOemBaselineScopes({ baselineId: baseline.id, state: context.state, rto: context.rto }, execute);
  assert.equal(before.find((row) => row.vehicle_category === "2W" && row.fuel_group === "EV").makers.length, 2);
  assert.equal(baseline.selection_year, 2025);
  const replacement = await fetchOemTrackingBaselineSegment({ ...options, fetchImpl: trackingSourceFixture({ baseline: { labels: ["Maker C"], counts: [30] } }).fetchImpl });
  assert.equal((await saveOemBaselineScope({ ...scopeContext, evidence: replacement }, transact)).saved, false);
  let scopes = await getOemBaselineScopes({ baselineId: baseline.id, state: context.state, rto: context.rto }, execute);
  assert.equal(scopes.find((row) => row.fuel_group === "EV" && row.vehicle_category === "2W").makers[0].name, "Maker A");
  await assert.rejects(execute("update rto_oem_tracking_makers set maker_name='Forged' where baseline_id=$1", [baseline.id]), /immutable/);
  await assert.rejects(execute("update rto_oem_tracking_scopes set ranking_complete=true where baseline_id=$1 and status='verified'", [baseline.id]), /immutable/);
  await assert.rejects(saveOemBaselineScope({ ...scopeContext, vehicleCategory: "3W", evidence: { ...baselineEvidence, total: 1 } }, transact));
  await saveOemBaselineScope({ ...scopeContext, vehicleCategory: "3W", errorReason: "HTTP 404" }, transact);
  const thirdWheelEvidence = await fetchOemTrackingBaselineSegment({ ...options, ...RTO_DAILY_CATEGORY_FILTERS["3W"], fetchImpl: trackingSourceFixture().fetchImpl });
  await saveOemBaselineScope({ ...scopeContext, vehicleCategory: "3W", evidence: thirdWheelEvidence }, transact);
  await finishOemBaseline({ baselineId: baseline.id, activate: true }, execute, transact);
  const activation = (await getActiveOemBaseline(execute)).activated_at.toISOString();
  await finishOemBaseline({ baselineId: baseline.id, activate: true }, execute, transact);
  assert.equal((await getActiveOemBaseline(execute)).activated_at.toISOString(), activation);

  const runPrevious = await createOemDailyRun({ baselineId: baseline.id, date: previousDate }, transact);
  const runCurrent = await createOemDailyRun({ baselineId: baseline.id, date }, transact);
  assert.equal((await createOemDailyRun({ baselineId: baseline.id, date }, transact)).id, runCurrent.id);
  for (const evidence of await currentEvidence(previousDate, { "Maker A": 15, "Maker B": 12 })) {
    await saveOemDailyObservation({ ...scopeContext, runId: runPrevious.id, makerId: evidence.makerId, date: previousDate, evidence }, transact);
  }
  await saveOemDailyObservation({ ...scopeContext, runId: runCurrent.id, makerId: "Maker A", date, errorReason: "HTTP 404" }, transact);
  assert.equal((await getOemDailyPending({ baselineId: baseline.id, date }, execute)).length, 4);
  for (const evidence of await currentEvidence(date)) {
    await saveOemDailyObservation({ ...scopeContext, runId: runCurrent.id, makerId: evidence.makerId, date, evidence }, transact);
  }
  assert.equal((await getOemDailyPending({ baselineId: baseline.id, date }, execute)).length, 2);
  const payload = await getDailyOemTracking({ state: context.state, rto: context.rto, date }, execute);
  assert.equal(payload.segments[0].makers[0].dailyChange, 5);
  assert.equal(payload.segments[0].makers[1].dailyChange, -3);
  assert.equal(payload.segments[0].makers[1].status, "correction");
  assert.equal(payload.segments[1].makers[0].currentCount, null);
  const newValues = await currentEvidence(date, { "Maker A": 300, "Maker B": 200 });
  assert.equal((await saveOemDailyObservation({ ...scopeContext, runId: runCurrent.id, makerId: "Maker A", date, evidence: newValues[0] }, transact)).saved, false);
  assert.equal((await getDailyOemTracking({ state: context.state, rto: context.rto, date }, execute)).segments[0].makers[0].currentCount, 20);
  await assert.rejects(execute("update rto_oem_tracking_observations set cumulative_count=1 where baseline_id=$1 and status='verified'", [baseline.id]), /immutable/);
  await assert.rejects(saveOemDailyObservation({ ...scopeContext, runId: runPrevious.id, makerId: "Maker A", date, evidence: newValues[0] }, transact), /daily collection run/);
  await assert.rejects(saveOemDailyObservation({ ...scopeContext, runId: runCurrent.id, makerId: "Outside OEM", date, evidence: newValues[0] }, transact), /frozen verified ranking/);
  await finishOemDailyRun({ runId: runCurrent.id, status: "partial" }, execute);
  // Retention removes raw chart/headline/catalog bodies while compact validation still supports historical comparisons.
  const future = new Date(`${date}T00:00:00Z`); future.setUTCDate(future.getUTCDate() + 31);
  const pruned = await pruneOemTrackingEvidence({ date: future.toISOString().slice(0, 10) }, execute);
  assert.ok(pruned.rawDaily >= 4);
  assert.ok(pruned.rawBaseline >= 2);
  assert.equal((await getDailyOemTracking({ state: context.state, rto: context.rto, date }, execute)).segments[0].makers[0].dailyChange, 5);
  const refresh = await createOemBaseline({ sourceCohortRunId: 2, cohort }, transact);
  assert.equal((await getActiveOemBaseline(execute)).id, baseline.id);
  assert.equal(refresh.is_active, false);
  await saveOemBaselineScope({ ...scopeContext, baselineId: refresh.id, evidence: baselineEvidence }, transact);
  await finishOemBaseline({ baselineId: refresh.id, activate: true }, execute, transact);
  await assert.rejects(finishOemBaseline({ baselineId: baseline.id, activate: true }, execute, transact), /superseded/);
  assert.equal((await getActiveOemBaseline(execute)).id, refresh.id);
  console.log("OEM tracking PostgreSQL checks passed: 600 initialized scopes, historical-year separation, immutable rankings/observations, failed-item retry, atomic activation, adjacent daily changes and raw-retention reads.");
} finally {
  await execute("set search_path to public").catch(() => {});
  await execute(`drop schema if exists ${schema} cascade`).catch(() => {});
  await client.end();
}
