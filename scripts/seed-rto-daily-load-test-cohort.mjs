import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { closePool, transaction } from "../lib/db.mjs";
import { validateRtoDailyLoadTestCohort } from "../lib/rto-daily-cohort.mjs";

const DEFAULT_SEED_FILE = path.join("data", "vahan", "rto-top-100-cohort.json");
const EPHEMERAL_DATABASE = "vahan_rto_action_test";

function parseArgs(argv) {
  const args = { file: DEFAULT_SEED_FILE, confirmEphemeral: false, confirmNeon: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--file") args.file = argv[++index] ?? "";
    else if (value.startsWith("--file=")) args.file = value.slice("--file=".length);
    else if (value === "--confirm-ephemeral") args.confirmEphemeral = true;
    else if (value === "--confirm-neon") args.confirmNeon = true;
    else if (value === "--help" || value === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function assertEphemeralDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the hosted load-test seed.");
  const url = new URL(process.env.DATABASE_URL);
  const host = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!["localhost", "127.0.0.1", "::1"].includes(host) || database !== EPHEMERAL_DATABASE) {
    throw new Error(`Refusing to seed ${host || "unknown"}/${database || "unknown"}; this command only permits localhost/${EPHEMERAL_DATABASE}.`);
  }
}

function assertNeonDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the production cohort seed.");
  const host = new URL(process.env.DATABASE_URL).hostname.toLowerCase();
  if (!host.endsWith(".neon.tech")) throw new Error(`Refusing production cohort seed for non-Neon host ${host || "unknown"}.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node --env-file=.env scripts/seed-rto-daily-load-test-cohort.mjs (--confirm-ephemeral|--confirm-neon) [--file path]");
    return;
  }
  if (args.confirmEphemeral === args.confirmNeon) throw new Error("Choose exactly one explicit seed target confirmation.");
  if (args.confirmEphemeral) assertEphemeralDatabase();
  if (args.confirmNeon) assertNeonDatabase();
  const payload = JSON.parse(await fs.readFile(args.file, "utf8"));
  const cohort = validateRtoDailyLoadTestCohort(payload);
  const seeded = await transaction(async (tx) => {
    await tx("update rto_daily_snapshot_configs set enabled = false, updated_at = now()");
    const result = await tx(
      `
        insert into rto_daily_snapshot_configs (state, rto, enabled, priority, catalog_last_seen_at)
        select state, rto, true, rank, now()
        from jsonb_to_recordset($1::jsonb) as cohort(rank integer, state text, rto text)
        on conflict (state, rto) do update set
          enabled = true,
          priority = excluded.priority,
          catalog_last_seen_at = excluded.catalog_last_seen_at,
          catalog_miss_count = 0,
          updated_at = now()
      `,
      [JSON.stringify(cohort)],
    );
    const enabled = await tx("select count(*)::int as count from rto_daily_snapshot_configs where enabled = true");
    if (Number(enabled.rows[0]?.count) !== cohort.length) throw new Error("Hosted load-test cohort seed did not produce exactly 100 enabled RTOs.");
    return { seeded: result.rowCount, enabled: Number(enabled.rows[0]?.count) };
  });
  console.log(JSON.stringify({ status: "seeded", target: args.confirmNeon ? "neon" : EPHEMERAL_DATABASE, ...seeded }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(closePool);
