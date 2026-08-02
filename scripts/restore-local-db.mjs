import fs from "node:fs/promises";
import process from "node:process";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import pg from "pg";

const { Pool } = pg;
const gunzipAsync = promisify(gunzip);
const TABLES = [
  "registrations", "maker_registrations", "users", "sessions", "telegram_link_codes",
  "tracked_queries", "tracked_query_runs", "tracked_query_observations",
  "rto_daily_snapshot_configs", "rto_daily_collection_runs", "rto_daily_snapshots",
  "rto_monthly_snapshot_aggregates",
];
const SEQUENCED_TABLES = TABLES.filter((table) => !["sessions", "telegram_link_codes"].includes(table));
const JSON_COLUMNS = {
  tracked_query_runs: new Set(["metadata"]),
  tracked_query_observations: new Set(["filters", "summary", "warnings", "freshness"]),
  rto_daily_collection_runs: new Set(["errors", "metadata"]),
  rto_daily_snapshots: new Set(["raw"]),
};

function parseArgs(argv) {
  let file = null;
  let confirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--confirm-local-write") confirmed = true;
    else if (argv[index] === "--file") file = argv[++index] ?? null;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!file) throw new Error("--file is required.");
  if (!confirmed) throw new Error("Refusing to restore without --confirm-local-write.");
  return { file };
}

function localDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured.");
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error(`Refusing to restore to non-local host ${url.hostname}.`);
  }
  return url;
}

function quoted(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function insertRows(client, table, rows, batchSize = 100) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = [];
    const tuples = batch.map((row) => `(${columns.map((column) => {
      const json = JSON_COLUMNS[table]?.has(column);
      const value = row[column];
      values.push(json && value !== null ? JSON.stringify(value) : value);
      return `$${values.length}${json ? "::jsonb" : ""}`;
    }).join(", ")})`);
    await client.query(
      `insert into ${quoted(table)} (${columns.map(quoted).join(", ")}) values ${tuples.join(", ")}`,
      values,
    );
  }
}

async function resetSequence(client, table) {
  const sequence = (await client.query("select pg_get_serial_sequence($1, 'id') as name", [table])).rows[0]?.name;
  if (!sequence) return;
  const maxId = (await client.query(`select max(id)::text as value from ${quoted(table)}`)).rows[0]?.value;
  await client.query("select setval($1::regclass, $2::bigint, $3)", [sequence, maxId || "1", Boolean(maxId)]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = JSON.parse((await gunzipAsync(await fs.readFile(args.file))).toString("utf8"));
  if (payload.format !== "vahan-ey-postgres-backup-v1") throw new Error("Unsupported backup format.");
  if (!payload.tables || TABLES.some((table) => !Array.isArray(payload.tables[table]))) {
    throw new Error("Backup is missing required application tables.");
  }
  const pool = new Pool({ connectionString: localDatabaseUrl().toString(), ssl: false });
  const client = await pool.connect();
  try {
    const populated = [];
    for (const table of TABLES) {
      const count = Number((await client.query(`select count(*)::int as count from ${quoted(table)}`)).rows[0].count);
      if (count) populated.push(`${table}=${count}`);
    }
    if (populated.length) throw new Error(`Target is not empty: ${populated.join(", ")}`);
    await client.query("begin");
    try {
      for (const table of TABLES) await insertRows(client, table, payload.tables[table]);
      for (const table of SEQUENCED_TABLES) await resetSequence(client, table);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
  console.log(JSON.stringify({
    status: "success", file: args.file,
    rows: Object.fromEntries(TABLES.map((table) => [table, payload.tables[table].length])),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
