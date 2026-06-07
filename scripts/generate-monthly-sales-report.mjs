import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  readLegacyMakerFuelCsv,
  readMakerRegistrationsCsv,
} from "../lib/maker-registrations.mjs";
import {
  buildMonthlySalesReport,
  renderMonthlySalesReportHtml,
} from "../lib/monthly-sales-report.mjs";
import { readRegistrationsCsv } from "../lib/registrations.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "vahan", "vahan_fuel_monthly.csv");
const MAKER_DATA_FILE = path.join(ROOT_DIR, "data", "vahan", "vahan_maker_monthly.csv");
const LEGACY_MAKER_DATA_FILE = path.join(ROOT_DIR, "data", "vahan", "vahan_state_maker_fuel.csv");
const ALL_RTO = "All Vahan4 Running Office";

function parseArgs(argv) {
  const args = {
    month: null,
    fuelScope: "all",
    fuel: null,
    fetchMissing: false,
    dryRun: false,
    output: null,
    format: "json",
    states: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--fetch-missing") args.fetchMissing = true;
    else if (token === "--dry-run") args.dryRun = true;
    else if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[index + 1];
      index += 1;
      if (value === undefined) throw new Error(`Missing value for ${token}`);
      if (key === "month") args.month = value;
      else if (key === "fuel-scope" || key === "fuelScope") args.fuelScope = value;
      else if (key === "fuel") args.fuel = value;
      else if (key === "output") args.output = value;
      else if (key === "format") args.format = value;
      else if (key === "states") args.states = splitList(value);
      else throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (args.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) {
    throw new Error("--month must use YYYY-MM format");
  }
  if (!["json", "html"].includes(args.format)) {
    throw new Error("--format must be json or html");
  }
  return args;
}

function splitList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function rowMonth(row) {
  return `${row.year}-${String(row.month).padStart(2, "0")}`;
}

function isBaseMarketRow(row) {
  return (!row.rto || row.rto === ALL_RTO) &&
    String(row.fuel_filter ?? "ALL") === "ALL" &&
    String(row.vehicle_category_filter ?? "ALL") === "ALL" &&
    String(row.norms_filter ?? "ALL") === "ALL" &&
    String(row.vehicle_class_filter ?? "ALL") === "ALL";
}

function latestMonth(rows) {
  return [...new Set(rows.map(rowMonth))].sort().at(-1) ?? null;
}

function monthParts(value) {
  const [year, month] = String(value).split("-").map(Number);
  return { year, month };
}

function scrapeFuelFilters(args) {
  if (args.fuelScope === "all" || !args.fuel) return [];
  const fuel = String(args.fuel).trim().toUpperCase();
  if (args.fuelScope === "exact") return [fuel];
  const groups = {
    EV: ["ELECTRIC", "PURE EV"],
    HYBRID: ["DIESEL/HYBRID", "PETROL/HYBRID", "PETROL/HYBRID/CNG", "PETROL(E20)/HYBRID", "PETROL(E20)/HYBRID/CNG", "PLUG-IN HYBRID EV", "STRONG HYBRID EV"],
    PETROL: ["PETROL", "PETROL(E20)", "PETROL/CNG", "PETROL(E20)/CNG", "PETROL/HYBRID", "PETROL(E20)/HYBRID", "PETROL/LPG", "PETROL(E20)/LPG"],
    DIESEL: ["DIESEL", "DIESEL/HYBRID"],
    CNG: ["CNG ONLY", "PETROL/CNG", "PETROL(E20)/CNG"],
    LPG: ["LPG ONLY", "PETROL/LPG", "PETROL(E20)/LPG"],
    HYDROGEN: ["FUEL CELL HYDROGEN", "HYDROGEN(ICE)"],
  };
  return groups[fuel] ?? [fuel];
}

async function loadLocalRows() {
  const rows = await readRegistrationsCsv(DATA_FILE);
  const makerRows = [
    ...(await readMakerRegistrationsCsv(MAKER_DATA_FILE)),
    ...(await readLegacyMakerFuelCsv(LEGACY_MAKER_DATA_FILE)),
  ];
  return { rows, makerRows };
}

function loadedStates(rows) {
  return [...new Set(rows.filter(isBaseMarketRow).map((row) => row.state).filter(Boolean))].sort();
}

async function runScraper(args, dimension, month, states) {
  const { year, month: monthNumber } = monthParts(month);
  const commandArgs = [
    "scripts/vahan-scraper.mjs",
    "--mode", "scrape",
    "--dimension", dimension,
    "--years", String(year),
    "--months", String(monthNumber),
    "--states", states.join(","),
  ];
  const fuelFilters = scrapeFuelFilters(args);
  if (fuelFilters.length) commandArgs.push("--fuels", fuelFilters.join(","));
  if (args.dryRun) {
    console.log(`[dry-run] ${process.execPath} ${commandArgs.join(" ")}`);
    return;
  }
  console.log(`[report] preparing ${dimension} rows for ${month} (${states.length} state(s))`);
  const result = await execFileAsync(process.execPath, commandArgs, {
    cwd: ROOT_DIR,
    timeout: dimension === "maker" ? 1_200_000 : 900_000,
    maxBuffer: 1024 * 1024 * 40,
  });
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
}

async function prepareMissingData(args, rows, makerRows, month) {
  if (!args.fetchMissing) return;
  const states = args.states.length ? args.states : loadedStates(rows);
  if (!states.length) throw new Error("No states are available. Pass --states when using --fetch-missing on an empty dataset.");

  const hasFuelRows = rows.some((row) => isBaseMarketRow(row) && rowMonth(row) === month);
  const hasMakerRows = makerRows.some((row) => rowMonth(row) === month);

  if (!hasFuelRows) await runScraper(args, "fuel", month, states);
  if (!hasMakerRows) await runScraper(args, "maker", month, states);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let { rows, makerRows } = await loadLocalRows();
  const month = args.month ?? latestMonth(rows.filter(isBaseMarketRow));
  if (!month) throw new Error("No month was provided and no local base rows are available.");

  await prepareMissingData(args, rows, makerRows, month);
  if (args.fetchMissing && !args.dryRun) {
    ({ rows, makerRows } = await loadLocalRows());
  }

  const report = buildMonthlySalesReport({
    rows,
    makerRows,
    month,
    fuelScope: args.fuelScope,
    fuel: args.fuel,
  });
  const output = args.format === "html"
    ? renderMonthlySalesReportHtml(report)
    : `${JSON.stringify(report, null, 2)}\n`;

  if (args.output) {
    const outputPath = path.resolve(ROOT_DIR, args.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, output, "utf8");
    console.log(`[report] wrote ${outputPath}`);
    return;
  }
  process.stdout.write(output);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
