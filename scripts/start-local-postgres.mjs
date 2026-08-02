import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const { Client } = pg;

function config() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured.");
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error(`Refusing to start local PostgreSQL for non-local host ${url.hostname}.`);
  }
  return {
    url,
    databaseDir: path.resolve(process.env.LOCAL_POSTGRES_DATA_DIR || ".local/postgres/data"),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    port: Number(url.port || 5432),
  };
}

async function canConnect(options, database = options.database) {
  const client = new Client({
    host: "127.0.0.1",
    port: options.port,
    database,
    user: options.user,
    password: options.password,
    ssl: false,
    connectionTimeoutMillis: 1000,
  });
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function ensureDatabase(server, options) {
  if (await canConnect(options)) return;
  const client = server.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  try {
    const result = await client.query("select 1 from pg_database where datname = $1", [options.database]);
    if (!result.rowCount) await server.createDatabase(options.database);
  } finally {
    await client.end();
  }
}

async function cleanStop(options) {
  const pgCtl = path.resolve("node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe");
  await new Promise((resolve, reject) => {
    const child = spawn(pgCtl, ["stop", "-D", options.databaseDir, "-m", "fast", "-w"], {
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`pg_ctl stop exited with code ${code}`))));
  });
}

async function main() {
  const options = config();
  const initializeOnly = process.argv.includes("--initialize-only");
  if (await canConnect(options)) {
    console.log(JSON.stringify({ status: "already_running", host: "127.0.0.1", port: options.port }));
    return;
  }

  const server = new EmbeddedPostgres({
    databaseDir: options.databaseDir,
    user: options.user,
    password: options.password,
    port: options.port,
    authMethod: "scram-sha-256",
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: (message) => process.stdout.write(String(message)),
    onError: (error) => console.error(error),
  });

  const versionFile = path.join(options.databaseDir, "PG_VERSION");
  if (!(await fs.stat(versionFile).catch(() => null))) await server.initialise();
  await server.start();
  await ensureDatabase(server, options);
  console.log(JSON.stringify({
    status: "running",
    host: "127.0.0.1",
    port: options.port,
    database: options.database,
    databaseDir: options.databaseDir,
  }));

  if (initializeOnly) {
    await cleanStop(options);
    return;
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await cleanStop(options).catch((error) => console.error(error));
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
