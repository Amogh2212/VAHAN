import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryRegistrationRows, readRegistrationsCsv } from "../lib/registrations.mjs";
import { auditMapStateEvidence, normalizeMapEvidenceState } from "../lib/map-evidence.mjs";
import { MAP_EV_FUELS } from "../lib/map-evidence.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2).filter((arg) => arg !== "--database");
const from = args[0] ?? "2026-01";
const to = args[1] ?? "2026-09";
const database = process.argv.includes("--database");
const rows = database
  ? [
    ...await queryRegistrationRows({ from, to, rto: "All Vahan4 Running Office" }),
    ...await queryRegistrationRows({ from, to, rto: "All Vahan4 Running Office", fuelFilters: MAP_EV_FUELS, selectedFuelTypes: MAP_EV_FUELS }),
  ]
  : await readRegistrationsCsv(path.join(root, "data", "vahan", "vahan_fuel_monthly.csv"));
const states = [...new Set(rows.map((row) => normalizeMapEvidenceState(row.state))
  .filter((state) => state !== "INDIA TOTAL" && state !== "All Vahan4 Running States"))].sort();
const results = auditMapStateEvidence(rows, { states, from, to });
const issueCounts = {};
for (const state of results) for (const month of state.missingMonths) for (const issue of month.issues) {
  issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
}
const report = {
  generatedAt: new Date().toISOString(),
  source: database ? "configured database, read only" : "local saved CSV only; deployed database is not included",
  range: { from, to },
  statesChecked: results.length,
  completeStates: results.filter((state) => state.status === "complete").length,
  incompleteStates: results.filter((state) => state.status !== "complete").length,
  issueCounts,
  states: results,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
