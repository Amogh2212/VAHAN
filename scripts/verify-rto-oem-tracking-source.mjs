import fs from "node:fs/promises";
import path from "node:path";
import { query, closePool } from "../lib/db.mjs";
import { fetchOemTrackingBaselineSegment, fetchTrackedOemSegment, validateOemBaselineEvidence, validateOemDailyEvidence } from "../lib/rto-oem-tracking-source.mjs";
import { RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS } from "../lib/rto-daily-snapshots.mjs";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const output = args.includes("--output") ? args[args.indexOf("--output") + 1] : "artifacts/rto-oem-tracking-source-pilot.json";
const startedAt = new Date().toISOString();
const audit = { contract: "oem-tracking-source-pilot-v1", startedAt, validated: false, contractValidated: false, requestCount: 0, scopes: [] };
let lastRequest = 0;
const beforeRequest = async () => { await sleep(Math.max(0, lastRequest + 1400 - Date.now())); lastRequest = Date.now(); audit.requestCount++; };
try {
  // This pilot only reads the frozen production cohort and the upstream source.
  // It never writes baseline or daily observations into the application DB.
  const cohorts = await query("select run_id from rto_daily_run_cohort_members group by run_id having count(*)=100 order by run_id desc limit 1");
  if (!cohorts.rows[0]) throw new Error("No frozen 100-RTO cohort is available for the source pilot.");
  audit.cohortRunId = Number(cohorts.rows[0].run_id);
  const members = (await query("select state,rto,cohort_rank from rto_daily_run_cohort_members where run_id=$1 order by cohort_rank", [audit.cohortRunId])).rows;
  const codes = ["AP31", "UK7", "RJ14"];
  const selected = [];
  for (const code of codes) {
    const match = members.find((member) => member.rto.includes(code));
    if (match) selected.push(match);
    else audit.scopes.push({ rtoCode: code, status: "not_in_frozen_cohort", reason: "Pilot example is not a member of the current frozen 100-RTO cohort." });
  }
  if (selected.length < 3) for (const member of members) {
    if (!selected.some((v) => v.state === member.state) && !selected.some((v) => v.rto === member.rto)) selected.push(member);
    if (selected.length === 3) break;
  }
  for (const member of selected) {
    for (const fuelGroup of ["EV", "ICE"]) {
      let catalogFailure = false;
      for (const vehicleCategory of ["2W", "3W", "4W"]) {
        const expected = { ...member, fuelGroup, vehicleCategory };
        const input = { state: member.state, rto: member.rto, ...RTO_DAILY_CATEGORY_FILTERS[vehicleCategory], fuels: RTO_DAILY_FUEL_FILTERS[fuelGroup], beforeRequest };
        try {
          const baseline = await fetchOemTrackingBaselineSegment({ ...input, year: 2025 });
          validateOemBaselineEvidence(baseline, { ...expected, selectionYear: 2025 });
          const historic = await fetchTrackedOemSegment({ ...input, year: 2025, makers: baseline.makers });
          for (const maker of historic.makers) {
            if (maker.status !== "verified") throw new Error(maker.reason);
            validateOemDailyEvidence(maker.evidence, { ...expected, year: 2025, makerId: maker.id, makerName: maker.name });
            if (maker.count !== baseline.makers.find((v) => v.id === maker.id).count) throw new Error("Maker-filtered 2025 count disagrees with the source ranking; filters are unverified.");
          }
          const year = Number(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 4));
          const current = await fetchTrackedOemSegment({ ...input, year, makers: baseline.makers });
          for (const maker of current.makers) {
            if (maker.status !== "verified") throw new Error(maker.reason);
            validateOemDailyEvidence(maker.evidence, { ...expected, year, makerId: maker.id, makerName: maker.name });
          }
          audit.scopes.push({ ...expected, status: "verified", rankingComplete: baseline.rankingComplete, baseline, current });
        } catch (error) {
          audit.scopes.push({ ...expected, status: "unavailable", reason: error.message });
          catalogFailure = /catalog|vehicle-makers/i.test(error.message);
          if (catalogFailure) break;
        }
      }
      if (catalogFailure) break;
    }
  }
  const actual = audit.scopes.filter((row) => row.status !== "not_in_frozen_cohort");
  audit.validated = actual.length === 18 && actual.every((row) => row.status === "verified");
  const namedProofs = actual.filter((row) => row.status === "verified" && row.baseline.makers.length > 0);
  audit.contractValidated = new Set(namedProofs.map((row) => row.rto)).size >= 3
    && namedProofs.some((row) => row.current.makers.some((maker) => maker.evidence?.mode === "individual"))
    && namedProofs.some((row) => row.current.makers.some((maker) => maker.count !== row.baseline.makers.find((v) => v.id === maker.id)?.count));
  audit.coverageComplete = audit.validated;
} catch (error) { audit.error = error.message; }
finally {
  audit.finishedAt = new Date().toISOString();
  audit.runtimeSeconds = Math.round((Date.parse(audit.finishedAt) - Date.parse(startedAt)) / 1000);
  await closePool();
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(audit, null, 2) + "\n");
  console.log(JSON.stringify({ validated: audit.validated, contractValidated: audit.contractValidated, coverageComplete: audit.coverageComplete, cohortRunId: audit.cohortRunId, requestCount: audit.requestCount,
    runtimeSeconds: audit.runtimeSeconds, scopes: audit.scopes.map(({ baseline, current, ...row }) => row), error: audit.error, output }));
  if (!audit.validated) process.exitCode = 1;
}
