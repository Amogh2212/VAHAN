import assert from "node:assert/strict";
import {
  fetchPublicDashboardRows,
  fetchPublicFuelDistribution,
  parsePublicMonthlyCounts,
  publicChartQueryString,
  publicMonthlyQueryString,
  publicRtoCode,
  publicStateCode,
} from "../lib/public-dashboard-client.mjs";

assert.equal(publicStateCode("Uttar Pradesh", "Noida - UP16 (13-NOV-2017)"), "UP");
assert.equal(publicStateCode("Maharashtra"), "MH");
assert.equal(publicRtoCode("Noida - UP16 (13-NOV-2017)"), "16");
assert.equal(publicRtoCode("All Vahan4 Running Office"), "0");
assert.match(publicMonthlyQueryString({ vehicleSubCategories: ["LMV", "LPV"] }), /vehicleSubCategories%5B%5D=LMV.*vehicleSubCategories%5B%5D=LPV/);
assert.match(publicChartQueryString({ vehicleSubCategories: ["LMV", "LPV"] }), /vehicleSubCategories=LMV%2CLPV/);

const monthlyResponse = [
  { yearAsString: "2026-August", registeredVehicleCount: 3329 },
  { yearAsString: "2026-February", registeredVehicleCount: "3,914" },
];
assert.deepEqual([...parsePublicMonthlyCounts(monthlyResponse, 2026)], [[8, 3329], [2, 3914]]);

const requests = [];
const fetchImpl = async (url) => {
  requests.push(url);
  if (url.includes("fueltypedonutchart")) {
    return new Response(JSON.stringify({ labels: ["PETROL", "PURE EV"], data: [100, 25] }), { status: 200 });
  }
  return new Response(JSON.stringify(monthlyResponse), { status: 200 });
};

const rows = await fetchPublicDashboardRows({
  state: "Uttar Pradesh",
  rto: "Noida - UP16 (13-NOV-2017)",
  year: 2026,
  months: [8],
  vehicleCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
  fetchImpl,
});
assert.equal(rows.length, 1);
assert.equal(rows[0].vehicle_count, 3329);
assert.equal(rows[0].vehicle_category_filter, "LIGHT MOTOR VEHICLE|LIGHT PASSENGER VEHICLE");
assert.match(requests[0], /stateCode=UP/);
assert.match(requests[0], /rtoCode=16/);
assert.match(requests[0], /vehicleSubCategories%5B%5D=LIGHT\+MOTOR\+VEHICLE/);

const zeroRows = await fetchPublicDashboardRows({
  state: "Uttar Pradesh",
  rto: "Noida - UP16 (13-NOV-2017)",
  year: 2026,
  months: [8],
  fuels: ["PLUG-IN HYBRID EV"],
  fetchImpl: async () => new Response(JSON.stringify([]), { status: 200 }),
});
assert.equal(zeroRows[0].vehicle_count, 0);

const distribution = await fetchPublicFuelDistribution({
  state: "Uttar Pradesh",
  rto: "Noida - UP16 (13-NOV-2017)",
  year: 2026,
  vehicleCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
  fetchImpl,
});
assert.deepEqual(distribution, [{ fuelType: "PETROL", count: 100 }, { fuelType: "PURE EV", count: 25 }]);
assert.match(requests[1], /vehicleSubCategories=LIGHT\+MOTOR\+VEHICLE%2CLIGHT\+PASSENGER\+VEHICLE/);

console.log("public-dashboard-client-unit-check: ok");
