import fs from "node:fs";
import pg from "pg";

const DATE = process.env.RTO_REPLACE_DATE ?? "2026-09-16";
const local = new pg.Client({ connectionString: process.env.LOCAL_DATABASE_URL });
const neon = new pg.Client({ connectionString: process.env.NEON_DATABASE_URL });

const cols = async (client, table) => (await client.query(
  "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position",
  [table],
)).rows.map((r) => r.column_name);

const insertRows = async (client, table, rows, map = (row) => row) => {
  if (!rows.length) return;
  const columns = (await cols(client, table)).filter((c) => c !== "id");
  for (const original of rows) {
    const row = map(original);
    const values = columns.map((c) => row[c]);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    try {
      await client.query(`insert into ${table} (${columns.join(", ")}) values (${placeholders})`, values);
    } catch (error) {
      throw new Error(`${table} insert failed: ${error.message}`);
    }
  }
};

async function main() {
  if (!process.env.LOCAL_DATABASE_URL || !process.env.NEON_DATABASE_URL) throw new Error("LOCAL_DATABASE_URL and NEON_DATABASE_URL are required.");
  await local.connect(); await neon.connect();
  await neon.query("begin");
  try {
    const sourceRun = (await local.query("select * from rto_daily_collection_runs where snapshot_date=$1 order by id desc limit 1", [DATE])).rows[0];
    const targetRun = (await neon.query("select * from rto_daily_collection_runs where snapshot_date=$1 order by id desc limit 1", [DATE])).rows[0];
    if (!sourceRun || !targetRun) throw new Error("Both local and Neon runs for the requested date are required.");

    const oldId = targetRun.id;
    await neon.query("delete from rto_report_batches where source_run_id=$1", [oldId]);
    await neon.query("delete from rto_registration_observations where run_id=$1", [oldId]);
    await neon.query("delete from rto_daily_report_totals where source_run_id=$1", [oldId]);
    await neon.query("delete from rto_daily_oem_totals where source_run_id=$1", [oldId]);
    await neon.query("delete from rto_daily_scrape_reports where run_id=$1", [oldId]);
    await neon.query("delete from rto_daily_run_cohort_members where run_id=$1", [oldId]);
    await neon.query("delete from rto_daily_jobs where run_id=$1", [oldId]);

    const runColumns = (await cols(neon, "rto_daily_collection_runs")).filter((c) => c !== "id");
    await neon.query(`update rto_daily_collection_runs set ${runColumns.map((c, i) => `${c}=$${i + 2}`).join(", ")} where id=$1`, [oldId, ...runColumns.map((c) => sourceRun[c])]);
    const cohort = (await local.query("select * from rto_daily_run_cohort_members where run_id=$1 order by cohort_rank", [sourceRun.id])).rows;
    await insertRows(neon, "rto_daily_run_cohort_members", cohort, (r) => ({ ...r, run_id: oldId, config_id: null }));
    await neon.query("update rto_daily_run_cohort_members c set config_id=s.id from rto_daily_snapshot_configs s where c.run_id=$1 and c.state=s.state and c.rto=s.rto", [oldId]);
    const jobs = (await local.query("select * from rto_daily_jobs where run_id=$1", [sourceRun.id])).rows;
    const jobMap = new Map();
    const jobColumns = (await cols(neon, "rto_daily_jobs")).filter((c) => !["id", "run_id", "config_id"].includes(c));
    for (const job of jobs) {
      const values = jobColumns.map((c) => job[c]);
      const result = await neon.query(`insert into rto_daily_jobs (${jobColumns.join(", ")}, run_id, config_id) select ${jobColumns.map((_, i) => `$${i + 1}`).join(", ")}, $${values.length + 1}, s.id from rto_daily_snapshot_configs s where s.state=$${values.length + 2} and s.rto=$${values.length + 3} returning id`, [...values, oldId, job.state, job.rto]);
      jobMap.set(String(job.id), result.rows[0].id);
    }
    const reports = (await local.query("select * from rto_daily_scrape_reports where run_id=$1", [sourceRun.id])).rows;
    await insertRows(neon, "rto_daily_scrape_reports", reports, (r) => ({ ...r, run_id: oldId, job_id: jobMap.get(String(r.job_id)) }));
    await neon.query("commit");
    console.log(JSON.stringify({ date: DATE, replacedRunId: oldId, sourceRunId: sourceRun.id, jobs: jobs.length, reports: reports.length }));
  } catch (error) { await neon.query("rollback"); throw error; }
}

main().catch((e) => { console.error(e.stack ?? e.message); process.exitCode = 1; }).finally(async () => { await local.end().catch(() => {}); await neon.end().catch(() => {}); });
