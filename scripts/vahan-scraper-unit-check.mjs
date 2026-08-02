import assert from "node:assert/strict";
import fs from "node:fs";
import { hasRequestedSideFilters, resolveMakerReportTotal } from "./vahan-scraper.mjs";

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
