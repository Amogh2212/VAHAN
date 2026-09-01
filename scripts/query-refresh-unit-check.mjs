import assert from "node:assert/strict";
import {
  canonicalRefreshJson,
  canonicalRefreshKey,
  publicDashboardRefreshEligibility,
} from "../lib/query-refresh-audit.mjs";
import { enforceRateLimit } from "../lib/http-security.mjs";
const { requestedPublicFuelFilters } = await import("../server.mjs");

const first = {
  from: "2024-01", to: "2024-03", state: "Maharashtra",
  fuelFilters: ["PURE EV"], vehicleCategories: ["LIGHT MOTOR VEHICLE"],
};
const equivalent = {
  vehicleCategories: ["LIGHT MOTOR VEHICLE"], fuelFilters: ["PURE EV"],
  state: "Maharashtra", to: "2024-03", from: "2024-01",
};
const groups = [{ year: 2024, months: [3, 1, 2] }];

assert.equal(canonicalRefreshJson(first), canonicalRefreshJson(equivalent));
assert.equal(
  canonicalRefreshKey(first, groups),
  canonicalRefreshKey(equivalent, [{ year: 2024, months: [1, 2, 3] }]),
  "equivalent queries must use the same refresh job key",
);
assert.deepEqual(publicDashboardRefreshEligibility(first), { eligible: true, reason: null });
assert.deepEqual(requestedPublicFuelFilters({ selectedFuelTypes: ["DIESEL", "PETROL"] }), ["DIESEL", "PETROL"]);
assert.deepEqual(
  publicDashboardRefreshEligibility({
    ...first,
    fuelFilters: ["DIESEL", "PETROL"],
    vehicleCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
    vehicleClasses: ["MOTOR CAR", "MOTOR CARAVAN"],
    norms: ["BHARAT STAGE IV", "BHARAT STAGE VI"],
  }),
  { eligible: true, reason: null },
  "inclusive multi-select filters must refresh through the public dashboard",
);
assert.deepEqual(
  publicDashboardRefreshEligibility({
    ...first,
    fuelFilters: [],
    vehicleCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
    excludedVehicleCategories: ["FOUR WHEELER (Invalid Carriage)"],
  }),
  { eligible: true, reason: null },
  "4W must permit the verified LMV plus LPV multi-select contract",
);
assert.match(
  publicDashboardRefreshEligibility({ ...first, excludedVehicleCategories: ["LIGHT PASSENGER VEHICLE"] }).reason,
  /excluded dashboard filters/i,
);

const rateGroup = `dashboard-query-unit-${Date.now()}`;
const options = { group: rateGroup, max: 1, windowMs: 60_000, globalMax: 100, trustedProxyHops: 1, store: "memory" };
await enforceRateLimit({ ...options, request: { headers: { "x-forwarded-for": "198.51.100.1" } }, userId: 42 });
await assert.rejects(
  () => enforceRateLimit({ ...options, request: { headers: { "x-forwarded-for": "198.51.100.2" } }, userId: 42 }),
  (error) => error.statusCode === 429 && Boolean(error.headers?.["retry-after"]),
);
await enforceRateLimit({ ...options, group: `${rateGroup}-guest`, request: { headers: { "x-forwarded-for": "198.51.100.3" } } });
await assert.rejects(
  () => enforceRateLimit({ ...options, group: `${rateGroup}-guest`, request: { headers: { "x-forwarded-for": "198.51.100.3" } } }),
  (error) => error.statusCode === 429 && Boolean(error.headers?.["retry-after"]),
);

console.log("query refresh unit checks passed");
