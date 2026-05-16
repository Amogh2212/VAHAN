import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { closePool } from "../lib/db.mjs";
import { readRegistrationsCsv, upsertRegistrationRows } from "../lib/registrations.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV = path.join(__dirname, "..", "data", "vahan", "vahan_fuel_monthly.csv");

function parseArgs(argv) {
  const args = {
    file: DEFAULT_CSV,
    batchSize: 500,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unknown argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    index += 1;
    if (value === undefined) throw new Error(`Missing value for ${token}`);

    if (key === "file") args.file = path.resolve(value);
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
  const rows = await readRegistrationsCsv(args.file);
  const result = await upsertRegistrationRows(rows, { batchSize: args.batchSize });

  if (result.skipped) {
    throw new Error("DATABASE_URL is not configured. Add the Neon connection string to .env.");
  }

  console.log(`Imported ${result.count} registration rows from ${args.file}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
