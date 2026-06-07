import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { closePool } from "../lib/db.mjs";
import {
  readLegacyMakerFuelCsv,
  readMakerRegistrationsCsv,
  readTdcMakerRegistrationsCsv,
  upsertMakerRegistrationRows,
} from "../lib/maker-registrations.mjs";
import { readRegistrationsCsv, upsertRegistrationRows } from "../lib/registrations.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV = path.join(__dirname, "..", "data", "vahan", "vahan_fuel_monthly.csv");
const DEFAULT_MAKER_CSV = path.join(__dirname, "..", "data", "vahan", "vahan_maker_monthly.csv");
const DEFAULT_LEGACY_MAKER_CSV = path.join(__dirname, "..", "data", "vahan", "vahan_state_maker_fuel.csv");
const DEFAULT_TDC_MAKER_CSV = path.join(__dirname, "..", "data", "tdc-history", "vahan-vehicle-registrations-by-maker.csv");

function parseArgs(argv) {
  const args = {
    file: DEFAULT_CSV,
    makerFile: DEFAULT_MAKER_CSV,
    legacyMakerFile: DEFAULT_LEGACY_MAKER_CSV,
    tdcMakerFile: DEFAULT_TDC_MAKER_CSV,
    batchSize: 500,
    skipFuel: false,
    skipMaker: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unknown argument: ${token}`);
    const key = token.slice(2);
    if (key === "skip-fuel") {
      args.skipFuel = true;
      continue;
    }
    if (key === "skip-maker") {
      args.skipMaker = true;
      continue;
    }

    const value = argv[index + 1];
    index += 1;
    if (value === undefined) throw new Error(`Missing value for ${token}`);

    if (key === "file") args.file = path.resolve(value);
    else if (key === "maker-file") args.makerFile = path.resolve(value);
    else if (key === "legacy-maker-file") args.legacyMakerFile = path.resolve(value);
    else if (key === "tdc-maker-file") args.tdcMakerFile = path.resolve(value);
    else if (key === "batch-size") args.batchSize = Number(value);
    else throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isInteger(args.batchSize) || args.batchSize < 1) {
    throw new Error("--batch-size must be a positive integer");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.skipFuel) {
    const rows = await readRegistrationsCsv(args.file);
    const result = await upsertRegistrationRows(rows, { batchSize: args.batchSize });

    if (result.skipped) {
      throw new Error("DATABASE_URL is not configured. Add the Neon connection string to .env.");
    }

    console.log(`Imported ${result.count} registration rows from ${args.file}`);
  }

  if (!args.skipMaker) {
    const makerRows = [
      ...(await readMakerRegistrationsCsv(args.makerFile)),
      ...(await readLegacyMakerFuelCsv(args.legacyMakerFile)),
      ...(await readTdcMakerRegistrationsCsv(args.tdcMakerFile)),
    ].filter((row) => row.maker);
    const makerResult = await upsertMakerRegistrationRows(makerRows, { batchSize: args.batchSize });

    if (makerResult.skipped) {
      throw new Error("DATABASE_URL is not configured. Add the Neon connection string to .env.");
    }

    console.log(
      `Imported ${makerResult.count} maker registration rows from ${args.makerFile}, ${args.legacyMakerFile}, and ${args.tdcMakerFile}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
