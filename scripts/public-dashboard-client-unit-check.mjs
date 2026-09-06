import assert from "node:assert/strict";
import {
  fetchPublicDashboardRows,
  fetchPublicFuelDistribution,
  parsePublicMonthlyCounts,
  publicChartQueryString,
  publicMonthlyQueryString,
  publicRtoCode,
  publicStateCode,
  publicVehicleClassValue,
} from "../lib/public-dashboard-client.mjs";

assert.equal(publicStateCode("Uttar Pradesh", "Noida - UP16 (13-NOV-2017)"), "UP");
assert.equal(publicStateCode("Maharashtra"), "MH");
const officialStateCodes = new Map([
  ["Andaman & Nicobar Island", "AN"], ["Andhra Pradesh", "AP"], ["Arunachal Pradesh", "AR"],
  ["Assam", "AS"], ["Bihar", "BR"], ["Chandigarh", "CH"], ["Chhattisgarh", "CG"],
  ["Delhi", "DL"], ["Goa", "GA"], ["Gujarat", "GJ"], ["Haryana", "HR"],
  ["Himachal Pradesh", "HP"], ["Jammu & Kashmir", "JK"], ["Jharkhand", "JH"],
  ["Karnataka", "KA"], ["Kerala", "KL"], ["Ladakh", "LA"], ["Lakshadweep", "LD"],
  ["Madhya Pradesh", "MP"], ["Maharashtra", "MH"], ["Manipur", "MN"], ["Meghalaya", "ML"],
  ["Mizoram", "MZ"], ["Nagaland", "NL"], ["Odisha", "OR"], ["Puducherry", "PY"],
  ["Punjab", "PB"], ["Rajasthan", "RJ"], ["Sikkim", "SK"], ["Tamil Nadu", "TN"],
  ["Telangana", "TG"], ["Tripura", "TR"], ["UT of DNH and DD", "DD"],
  ["Uttar Pradesh", "UP"], ["Uttarakhand", "UK"], ["West Bengal", "WB"],
]);
for (const [state, code] of officialStateCodes) {
  assert.equal(publicStateCode(state), code, `${state} should use the official Public Dashboard code`);
}
assert.equal(publicRtoCode("Noida - UP16 (13-NOV-2017)"), "16");
assert.equal(publicRtoCode("All Vahan4 Running Office"), "0");
assert.match(publicMonthlyQueryString({ vehicleSubCategories: ["LMV", "LPV"] }), /vehicleSubCategories%5B%5D=LMV.*vehicleSubCategories%5B%5D=LPV/);
assert.match(publicMonthlyQueryString({ vehicleFuels: ["PURE EV"] }), /vehicleFuels%5B%5D=PURE\+EV/);
assert.match(publicMonthlyQueryString({ vehicleType: "", archiveTypePA: "" }), /vehicleType=&archiveTypePA=/);
assert.match(publicChartQueryString({ vehicleSubCategories: ["LMV", "LPV"] }), /vehicleSubCategories=LMV%2CLPV/);
assert.equal(publicVehicleClassValue("MOTOR CAR"), "Motor Car");
assert.equal(publicVehicleClassValue("BUS"), "Bus");
assert.equal(publicVehicleClassValue("GOODS CARRIER"), "Goods Carrier");
assert.equal(publicVehicleClassValue("E-RICKSHAW(P)"), "e-Rickshaw(P)");
assert.equal(publicVehicleClassValue("M-CYCLE/SCOOTER"), "M-Cycle/Scooter");

const monthlyResponse = [
  { yearAsString: "2026-August", registeredVehicleCount: 3329 },
  { yearAsString: "2026-February", registeredVehicleCount: "3,914" },
];
assert.deepEqual([...parsePublicMonthlyCounts(monthlyResponse, 2026)], [[8, 3329], [2, 3914]]);

const requests = [];
const fetchImpl = async (url, options) => {
  requests.push({ url, options });
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
  fuels: ["PURE EV"],
  vehicleCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
  vehicleClasses: ["MOTOR CAR"],
  fetchImpl,
});
assert.equal(rows.length, 1);
assert.equal(rows[0].vehicle_count, 3329);
assert.equal(rows[0].vehicle_category_filter, "LIGHT MOTOR VEHICLE|LIGHT PASSENGER VEHICLE");
assert.match(requests[0].url, /stateCode=UP/);
assert.match(requests[0].url, /rtoCode=16/);
assert.match(requests[0].url, /vehicleSubCategories%5B%5D=LIGHT\+MOTOR\+VEHICLE/);
assert.match(requests[0].url, /vehicleClasses%5B%5D=Motor\+Car/);
assert.match(requests[0].url, /vehicleFuels%5B%5D=PURE\+EV/);
assert.match(requests[0].url, /calendarType=3/);
assert.match(requests[0].url, /vehicleType=&/);
assert.match(requests[0].url, /archiveTypePA=&archiveTypeTA=&archiveTypeNA=/);
assert.deepEqual(requests[0].options.headers, {
  accept: "*/*",
  "x-requested-with": "XMLHttpRequest",
  referer: "https://analytics.parivahan.gov.in/analytics/publicdashboard/vahan?lang=en",
});

const emptyResponseRows = await fetchPublicDashboardRows({
  state: "Uttar Pradesh",
  rto: "Noida - UP16 (13-NOV-2017)",
  year: 2026,
  months: [8],
  fuels: ["PLUG-IN HYBRID EV"],
  fetchImpl: async () => new Response(JSON.stringify([]), { status: 200 }),
});
assert.equal(emptyResponseRows[0].vehicle_count, 0);
assert.equal(emptyResponseRows[0].explicit_zero, true);

const sourceZeroRows = await fetchPublicDashboardRows({
  state: "Uttar Pradesh",
  rto: "Noida - UP16 (13-NOV-2017)",
  year: 2026,
  months: [8],
  fuels: ["PLUG-IN HYBRID EV"],
  fetchImpl: async () => new Response(JSON.stringify([{ yearAsString: "2026-August", registeredVehicleCount: 0 }]), { status: 200 }),
});
assert.equal(sourceZeroRows[0].vehicle_count, 0);
assert.equal(sourceZeroRows[0].archive_scope, "ACTIVE_ONLY");

const sparseZeroRows = await fetchPublicDashboardRows({
  state: "Karnataka",
  year: 2025,
  months: [8],
  fuels: ["PLUG-IN HYBRID EV"],
  vehicleClasses: ["MOTOR CAR"],
  fetchImpl: async () => new Response(JSON.stringify([
    { yearAsString: "2025-May", registeredVehicleCount: 1 },
    { yearAsString: "2025-April", registeredVehicleCount: 0 },
  ]), { status: 200 }),
});
assert.equal(sparseZeroRows[0].vehicle_count, 0, "an omitted requested month in an otherwise valid year response is an explicit zero");
assert.equal(sparseZeroRows[0].explicit_zero, true);

let archiveRequest = 0;
const archivedFallbackRows = await fetchPublicDashboardRows({
  state: "Punjab",
  year: 2025,
  months: [6],
  vehicleClasses: ["E-RICKSHAW(P)"],
  fetchImpl: async (url) => {
    archiveRequest += 1;
    if (archiveRequest === 1) return new Response(JSON.stringify([]), { status: 200 });
    assert.match(url, /archiveTypePA=PERMANENT_ARCHIVE/);
    assert.match(url, /archiveTypeTA=TEMPORARY_ARCHIVE/);
    return new Response(JSON.stringify([{ yearAsString: "2025-June", registeredVehicleCount: 965 }]), { status: 200 });
  },
});
assert.equal(archivedFallbackRows[0].vehicle_count, 965);
assert.equal(archivedFallbackRows[0].archive_scope, "ACTIVE_AND_ARCHIVED");

const distribution = await fetchPublicFuelDistribution({
  state: "Uttar Pradesh",
  rto: "Noida - UP16 (13-NOV-2017)",
  year: 2026,
  vehicleCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
  fetchImpl,
});
assert.deepEqual(distribution, [{ fuelType: "PETROL", count: 100 }, { fuelType: "PURE EV", count: 25 }]);
assert.match(requests[1].url, /vehicleSubCategories=LIGHT\+MOTOR\+VEHICLE%2CLIGHT\+PASSENGER\+VEHICLE/);

console.log("public-dashboard-client-unit-check: ok");
