import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

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
  "rto_daily_snapshots",
  "rto_monthly_snapshot_aggregates",
];

const SEQUENCED_TABLES = TABLES.filter((table) => !["sessions", "telegram_link_codes"].includes(table));

function parseArgs(argv) {
  const args = {
    sourceEnv: ".env.cockroach.local",
    targetEnv: ".env.local-postgres",
    batchSize: 100,
    confirmLocalWrite: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--confirm-local-write") {
      args.confirmLocalWrite = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`Missing value for ${token}`);
    if (token === "--source-env") args.sourceEnv = value;
    else if (token === "--target-env") args.targetEnv = value;
    else if (token === "--batch-size") args.batchSize = Number(value);
    else throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isInteger(args.batchSize) || args.batchSize < 1 || args.batchSize > 500) {
    throw new Error("--batch-size must be an integer from 1 to 500.");
  }
  if (!args.confirmLocalWrite) {
    throw new Error("Refusing to write without --confirm-local-write.");
  }
  return args;
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function readEnvFile(file) {
  const absolute = path.resolve(file);
  const text = await fs.readFile(absolute, "utf8");
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match) values[match[1]] = unquote(match[2]);
  }
  return { absolute, values };
}

function isLocalHostname(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(String(hostname).toLowerCase());
}

function parsedDatabaseUrl(value, label) {
  if (!value) throw new Error(`${label} DATABASE_URL is missing.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} DATABASE_URL is invalid.`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${label} DATABASE_URL must use postgres:// or postgresql://.`);
  }
  return url;
}

function poolConfig(env) {
  const value = env.DATABASE_URL;
  const sslDisabled = String(env.PGSSL).toLowerCase() === "false" || value.includes("sslmode=disable");
  if (sslDisabled) return { connectionString: value };
  const url = new URL(value);
  url.searchParams.delete("sslmode");
  return { connectionString: url.toString(), ssl: true };
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function tableCount(client, table) {
  const result = await client.query(`select count(*)::int as count from ${quoteIdentifier(table)}`);
  return Number(result.rows[0].count);
}

async function counts(client) {
  const result = {};
  for (const table of TABLES) result[table] = await tableCount(client, table);
  return result;
}

async function copyTable(source, target, table, batchSize) {
  const result = await source.query(`select * from ${quoteIdentifier(table)}`);
  if (!result.rows.length) return 0;
  const fields = result.fields.map((field) => ({
    name: field.name,
    json: field.dataTypeID === 114 || field.dataTypeID === 3802,
    cast: field.dataTypeID === 114 ? "::json" : field.dataTypeID === 3802 ? "::jsonb" : "",
  }));
  const columns = fields.map((field) => field.name);
  const columnSql = columns.map(quoteIdentifier).join(", ");

  for (let offset = 0; offset < result.rows.length; offset += batchSize) {
    const batch = result.rows.slice(offset, offset + batchSize);
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = fields.map((field) => {
        const value = row[field.name];
        values.push(field.json && value !== null ? JSON.stringify(value) : value);
        return `$${values.length}${field.cast}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await target.query(
      `insert into ${quoteIdentifier(table)} (${columnSql}) values ${tuples.join(", ")}`,
      values,
    );
  }
  return result.rows.length;
}

async function resetSequence(client, table) {
  const sequenceResult = await client.query("select pg_get_serial_sequence($1, 'id') as name", [table]);
  const sequenceName = sequenceResult.rows[0]?.name;
  if (!sequenceName) return;
  const maxResult = await client.query(`select max(id)::text as max_id from ${quoteIdentifier(table)}`);
  const maxId = maxResult.rows[0]?.max_id;
  if (maxId === null || maxId === undefined) {
    await client.query("select setval($1::regclass, 1, false)", [sequenceName]);
  } else {
    await client.query("select setval($1::regclass, $2::bigint, true)", [sequenceName, maxId]);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceFile = await readEnvFile(args.sourceEnv);
  const targetFile = await readEnvFile(args.targetEnv);
  const sourceUrl = parsedDatabaseUrl(sourceFile.values.DATABASE_URL, "Source");
  const targetUrl = parsedDatabaseUrl(targetFile.values.DATABASE_URL, "Target");

  if (isLocalHostname(sourceUrl.hostname)) throw new Error("Source must not be a local database.");
  if (!isLocalHostname(targetUrl.hostname)) throw new Error("Target must be localhost, 127.0.0.1, or ::1.");
  if (sourceUrl.toString() === targetUrl.toString()) throw new Error("Source and target databases must differ.");

  const sourcePool = new Pool(poolConfig(sourceFile.values));
  const targetPool = new Pool(poolConfig(targetFile.values));
  let targetClient;

  try {
    const schema = await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
    await targetPool.query(schema);

    const sourceCounts = await counts(sourcePool);
    const initialTargetCounts = await counts(targetPool);
    const populatedTargets = Object.entries(initialTargetCounts).filter(([, count]) => count > 0);
    if (populatedTargets.length) {
      throw new Error(`Target is not empty: ${populatedTargets.map(([table, count]) => `${table}=${count}`).join(", ")}`);
    }

    targetClient = await targetPool.connect();
    await targetClient.query("begin");
    const copied = {};
    try {
      for (const table of TABLES) {
        copied[table] = await copyTable(sourcePool, targetClient, table, args.batchSize);
        console.log(`[migrate] ${table}: ${copied[table]} row(s)`);
      }
      for (const table of SEQUENCED_TABLES) await resetSequence(targetClient, table);
      await targetClient.query("commit");
    } catch (error) {
      await targetClient.query("rollback");
      throw error;
    }

    const targetCounts = await counts(targetPool);
    const mismatches = TABLES.filter((table) => sourceCounts[table] !== targetCounts[table]);
    if (mismatches.length) {
      throw new Error(`Count mismatch after copy: ${mismatches.map((table) => `${table} ${sourceCounts[table]} != ${targetCounts[table]}`).join(", ")}`);
    }

    console.log(JSON.stringify({
      status: "success",
      sourceHost: sourceUrl.hostname,
      targetHost: targetUrl.hostname,
      sourceEnv: sourceFile.absolute,
      targetEnv: targetFile.absolute,
      counts: targetCounts,
    }, null, 2));
  } finally {
    targetClient?.release();
    await Promise.allSettled([sourcePool.end(), targetPool.end()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
