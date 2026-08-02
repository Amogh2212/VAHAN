import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../lib/db.mjs";
import {
  readLegacyMakerFuelCsv,
  readMakerRegistrationsCsv,
  readTdcMakerRegistrationsCsv,
  upsertMakerRegistrationRows,
} from "../lib/maker-registrations.mjs";
import { readRegistrationsCsv, upsertRegistrationRows } from "../lib/registrations.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_SCHEMA = path.join(ROOT_DIR, "db", "schema.sql");
const DEFAULT_FUEL_CSV = path.join(ROOT_DIR, "data", "vahan", "vahan_fuel_monthly.csv");
const DEFAULT_MAKER_CSV = path.join(ROOT_DIR, "data", "vahan", "vahan_maker_monthly.csv");
const DEFAULT_LEGACY_MAKER_CSV = path.join(ROOT_DIR, "data", "vahan", "vahan_state_maker_fuel.csv");
const DEFAULT_TDC_MAKER_CSV = path.join(ROOT_DIR, "data", "tdc-history", "vahan-vehicle-registrations-by-maker.csv");

const REQUIRED_TABLES = [
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

function parseArgs(argv) {
  const args = {
    batchSize: 50,
    fuelFile: DEFAULT_FUEL_CSV,
    full: false,
    includeTdcMaker: false,
    legacyMakerFile: DEFAULT_LEGACY_MAKER_CSV,
    makerFile: DEFAULT_MAKER_CSV,
    sampleSize: 50,
    schema: DEFAULT_SCHEMA,
    tdcMakerFile: DEFAULT_TDC_MAKER_CSV,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--confirm-db-write") {
      args.confirmDbWrite = true;
      continue;
    }
    if (token === "--full") {
      args.full = true;
      continue;
    }
    if (token === "--include-tdc-maker") {
      args.includeTdcMaker = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`Unknown argument: ${token}`);

    const key = token.slice(2);
    const value = argv[index + 1];
    index += 1;
    if (value === undefined) throw new Error(`Missing value for ${token}`);

    if (key === "batch-size") args.batchSize = Number(value);
    else if (key === "fuel-file") args.fuelFile = path.resolve(value);
    else if (key === "legacy-maker-file") args.legacyMakerFile = path.resolve(value);
    else if (key === "maker-file") args.makerFile = path.resolve(value);
    else if (key === "sample-size") args.sampleSize = Number(value);
    else if (key === "schema") args.schema = path.resolve(value);
    else if (key === "tdc-maker-file") args.tdcMakerFile = path.resolve(value);
    else throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isInteger(args.batchSize) || args.batchSize < 1) {
    throw new Error("--batch-size must be a positive integer");
  }
  if (!Number.isInteger(args.sampleSize) || args.sampleSize < 1) {
    throw new Error("--sample-size must be a positive integer");
  }
  return args;
}

function assertSafeCockroachTestTarget() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!process.env.COCKROACH_TEST) {
    throw new Error("Set COCKROACH_TEST=1 in the test env file before running this DB-write test.");
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the CockroachDB test runner.");
  }
  if (/neon\.tech/i.test(databaseUrl)) {
    throw new Error("Refusing to run Cockroach test against a Neon DATABASE_URL.");
  }
  if (!/cockroachlabs\.cloud|cockroach/i.test(databaseUrl)) {
    throw new Error("DATABASE_URL does not look like a CockroachDB target.");
  }
}

async function countRows(table) {
  const result = await query(`select count(*)::int as count from ${table}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function listExistingTables() {
  const result = await query(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1)
      order by table_name
    `,
    [REQUIRED_TABLES],
  );
  return result.rows.map((row) => row.table_name);
}

async function applySchema(schemaPath) {
  const schema = await fs.readFile(schemaPath, "utf8");
  await query(schema);
}

async function loadMakerRows(args) {
  const rows = [
    ...(await readMakerRegistrationsCsv(args.makerFile)),
    ...(await readLegacyMakerFuelCsv(args.legacyMakerFile)),
  ];
  if (args.includeTdcMaker) {
    rows.push(...(await readTdcMakerRegistrationsCsv(args.tdcMakerFile)));
  }
  return rows.filter((row) => row.maker);
}

async function validateCoreReads() {
  const [freshness, makerRows, trackedRows, rtoRows] = await Promise.all([
    query(
      `
        select
          count(*)::int as row_count,
          max((year::text || '-' || lpad(month::text, 2, '0'))) as latest_month
        from registrations
      `,
    ),
    query("select count(*)::int as row_count from maker_registrations"),
    query("select count(*)::int as row_count from tracked_queries"),
    query("select count(*)::int as row_count from rto_daily_snapshot_configs"),
  ]);
  return {
    latestMonth: freshness.rows[0]?.latest_month ?? null,
    makerRows: Number(makerRows.rows[0]?.row_count ?? 0),
    registrationRows: Number(freshness.rows[0]?.row_count ?? 0),
    rtoConfigRows: Number(rtoRows.rows[0]?.row_count ?? 0),
    trackedQueryRows: Number(trackedRows.rows[0]?.row_count ?? 0),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.confirmDbWrite) {
    throw new Error("Pass --confirm-db-write to acknowledge this writes to the configured test database.");
  }
  assertSafeCockroachTestTarget();

  const report = {
    appliedSchema: false,
    batchSize: args.batchSize,
    fullImport: args.full,
    includeTdcMaker: args.includeTdcMaker,
    imported: {},
    mode: args.full ? "full" : "sample",
    sampleSize: args.sampleSize,
    tables: {},
    validation: {},
  };

  await applySchema(args.schema);
  report.appliedSchema = true;

  const existingTables = await listExistingTables();
  report.tables = {
    existing: existingTables,
    missing: REQUIRED_TABLES.filter((table) => !existingTables.includes(table)),
  };
  if (report.tables.missing.length) {
    throw new Error(`Missing table(s) after schema apply: ${report.tables.missing.join(", ")}`);
  }

  const fuelRows = await readRegistrationsCsv(args.fuelFile);
  const makerRows = await loadMakerRows(args);
  const selectedFuelRows = args.full ? fuelRows : fuelRows.slice(0, args.sampleSize);
  const selectedMakerRows = args.full ? makerRows : makerRows.slice(0, args.sampleSize);

  await upsertRegistrationRows(selectedFuelRows, { batchSize: args.batchSize });
  await upsertMakerRegistrationRows(selectedMakerRows, { batchSize: args.batchSize });
  const firstCounts = {
    makerRegistrations: await countRows("maker_registrations"),
    registrations: await countRows("registrations"),
  };

  await upsertRegistrationRows(selectedFuelRows, { batchSize: args.batchSize });
  await upsertMakerRegistrationRows(selectedMakerRows, { batchSize: args.batchSize });
  const secondCounts = {
    makerRegistrations: await countRows("maker_registrations"),
    registrations: await countRows("registrations"),
  };

  report.imported = {
    fuelRowsSelected: selectedFuelRows.length,
    fuelRowsSource: fuelRows.length,
    makerRowsSelected: selectedMakerRows.length,
    makerRowsSource: makerRows.length,
  };
  report.idempotency = {
    firstCounts,
    secondCounts,
    passed:
      firstCounts.registrations === secondCounts.registrations &&
      firstCounts.makerRegistrations === secondCounts.makerRegistrations,
  };
  report.validation = await validateCoreReads();

  if (!report.idempotency.passed) {
    throw new Error("Duplicate import changed row counts; idempotency validation failed.");
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
