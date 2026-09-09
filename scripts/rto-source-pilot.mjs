import fs from "node:fs/promises";
import { fetchPublicRtoStockSegment } from "../lib/public-dashboard-client.mjs";
import { resolvePublicStockScope } from "../lib/public-dashboard-scope.mjs";
import { RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS } from "../lib/rto-daily-snapshots.mjs";

const seed = JSON.parse(await fs.readFile(new URL("../data/vahan/rto-top-100-cohort.json", import.meta.url)));
const mappingOnly = process.argv.includes("--mapping-only");
const members = mappingOnly ? seed.members : seed.members.filter((r) => /BALASORE|^PUNE -|SOUTH \(LADO SARAI\)/.test(r.rto));
if (!mappingOnly && members.length !== 3) throw new Error("Pilot must include Balasore, Pune, and Delhi South.");
const results = [];
const beforeRequest = () => new Promise((resolve) => setTimeout(resolve, 1400));
let failures = 0;
for (const member of members) {
  if (mappingOnly) {
    try {
      const scope = await resolvePublicStockScope({ ...member, ...RTO_DAILY_CATEGORY_FILTERS["2W"], fuels: RTO_DAILY_FUEL_FILTERS.EV, beforeRequest });
      results.push({ ...member, mapping: scope.mapping });
    } catch (error) { failures++; results.push({ ...member, error: error.message }); }
    continue;
  }
  for (const [fuelGroup, fuels] of Object.entries(RTO_DAILY_FUEL_FILTERS)) {
    for (const [vehicleCategory, filter] of Object.entries(RTO_DAILY_CATEGORY_FILTERS)) {
      try {
        const segment = await fetchPublicRtoStockSegment({ ...member, ...filter, fuels, beforeRequest });
        results.push({ ...member, fuelGroup, vehicleCategory, ...segment });
        console.log(JSON.stringify({ rto: member.rto, fuelGroup, vehicleCategory, total: segment.total, oems: segment.makers.length }));
      } catch (error) {
        failures++;
        results.push({ ...member, fuelGroup, vehicleCategory, error: error.message });
        console.log(JSON.stringify(results.at(-1)));
      }
    }
  }
}
await fs.mkdir("artifacts", { recursive: true });
const file = mappingOnly ? "artifacts/rto-source-mapping.json" : "artifacts/rto-source-pilot.json";
await fs.writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), mode: mappingOnly ? "mapping" : "pilot", failures, results }, null, 2) + "\n");
console.log(JSON.stringify({ file, failures, checks: results.length }));
if (failures) process.exitCode = 1;
