import { buildMonthlySalesReport } from "../lib/monthly-sales-report.mjs";

const ALL_RTO = "All Vahan4 Running Office";
const ALL_FILTER = "ALL";
const INDIA_TOTAL = "INDIA TOTAL";
const TWO_WHEELER_FILTER = "TWO WHEELER(NT)|TWO WHEELER(T)";
const THREE_WHEELER_FILTER = "THREE WHEELER(NT)|THREE WHEELER(T)";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function registrationRow(month, vehicleCount) {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    year,
    month: monthNumber,
    state: INDIA_TOTAL,
    rto: ALL_RTO,
    fuel_segment: "NON_EV",
    fuel_type: "PETROL",
    fuel_filter: ALL_FILTER,
    vehicle_category_filter: ALL_FILTER,
    norms_filter: ALL_FILTER,
    vehicle_class_filter: ALL_FILTER,
    vehicle_count: vehicleCount,
    scraped_at: "2026-06-01T00:00:00.000Z",
    source_url: "fixture",
  };
}

function makerRow({ month = "2026-01", maker, vehicleCategoryFilter = ALL_FILTER, vehicleClassFilter = ALL_FILTER, count }) {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    year,
    month: monthNumber,
    state: INDIA_TOTAL,
    rto: ALL_RTO,
    maker,
    fuel_filter: ALL_FILTER,
    vehicle_category_filter: vehicleCategoryFilter,
    norms_filter: ALL_FILTER,
    vehicle_class_filter: vehicleClassFilter,
    vehicle_count: count,
    scraped_at: "2026-06-01T00:00:00.000Z",
    source_url: "fixture",
  };
}

const rows = [
  registrationRow("2025-12", 90),
  registrationRow("2026-01", 100),
];

const makerRows = [
  makerRow({ maker: "BAJAJ AUTO LTD", vehicleCategoryFilter: TWO_WHEELER_FILTER, count: 10 }),
  makerRow({ maker: "HERO MOTOCORP LTD", vehicleCategoryFilter: TWO_WHEELER_FILTER, count: 20 }),
  makerRow({ maker: "BAJAJ AUTO LTD", vehicleCategoryFilter: THREE_WHEELER_FILTER, count: 30 }),
  makerRow({ maker: "TVS MOTOR COMPANY LTD", vehicleCategoryFilter: THREE_WHEELER_FILTER, count: 5 }),
  makerRow({ maker: "TATA MOTORS LTD", count: 999 }),
];

const report = buildMonthlySalesReport({
  rows,
  makerRows,
  month: "2026-01",
  fuelScope: "all",
});

const oemSection = report.sections.find((section) => section.id === "oem_leaders");
assert(oemSection, "expected OEM section");
assert(oemSection.chartData.length === 3, `expected three OEM groups, got ${oemSection.chartData.length}`);

const twoWheeler = oemSection.chartData.find((group) => group.id === "two_wheeler");
const threeWheeler = oemSection.chartData.find((group) => group.id === "three_wheeler");
const fourWheeler = oemSection.chartData.find((group) => group.id === "four_wheeler_private");

const twoWheelerBajaj = twoWheeler.brands.find((brand) => brand.name === "Bajaj Auto");
const threeWheelerBajaj = threeWheeler.brands.find((brand) => brand.name === "Bajaj Auto");
const fourWheelerTata = fourWheeler.brands.find((brand) => brand.name === "Tata Motors");

assert(twoWheeler.status === "partial", `expected 2W OEM rows partial when target brands are missing, got ${twoWheeler.status}`);
assert(threeWheeler.status === "partial", `expected 3W OEM rows partial when target brands are missing, got ${threeWheeler.status}`);
assert(twoWheeler.missingBrands.includes("Honda Motorcycle"), "expected 2W missing brand list to include Honda Motorcycle");
assert(threeWheeler.missingBrands.includes("Mahindra Last Mile Mobility"), "expected 3W missing brand list to include Mahindra Last Mile Mobility");
assert(twoWheelerBajaj.count === 10, `expected 2W Bajaj count 10, got ${twoWheelerBajaj.count}`);
assert(threeWheelerBajaj.count === 30, `expected 3W Bajaj count 30, got ${threeWheelerBajaj.count}`);
assert(fourWheeler.status === "missing", `expected 4W OEM rows missing, got ${fourWheeler.status}`);
assert(fourWheelerTata.count === 0, `expected unfiltered Tata maker row not to leak into 4W, got ${fourWheelerTata.count}`);

console.log("monthly OEM unit check passed");
