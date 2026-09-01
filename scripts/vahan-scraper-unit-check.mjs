import assert from "node:assert/strict";
import fs from "node:fs";
import { hasRequestedSideFilters, parsePublicMonthlyRows, publicMonthlyQueryString, resolveMakerReportTotal } from "./vahan-scraper.mjs";

const source = fs.readFileSync(new URL("./vahan-scraper.mjs", import.meta.url), "utf8");

assert.equal(hasRequestedSideFilters(), false, "an unfiltered report should not trigger the side-filter refresh");
assert.equal(hasRequestedSideFilters({ vehicleCategories: ["LIGHT MOTOR VEHICLE"] }), true, "an LMV filter must trigger the side-filter refresh even when already checked");
assert.equal(hasRequestedSideFilters({ fuels: ["PETROL"], norms: ["BHARAT STAGE VI"] }), true, "any requested side filter must trigger the side-filter refresh");
assert.equal(
  resolveMakerReportTotal({
    metricTotal: 998,
    rows: [
      { maker: "MARUTI SUZUKI INDIA LTD", vehicle_count: 444 },
      { maker: "MAHINDRA & MAHINDRA LIMITED", vehicle_count: 403 },
      { maker: "HYUNDAI MOTOR INDIA LTD", vehicle_count: 171 },
      { maker: "TATA MOTORS LTD", vehicle_count: 98 },
      { maker: "JSW MG MOTOR INDIA PVT LTD", vehicle_count: 7 },
    ],
  }),
  1123,
  "maker reports must not store a metric total lower than the extracted maker rows",
);
assert.equal(
  resolveMakerReportTotal({ metricTotal: 1200, rows: [{ maker: "A", vehicle_count: 5 }] }),
  1200,
  "a larger VAHAN metric total should still be preserved",
);
assert.deepEqual(
  parsePublicMonthlyRows([
    { yearAsString: "2024-March", registeredVehicleCount: 154 },
    { yearAsString: "2024-April", registeredVehicleCount: "355" },
  ], { year: 2024, label: "PURE EV" }),
  { label: "PURE EV", counts: { 3: 154, 4: 355 } },
  "public dashboard calendar-month rows must retain their original month keys",
);
const multiSelectQuery = publicMonthlyQueryString({
  vehicleSubCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
  vehicleClasses: ["Motor Car", "Motor Caravan"],
  vehicleEmissions: ["BHARAT STAGE IV", "BHARAT STAGE VI"],
  vehicleFuels: ["DIESEL", "PETROL"],
});
assert.match(multiSelectQuery, /vehicleSubCategories%5B%5D=LIGHT\+MOTOR\+VEHICLE/);
assert.match(multiSelectQuery, /vehicleSubCategories%5B%5D=LIGHT\+PASSENGER\+VEHICLE/);
assert.match(multiSelectQuery, /vehicleClasses%5B%5D=Motor\+Car/);
assert.match(multiSelectQuery, /vehicleEmissions%5B%5D=BHARAT\+STAGE\+VI/);
assert.match(multiSelectQuery, /vehicleFuels%5B%5D=DIESEL/);
assert.match(multiSelectQuery, /vehicleFuels%5B%5D=PETROL/);
assert.doesNotMatch(multiSelectQuery, /vehicleCategoryGroup/);
assert.throws(
  () => parsePublicMonthlyRows([{ yearAsString: "2023-January", registeredVehicleCount: 1 }], { year: 2024, label: "PURE EV" }),
  /no monthly values/i,
  "a response outside the requested year must never be persisted under that year",
);
assert.equal(
  resolveMakerReportTotal({ metricTotal: 44, rows: [{ maker: "A", vehicle_count: 5 }], explicitZero: true }),
  0,
  "explicit zero evidence should force a zero total",
);

assert.match(
  source,
  /const shouldRefreshSideFilters = hasRequestedSideFilters\([\s\S]*?if \(shouldRefreshSideFilters\) \{\s*await applySideFilters\(page\);/,
  "requested side filters must refresh VAHAN even when their checkboxes were already selected",
);
assert.match(
  source,
  /const replacementContexts = new Set\(reportItem\.items\.map\(\(item\) => keyForItem\(item\)\)\);[\s\S]*?replacementContexts\.has\(existingKey\)/,
  "a refreshed report context must remove fuel rows absent from the new VAHAN table",
);

console.log("vahan scraper unit checks passed");
