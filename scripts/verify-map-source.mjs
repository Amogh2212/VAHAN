import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryRegistrationRows } from "../lib/registrations.mjs";
import { auditMapStateEvidence, MAP_EV_FUELS, normalizeMapEvidenceState } from "../lib/map-evidence.mjs";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [from = "2026-01", to = "2026-09", stateArg = ""] = process.argv.slice(2);
if (from.slice(0, 4) !== to.slice(0, 4)) throw new Error("Verify one calendar year at a time.");
const year = from.slice(0, 4);
const months = [];
for (let month = Number(from.slice(5)); month <= Number(to.slice(5)); month += 1) months.push(month);
if (!months.length || months.some((month) => month < 1 || month > 12)) throw new Error("Invalid month range.");

const dbFilters = { from, to, rto: "All Vahan4 Running Office", ...(stateArg ? { state: stateArg } : {}) };
const savedRows = [
  ...await queryRegistrationRows(dbFilters),
  ...await queryRegistrationRows({ ...dbFilters, fuelFilters: MAP_EV_FUELS, selectedFuelTypes: MAP_EV_FUELS }),
];
const sourceStateArg = ({
  "Andaman and Nicobar Islands": "Andaman & Nicobar Island",
  "Dadra and Nagar Haveli": "UT of DNH and DD",
  "Jammu & Kashmir": "Jammu and Kashmir",
})[stateArg] ?? stateArg;

async function scrapeSource(fuels) {
  const args = [
    "scripts/vahan-scraper.mjs", "--mode", "scrape", "--years", year,
    "--months", months.join(","), "--no-persist", "--no-resume", "--emit-rows-json",
  ];
  if (sourceStateArg) args.push("--states", sourceStateArg);
  if (fuels.length) args.push("--fuels", fuels.join(","));
  let stdout;
  let stderr = "";
  try {
    ({ stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: root, timeout: 20 * 60_000, maxBuffer: 20 * 1024 * 1024,
    }));
  } catch (error) {
    stdout = error.stdout ?? "";
    stderr = error.stderr ?? "";
  }
  const marker = stdout.split(/\r?\n/).find((line) => line.startsWith("VAHAN_SCRAPED_ROWS_JSON:"));
  return {
    rows: marker ? JSON.parse(marker.slice("VAHAN_SCRAPED_ROWS_JSON:".length)) : [],
    errors: stderr.split(/\r?\n/).filter((line) => /^Failed: /.test(line)),
    fatal: marker ? null : stderr.split(/\r?\n/).find((line) => /Error:|EACCES|ETIMEDOUT|timed out/i.test(line)) ?? "No auditable rows returned.",
  };
}

const totalFetch = await scrapeSource([]);
const evFetch = await scrapeSource(MAP_EV_FUELS);
const sourceRows = [...totalFetch.rows, ...evFetch.rows];
const states = stateArg
  ? [normalizeMapEvidenceState(stateArg)]
  : [...new Set([...savedRows, ...sourceRows].map((row) => normalizeMapEvidenceState(row.state))
    .filter((state) => state !== "INDIA TOTAL" && state !== "All Vahan4 Running States"))].sort();
const sourceAudit = auditMapStateEvidence(sourceRows, { states, from, to });
const savedAudit = auditMapStateEvidence(savedRows, { states, from, to });
const savedByState = new Map(savedAudit.map((item) => [item.state, item]));
const comparisons = sourceAudit.map((source) => {
  const saved = savedByState.get(source.state);
  const savedByMonth = new Map(saved.months.map((item) => [item.month, item]));
  const monthsCompared = source.months.map((month) => {
    const prior = savedByMonth.get(month.month);
    return {
      month: month.month,
      sourceTotal: month.total, sourceEv: month.ev, sourceIssues: month.issues,
      savedTotal: prior?.total ?? null, savedEv: prior?.ev ?? null, savedIssues: prior?.issues ?? ["missing_saved_scope"],
      exactCountMatch: !month.issues.length && !prior?.issues.length && month.total === prior.total && month.ev === prior.ev,
    };
  });
  return {
    state: source.state,
    sourceStatus: source.status,
    savedStatus: saved.status,
    exactCountMatch: monthsCompared.every((month) => month.exactCountMatch),
    sourceTotal: source.total, sourceEv: source.evTotal,
    savedTotal: saved.total, savedEv: saved.evTotal,
    months: monthsCompared,
  };
});
process.stdout.write(`${JSON.stringify({
  checkedAt: new Date().toISOString(), from, to,
  source: "Public Dashboard monthly endpoint, read only",
  database: "configured registrations table, read only",
  sourceFetch: { allFuels: { errors: totalFetch.errors, fatal: totalFetch.fatal }, batteryEv: { errors: evFetch.errors, fatal: evFetch.fatal } },
  statesChecked: comparisons.length,
  sourceCompleteStates: comparisons.filter((item) => item.sourceStatus === "complete").length,
  savedCompleteStates: comparisons.filter((item) => item.savedStatus === "complete").length,
  exactCountMatchStates: comparisons.filter((item) => item.exactCountMatch).length,
  states: comparisons,
}, null, 2)}\n`);
