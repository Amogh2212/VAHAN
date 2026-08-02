import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { closePool } from "../lib/db.mjs";
import { upsertRtoGeoProfile } from "../lib/rto-insights.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_INPUT = path.join(ROOT_DIR, "data", "rto-insights", "rto-centroid-worklist.csv");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const rows = parseCsv(await fs.readFile(inputPath, "utf8"));
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const latitude = numericOrNull(row.latitude);
    const longitude = numericOrNull(row.longitude);
    if (!row.state || !row.rto || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      skipped += 1;
      continue;
    }

    if (args.dryRun) {
      imported += 1;
      continue;
    }

    await upsertRtoGeoProfile({
      state: row.state,
      rto: row.rto,
      rtoCode: row.rto_code || undefined,
      placeLabel: row.place_label || undefined,
      latitude,
      longitude,
      confidenceScore: Number(row.confidence_score) || 0.65,
      source: row.source || "manual_csv",
      sourceUrl: row.source_url || null,
      reviewed: parseBoolean(row.reviewed),
      raw: {
        notes: row.notes || "",
        importedFrom: path.basename(inputPath),
      },
      geocodedAt: new Date().toISOString(),
    });
    imported += 1;
  }

  await closePool();
  console.log(`[rto-centroids] ${args.dryRun ? "would import" : "imported"}=${imported} skipped=${skipped} input=${inputPath}`);
}

function parseCsv(text) {
  const rows = [];
  const records = [];
  let field = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    records.push(row);
  }
  if (!records.length) return rows;

  const headers = records[0].map((header) => header.trim());
  for (const record of records.slice(1)) {
    if (!record.some((value) => String(value ?? "").trim())) continue;
    const item = {};
    headers.forEach((header, index) => {
      item[header] = record[index] ?? "";
    });
    rows.push(item);
  }
  return rows;
}

function parseBoolean(value) {
  return /^(true|1|yes|y)$/i.test(String(value ?? "").trim());
}

function numericOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--input") args.input = next();
    else if (arg === "--dry-run") args.dryRun = true;
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
  node --env-file=.env scripts/import-rto-centroids.mjs [options]

Options:
  --input path.csv        CSV with state,rto,latitude,longitude columns.
  --dry-run              Validate importable rows without writing.
`);
}

main().catch(async (error) => {
  await closePool().catch(() => {});
  console.error(`[rto-centroids] ${error.stack || error.message}`);
  process.exitCode = 1;
});
