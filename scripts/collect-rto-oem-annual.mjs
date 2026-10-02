import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { query, closePool } from "../lib/db.mjs";
import { acquireVahanScrapeLock } from "../lib/vahan-scrape-lock.mjs";
import { validateRtoDailyLoadTestCohort } from "../lib/rto-daily-cohort.mjs";
import { RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS, snapshotDateKey } from "../lib/rto-daily-snapshots.mjs";
import { fetchAnnualOemSegment, saveAnnualOemObservation } from "../lib/rto-oem-annual.mjs";

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1]; };
if (args.includes("--help")) {
  console.log("collect-rto-oem-annual.mjs (--cohort-run-id ID | --latest-cohort) [--production] [--rto NAME] [--limit N] [--resume-run-id ID]\nRemote writes require --production. Observation date is today's IST date; resume is same-day only.");
  process.exit(0);
}
const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !args.includes("--production")) throw new Error("Remote annual collection requires explicit --production.");
const date = snapshotDateKey();
const year = Number(date.slice(0, 4));
let release;
let annualRun;
try {
  release = await acquireVahanScrapeLock("annual-oem", { waitMs: 15 * 60 * 1000 });
  let cohort;
  if (value("--resume-run-id")) {
    const result = await query("select *,observation_date::text as date from rto_oem_annual_collection_runs where id=$1", [Number(value("--resume-run-id"))]);
    annualRun = result.rows[0];
    if (!annualRun || annualRun.date !== date) throw new Error("Only a same-day annual run can be resumed; historical observations cannot be recreated.");
    cohort = validateRtoDailyLoadTestCohort(annualRun.cohort);
    await query("update rto_oem_annual_collection_runs set status='running',finished_at=null where id=$1", [annualRun.id]);
  } else {
    const latest = args.includes("--latest-cohort") ? await query("select run_id from rto_daily_run_cohort_members group by run_id having count(*)=100 order by run_id desc limit 1") : null;
    const sourceRun = Number(value("--cohort-run-id") ?? latest?.rows[0]?.run_id);
    if (!Number.isSafeInteger(sourceRun) || sourceRun <= 0) throw new Error("--cohort-run-id is required.");
    const result = await query("select state,rto,cohort_rank as rank from rto_daily_run_cohort_members where run_id=$1 order by cohort_rank", [sourceRun]);
    cohort = validateRtoDailyLoadTestCohort(result.rows);
    const cohortHash = createHash("sha256").update(JSON.stringify(cohort)).digest("hex");
    const inserted = await query("insert into rto_oem_annual_collection_runs (source_cohort_run_id,cohort_hash,cohort,calendar_year,observation_date) values ($1,$2,$3::jsonb,$4,$5) returning *", [sourceRun,cohortHash,JSON.stringify(cohort),year,date]);
    annualRun = inserted.rows[0];
  }
  let selected = value("--rto") ? cohort.filter((member) => member.rto === value("--rto")) : cohort;
  if (!selected.length) throw new Error("The requested RTO is not in the frozen cohort.");
  const limit = value("--limit");
  if (limit !== null) {
    if (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100) throw new Error("--limit must be 1–100.");
    selected = selected.slice(0, Number(limit));
  }
  const saved = await query("select state,rto,fuel_group,vehicle_category from rto_oem_annual_observations where run_id=$1 and status='verified'", [annualRun.id]);
  const completed = new Set(saved.rows.map((row) => JSON.stringify([row.state,row.rto,row.fuel_group,row.vehicle_category])));
  let lastRequest = 0;
  const delay = Math.max(1200, Number(process.env.RTO_DAILY_DELAY_MS) || 1200);
  const beforeRequest = async () => { await sleep(Math.max(0, lastRequest + delay - Date.now())); lastRequest = Date.now(); };
  console.log(`Annual run ${annualRun.id}: ${selected.length}/100 RTOs, calendar year ${year}, observed ${date}`);
  for (const member of selected) for (const fuelGroup of ["EV","ICE"]) for (const vehicleCategory of ["2W","3W","4W"]) {
    if (completed.has(JSON.stringify([member.state,member.rto,fuelGroup,vehicleCategory]))) continue;
    if (snapshotDateKey() !== date) throw new Error("IST observation date changed; start a new annual run.");
    const context = { runId: annualRun.id, state: member.state, rto: member.rto, fuelGroup, vehicleCategory, date };
    let evidence;
    let errorReason;
    let failureEvidence;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        evidence = await fetchAnnualOemSegment({ ...member, year, ...RTO_DAILY_CATEGORY_FILTERS[vehicleCategory], fuels: RTO_DAILY_FUEL_FILTERS[fuelGroup], beforeRequest });
        errorReason = null;
        break;
      } catch (error) { errorReason = error.message; failureEvidence = error.annualEvidence; if (attempt < 3) await sleep(attempt * 2000); }
    }
    if (snapshotDateKey() !== date) throw new Error("IST observation date changed while fetching; response was not saved.");
    await saveAnnualOemObservation({ ...context, evidence, errorReason, failureEvidence });
    console.log(`${member.rto} ${fuelGroup}/${vehicleCategory}: ${evidence ? `${evidence.total} registrations` : `Unavailable: ${errorReason}`}`);
  }
  const count = await query("select count(*)::int as verified from rto_oem_annual_observations where run_id=$1 and status='verified'", [annualRun.id]);
  const status = count.rows[0].verified === 600 ? "success" : count.rows[0].verified ? "partial" : "failed";
  await query("update rto_oem_annual_collection_runs set status=$2,finished_at=now() where id=$1", [annualRun.id,status]);
  console.log(`Annual run ${annualRun.id}: ${status}, ${count.rows[0].verified}/600 verified scopes`);
  if (status === "failed" || (selected.length === 100 && status !== "success")) process.exitCode = 1;
} catch (error) {
  if (annualRun) await query("update rto_oem_annual_collection_runs set status='failed',finished_at=now() where id=$1", [annualRun.id]).catch(() => {});
  throw error;
} finally { await release?.(); await closePool(); }
