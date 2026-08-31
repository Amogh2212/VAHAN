import assert from "node:assert/strict";
import {
  canonicalRefreshJson,
  canonicalRefreshKey,
  publicDashboardRefreshEligibility,
} from "../lib/query-refresh-audit.mjs";
import { enforceRateLimit } from "../lib/http-security.mjs";

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
assert.match(publicDashboardRefreshEligibility({ ...first, fuelFilters: [] }).reason, /one exact fuel type/i);
assert.match(publicDashboardRefreshEligibility({ ...first, vehicleClasses: ["A", "B"] }).reason, /multiple vehicleClasses/i);

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
