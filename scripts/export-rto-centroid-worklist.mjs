import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../lib/db.mjs";
import { parseRtoCode, placeLabelFromRto } from "../lib/rto-insights.mjs";
import { listRtoDailyRtos } from "../lib/rto-daily-snapshots.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "data", "rto-insights", "rto-centroid-worklist.csv");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(args.output);
  const rtos = await listRtoDailyRtos({ state: args.state });
  const existing = await loadExistingProfiles({ state: args.state });
  const rows = rtos.map((item) => {
    const key = rtoKey(item.state, item.rto);
    const profile = existing.get(key) ?? {};
    const latitude = profile.latitude ?? "";
    const longitude = profile.longitude ?? "";
    return {
      state: item.state,
      rto: item.rto,
      rto_code: profile.rto_code ?? parseRtoCode(item.rto) ?? "",
      place_label: profile.place_label ?? placeLabelFromRto(item.rto),
      latitude,
      longitude,
      confidence_score: profile.confidence_score ?? (latitude && longitude ? 0.7 : ""),
      source: profile.source ?? (latitude && longitude ? "manual" : ""),
      reviewed: profile.reviewed ?? false,
      notes: latitude && longitude ? "existing profile" : "",
    };
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, toCsv(rows), "utf8");
  await closePool();

  const located = rows.filter((row) => row.latitude !== "" && row.longitude !== "").length;
  console.log(`[rto-centroids] exported ${rows.length} RTO rows to ${outputPath}`);
  console.log(`[rto-centroids] located=${located} missing=${rows.length - located}`);
}

async function loadExistingProfiles({ state }) {
  const values = [];
  const clauses = [];
  if (state) {
    values.push(state);
    clauses.push(`state = $${values.length}`);
  }
  const result = await query(
    `
      select state, rto, rto_code, place_label, latitude, longitude, confidence_score, source, reviewed
      from rto_geo_profiles
      ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
      order by state asc, rto asc
    `,
    values,
  );
  return new Map(result.rows.map((row) => [rtoKey(row.state, row.rto), row]));
}

function toCsv(rows) {
  const headers = [
    "state",
    "rto",
    "rto_code",
    "place_label",
    "latitude",
    "longitude",
    "confidence_score",
    "source",
    "reviewed",
    "notes",
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n") + "\n";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function rtoKey(state, rto) {
  return `${state}\u0000${rto}`;
}

function parseArgs(argv) {
  const args = {
    output: DEFAULT_OUTPUT,
    state: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--output") args.output = next();
    else if (arg === "--state") args.state = next();
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node --env-file=.env scripts/export-rto-centroid-worklist.mjs [options]

Options:
  --state "Karnataka"     Export only one state.
  --output path.csv       Output CSV path.
`);
}

main().catch(async (error) => {
  await closePool().catch(() => {});
  console.error(`[rto-centroids] ${error.stack || error.message}`);
  process.exitCode = 1;
});
