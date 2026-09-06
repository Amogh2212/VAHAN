import assert from "node:assert/strict";
import fs from "node:fs";
import { hasRequestedSideFilters, matchPublicRto, parsePublicFuelDistribution, parsePublicMonthlyRows, publicChartQueryString, publicDirectMonthlyQueryString, publicMonthlyQueryString, publicRtoOptionValue, resolveMakerReportTotal } from "./vahan-scraper.mjs";

const source = fs.readFileSync(new URL("./vahan-scraper.mjs", import.meta.url), "utf8");

assert.equal(hasRequestedSideFilters(), false, "an unfiltered report should not trigger the side-filter refresh");
assert.equal(hasRequestedSideFilters({ vehicleCategories: ["LIGHT MOTOR VEHICLE"] }), true, "an LMV filter must trigger the side-filter refresh even when already checked");
assert.equal(hasRequestedSideFilters({ fuels: ["PETROL"], norms: ["BHARAT STAGE VI"] }), true, "any requested side filter must trigger the side-filter refresh");
assert.deepEqual(
  parsePublicMonthlyRows([], { year: 2026, label: "ALL" }),
  { label: "ALL", counts: {}, explicitZero: true },
  "an explicit empty official table is a verified zero-registration result, not a scrape failure",
);
assert.equal(
  matchPublicRto([{ rtoName: "Noida - UP16", rtoCode: 16 }], "Noida - UP16( 13-NOV-2017 )")?.rtoCode,
  16,
  "the direct adapter must match catalog RTO labels after removing legacy date suffixes",
);
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

assert.deepEqual(
  parsePublicMonthlyRows([
    { yearAsString: "2024-March", registeredVehicleCount: 154 },
    { yearAsString: "2024-April", registeredVehicleCount: "355" },
  ], { year: 2024, label: "PURE EV" }),
  { label: "PURE EV", counts: { 3: 154, 4: 355 } },
  "public dashboard calendar-month rows must retain their original month keys",
);
assert.deepEqual(
  parsePublicMonthlyRows([], { year: 2026, label: "ALL" }),
  { label: "ALL", counts: {}, explicitZero: true },
  "an explicit empty official table is a verified zero-registration result, not a scrape failure",
);
const fourWheelerQuery = publicMonthlyQueryString({
  stateCode: "UP",
  vehicleSubCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
  vehicleFuels: ["PETROL"],
  vehicleClasses: ["Motor Car", "Motor Caravan"],
  vehicleEmissions: ["BHARAT STAGE IV", "BHARAT STAGE VI"],
});
const twoWheelerQuery = publicMonthlyQueryString({
  vehicleSubCategories: ["TWO WHEELER(NT)", "TWO WHEELER(T)"],
});
const threeWheelerQuery = publicMonthlyQueryString({
  vehicleSubCategories: ["THREE WHEELER(NT)", "THREE WHEELER(T)"],
});
const directQuery = publicDirectMonthlyQueryString({
  vehicleFuels: ["PETROL", "DIESEL"],
  vehicleSubCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
});
assert.match(fourWheelerQuery, /vehicleSubCategories%5B%5D=LIGHT\+MOTOR\+VEHICLE/);
assert.match(fourWheelerQuery, /vehicleSubCategories%5B%5D=LIGHT\+PASSENGER\+VEHICLE/);
assert.match(fourWheelerQuery, /vehicleFuels%5B%5D=PETROL/);
assert.match(fourWheelerQuery, /vehicleClasses%5B%5D=Motor\+Car/);
assert.match(fourWheelerQuery, /vehicleClasses%5B%5D=Motor\+Caravan/);
assert.match(fourWheelerQuery, /vehicleEmissions%5B%5D=BHARAT\+STAGE\+IV/);
assert.match(fourWheelerQuery, /vehicleEmissions%5B%5D=BHARAT\+STAGE\+VI/);
assert.doesNotMatch(fourWheelerQuery, /vehicleCategoryGroup/);
assert.match(twoWheelerQuery, /vehicleSubCategories%5B%5D=TWO\+WHEELER%28NT%29/);
assert.match(twoWheelerQuery, /vehicleSubCategories%5B%5D=TWO\+WHEELER%28T%29/);
assert.match(threeWheelerQuery, /vehicleSubCategories%5B%5D=THREE\+WHEELER%28NT%29/);
assert.match(threeWheelerQuery, /vehicleSubCategories%5B%5D=THREE\+WHEELER%28T%29/);
assert.match(directQuery, /vehicleFuels=PETROL/);
assert.match(directQuery, /vehicleFuels=DIESEL/);
assert.match(directQuery, /vehicleSubCategories=LIGHT\+MOTOR\+VEHICLE/);
assert.doesNotMatch(directQuery, /%5B%5D/);
assert.doesNotMatch(twoWheelerQuery, /vehicleCategoryGroup/);
assert.doesNotMatch(threeWheelerQuery, /vehicleCategoryGroup/);
assert.throws(
  () => parsePublicMonthlyRows([{ yearAsString: "2023-January", registeredVehicleCount: 1 }], { year: 2024, label: "PURE EV" }),
  /no monthly values/i,
  "a response outside the requested year must never be persisted under that year",
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
assert.equal(
  publicChartQueryString({ vehicleSubCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"] }),
  "vehicleSubCategories=LIGHT+MOTOR+VEHICLE%2CLIGHT+PASSENGER+VEHICLE",
  "the Public Dashboard fuel chart expects a single comma-separated multi-select value",
);
assert.deepEqual(
  parsePublicFuelDistribution({ labels: ["PETROL", "PURE EV"], data: [120, "34"] }),
  [{ fuelType: "PETROL", count: 120 }, { fuelType: "PURE EV", count: 34 }],
  "one fuel chart response must preserve every raw fuel bucket",
);
assert.equal(
  publicRtoOptionValue([
    { label: "Noida - UP16", value: "UP16" },
    { label: "Ghaziabad - UP14", value: "UP14" },
  ], "Noida - UP16 (13-NOV-2017)"),
  "UP16",
  "a legacy RTO label with a date suffix must resolve by its stable RTO code",
);
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
assert.match(source, /dashboardControlCount < 3 && \/captcha\|unauthori\[sz\]ed\|access denied\//,
  "a normal dashboard Login navigation link must not be treated as an access block");
assert.match(source, /waitForFunction\([\s\S]*?#rtoCode[\s\S]*?options\.length[\s\S]*?> 1/,
  "RTO resolution must wait for the state-specific options rather than sleeping for a fixed interval");
assert.match(
  source,
  /const replacementContexts = new Set\(reportItem\.items\.map\(\(item\) => keyForItem\(item\)\)\);[\s\S]*?replacementContexts\.has\(existingKey\)/,
  "a refreshed report context must remove fuel rows absent from the new VAHAN table",
);
assert.match(
  source,
  /if \(reportItem\.rto && !isAllRtoScope\(reportItem\.rto\)\) \{/,
  "the all-RTO UI sentinel must keep the public dashboard request at rtoCode=0",
);
assert.match(
  source,
  /if \(!reportItem\.fuels\?\.length\) \{\s*const response = await fetchPublicMonthlyTableDirect\(client, monthlyParams\);\s*return \[parsePublicMonthlyRows\(response, \{ year: reportItem\.year, label: "ALL" \}\)\];/,
  "an unfiltered aggregate must use one official aggregate request rather than fail on missing rare-fuel rows",
);

console.log("vahan scraper unit checks passed");
