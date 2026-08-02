import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import pg from "pg";

const { Pool } = pg;
const gzipAsync = promisify(gzip);
const TABLES = [
  "registrations", "maker_registrations", "users", "sessions", "telegram_link_codes",
  "tracked_queries", "tracked_query_runs", "tracked_query_observations",
  "rto_daily_snapshot_configs", "rto_daily_collection_runs", "rto_daily_snapshots",
  "rto_monthly_snapshot_aggregates",
];

function localDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured.");
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error(`Refusing to back up non-local host ${url.hostname}.`);
  }
  return url;
}

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replace("T", "_").replace(/\.\d{3}Z$/, "Z");
}

async function pruneBackups(directory, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json.gz")) continue;
    const file = path.join(directory, entry.name);
    const stat = await fs.stat(file);
    if (stat.mtimeMs < cutoff) {
      await fs.unlink(file);
      deleted += 1;
    }
  }
  return deleted;
}

async function main() {
  const url = localDatabaseUrl();
  const retentionDays = Math.max(1, Math.floor(Number(process.env.BACKUP_RETENTION_DAYS ?? 14)));
  const directory = path.resolve(process.env.BACKUP_DIR || "backups/postgres");
  await fs.mkdir(directory, { recursive: true });
  const database = decodeURIComponent(url.pathname.slice(1));
  const output = path.join(directory, `${database}-${timestamp()}.json.gz`);
  const pool = new Pool({ connectionString: url.toString(), ssl: false });
  const tables = {};
  try {
    for (const table of TABLES) tables[table] = (await pool.query(`select * from "${table}"`)).rows;
  } finally {
    await pool.end();
  }
  const payload = Buffer.from(JSON.stringify({
    format: "vahan-ey-postgres-backup-v1",
    createdAt: new Date().toISOString(),
    database,
    tables,
  }));
  await fs.writeFile(output, await gzipAsync(payload, { level: 9 }));
  const deleted = await pruneBackups(directory, retentionDays);
  const stat = await fs.stat(output);
  console.log(JSON.stringify({
    status: "success", output, bytes: stat.size,
    rows: Object.fromEntries(TABLES.map((table) => [table, tables[table].length])),
    retentionDays, deleted,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
