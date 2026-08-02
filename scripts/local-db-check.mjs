import process from "node:process";
import { closePool, query } from "../lib/db.mjs";

const TABLES = [
  "registrations",
  "maker_registrations",
  "users",
  "sessions",
  "telegram_link_codes",
  "tracked_queries",
  "tracked_query_runs",
  "tracked_query_observations",
  "rto_daily_snapshot_configs",
  "rto_daily_collection_runs",
  "rto_daily_jobs",
  "rto_daily_scrape_reports",
  "rto_daily_snapshots",
  "rto_monthly_snapshot_aggregates",
];

function localUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured.");
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error(`Refusing local DB check for non-local host ${url.hostname}.`);
  }
  return url;
}

async function main() {
  const url = localUrl();
  const database = await query(
    `select current_database() as name,
            pg_size_pretty(pg_database_size(current_database())) as size,
            current_setting('server_encoding') as encoding`,
  );
  const counts = {};
  for (const table of TABLES) {
    const result = await query(`select count(*)::int as count from "${table}"`);
    counts[table] = Number(result.rows[0].count);
  }
  console.log(JSON.stringify({
    status: "ok",
    host: url.hostname,
    port: url.port || "5432",
    database: database.rows[0],
    counts,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
