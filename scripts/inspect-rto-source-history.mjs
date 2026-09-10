import pg from "pg";

// Read-only diagnosis. No schema application, seeding, regeneration, or retention.
const url = new URL(process.env.DATABASE_URL);
if (!url.hostname.endsWith(".neon.tech")) throw new Error("History inspection requires a Neon profile.");
url.searchParams.delete("sslmode");
const client = new pg.Client({ connectionString: url.toString(), ssl: true, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  await client.query("begin read only");
  await client.query("set local statement_timeout = '20s'");
  const counts = await client.query(`select snapshot_date::text, run_id, state, count(*)::int reports,
    count(*) filter (where report_total = 0)::int zero_reports,
    count(distinct rto)::int rtos, min(report_total)::text minimum, max(report_total)::text maximum,
    count(*) filter (where evidence->'validation'->>'contract' = 'public-stock-v2')::int verified_v2
    from rto_daily_scrape_reports where snapshot_date between '2026-09-08' and '2026-09-09'
    group by snapshot_date, run_id, state order by snapshot_date, run_id, state`);
  const samples = await client.query(`select snapshot_date::text, state, rto, fuel_group, vehicle_category,
    report_total, evidence->'filters' as requested_filters, evidence->'categories' as categories
    from rto_daily_scrape_reports where snapshot_date between '2026-09-08' and '2026-09-09'
    and (rto ilike 'BALASORE%' or rto ilike 'PUNE%') order by snapshot_date, rto, fuel_group, vehicle_category`);
  console.log(JSON.stringify({ counts: counts.rows, samples: samples.rows }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.code ?? error.name, message: "Read-only history inspection failed; credentials were not printed." }));
  process.exitCode = 1;
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
