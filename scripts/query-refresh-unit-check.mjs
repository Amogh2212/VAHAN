import assert from "node:assert/strict";
import {
  canonicalRefreshJson,
  canonicalRefreshKey,
  publicDashboardRefreshEligibility,
} from "../lib/query-refresh-audit.mjs";
import { enforceRateLimit } from "../lib/http-security.mjs";

const {
  dashboardPayload,
  findPendingRefreshJob,
  requestedPublicFuelFilters,
  unfilteredComparisonFilters,
} = await import("../server.mjs");

const first = {
  from: "2024-01",
  to: "2024-03",
  state: "Maharashtra",
  fuelFilters: ["PURE EV"],
  vehicleCategories: ["LIGHT MOTOR VEHICLE"],
};
const equivalent = {
  vehicleCategories: ["LIGHT MOTOR VEHICLE"],
  fuelFilters: ["PURE EV"],
  state: "Maharashtra",
  to: "2024-03",
  from: "2024-01",
};
const groups = [{ year: 2024, months: [3, 1, 2] }];

assert.equal(
  canonicalRefreshJson(first),
  canonicalRefreshJson(equivalent),
  "equivalent dashboard filters must produce stable audit JSON",
);
assert.equal(
  canonicalRefreshKey(first, groups),
  canonicalRefreshKey(equivalent, [{ year: 2024, months: [1, 2, 3] }]),
  "equivalent refresh requests must share a canonical lock key",
);

const fuelRestrictionBase = {
  ...first,
  fuelFilters: [],
  from: "2024-01",
  to: "2024-01",
};
const excludesPetrol = { ...fuelRestrictionBase, excludedFuelTypes: ["PETROL"] };
const excludesDiesel = { ...fuelRestrictionBase, excludedFuelTypes: ["DIESEL"] };
assert.notEqual(
  canonicalRefreshKey(excludesPetrol, groups),
  canonicalRefreshKey(excludesDiesel, groups),
  "different excluded fuel types must not share a refresh job key",
);
assert.equal(
  canonicalRefreshKey(
    { ...fuelRestrictionBase, excludedFuelTypes: ["PETROL", "DIESEL"] },
    groups,
  ),
  canonicalRefreshKey(
    { ...fuelRestrictionBase, excludedFuelTypes: ["DIESEL", "PETROL"] },
    groups,
  ),
  "equivalent excluded fuel type orderings must share a refresh job key",
);
assert.notEqual(
  canonicalRefreshKey({ ...fuelRestrictionBase, fuelSegment: "EV" }, groups),
  canonicalRefreshKey({ ...fuelRestrictionBase, fuelSegment: "ICE" }, groups),
  "different fuel segments must not share a refresh job key",
);
assert.notEqual(
  canonicalRefreshKey({ ...fuelRestrictionBase, fuelType: "PETROL" }, groups),
  canonicalRefreshKey({ ...fuelRestrictionBase, fuelType: "DIESEL" }, groups),
  "different fuel type restrictions must not share a refresh job key",
);

const mockedPendingJobs = new Map();
const mockedJobsByCanonicalKey = new Map();
let nextMockedJobId = 1;
const requestMockedRefresh = (filters, total) => {
  const canonicalKey = canonicalRefreshKey(filters, groups);
  const existing = findPendingRefreshJob({
    jobsByCanonicalKey: mockedJobsByCanonicalKey,
    jobs: mockedPendingJobs,
    canonicalKey,
  });
  if (existing) return existing;
  const job = {
    id: String(nextMockedJobId++),
    status: "pending",
    filters,
    payload: { total },
  };
  mockedPendingJobs.set(job.id, job);
  mockedJobsByCanonicalKey.set(canonicalKey, job.id);
  return job;
};
const petrolExclusionJob = requestMockedRefresh(excludesPetrol, 90);
const dieselExclusionJob = requestMockedRefresh(excludesDiesel, 70);
const repeatedPetrolExclusionJob = requestMockedRefresh(
  { ...fuelRestrictionBase, excludedFuelTypes: ["PETROL"] },
  999,
);
assert.notEqual(
  petrolExclusionJob.id,
  dieselExclusionJob.id,
  "overlapping requests with different fuel exclusions must not reuse a pending job",
);
assert.equal(
  repeatedPetrolExclusionJob.id,
  petrolExclusionJob.id,
  "identical overlapping requests must reuse their pending job",
);
assert.deepEqual(petrolExclusionJob.filters, excludesPetrol);
assert.deepEqual(dieselExclusionJob.filters, excludesDiesel);
assert.equal(petrolExclusionJob.payload.total, 90);
assert.equal(dieselExclusionJob.payload.total, 70);
assert.deepEqual(publicDashboardRefreshEligibility(first), { eligible: true, reason: null });
assert.deepEqual(
  requestedPublicFuelFilters({ selectedFuelTypes: ["DIESEL", "PETROL"] }),
  ["DIESEL", "PETROL"],
  "selected multi-fuel queries must be passed to the scraper as exact fuel selections",
);
assert.deepEqual(
  requestedPublicFuelFilters({ fuelFilters: ["PURE EV"], selectedFuelTypes: ["DIESEL", "PETROL"] }),
  ["PURE EV"],
  "an explicit filter context must take precedence over inferred fuel selections",
);
assert.deepEqual(
  requestedPublicFuelFilters({ vehicleClasses: ["MOTOR CAR"] }),
  [],
  "class-only refreshes must not synthesize a fuel request or depend on fuel-distribution data",
);
assert.deepEqual(
  unfilteredComparisonFilters({
    state: "West Bengal",
    fuelFilters: ["PURE EV"],
    selectedFuelTypes: ["PURE EV"],
    fuelSegment: "EV",
    fuelType: "PURE EV",
    vehicleCategories: ["LIGHT MOTOR VEHICLE"],
  }),
  {
    state: "West Bengal",
    fuelFilters: [],
    selectedFuelTypes: [],
    fuelSegment: null,
    fuelType: null,
    vehicleCategories: [],
    norms: [],
    vehicleClasses: [],
    selectedVehicleGroups: [],
    selectedVehicleClasses: [],
    selectedVehicleCategories: [],
    selectedNorms: [],
  },
  "the aggregate baseline must remove every Pure EV selection before checking whether VAHAN ignored a filter",
);
assert.deepEqual(
  publicDashboardRefreshEligibility({ ...first, fuelFilters: [] }),
  { eligible: true, reason: null },
  "no fuel filter is collected as individually sourced fuel rows",
);
assert.deepEqual(
  publicDashboardRefreshEligibility({
    ...first,
    fuelFilters: [],
    vehicleCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
    excludedVehicleCategories: ["FOUR WHEELER (Invalid Carriage)"],
  }),
  { eligible: true, reason: null },
  "4W must permit the dashboard's verified LMV plus LPV multi-select contract",
);
assert.deepEqual(
  publicDashboardRefreshEligibility({
    ...first,
    fuelFilters: ["PETROL", "DIESEL"],
    vehicleCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
    vehicleClasses: ["MOTOR CAR", "MOTOR CARAVAN"],
    norms: ["BHARAT STAGE IV", "BHARAT STAGE VI"],
  }),
  { eligible: true, reason: null },
  "inclusive multi-select fuel, category, class, and norm filters must refresh through the public dashboard",
);
assert.match(
  publicDashboardRefreshEligibility({
    ...first,
    excludedVehicleCategories: ["LIGHT PASSENGER VEHICLE"],
  }).reason,
  /excluded dashboard filters/i,
  "exclusions remain blocked because the public dashboard does not provide an equivalent exclusion request",
);

const displayFilters = {
  from: "2024-01",
  to: "2024-01",
  state: "Maharashtra",
  selectedFuelTypes: ["PURE EV"],
};
const displayRows = [{
  state: "Maharashtra",
  rto: "ALL RTO",
  year: 2024,
  month: 1,
  fuel_type: "PURE EV",
  fuel_segment: "EV",
  vehicle_count: 1,
  vehicle_category: "ALL",
  norm: "ALL",
  vehicle_class: "ALL",
}];
const payloadFor = (overrides = {}) => dashboardPayload({
  filters: displayFilters,
  rows: displayRows,
  missingMonths: [],
  ...overrides,
});
assert.equal(payloadFor().dataStatus, "complete", "cached contract should render complete data");
assert.equal(
  payloadFor({
    rows: [],
    missingMonths: [{ year: 2024, months: [1] }],
    liveRefresh: { status: "pending", requiredMonths: ["2024-01"] },
  }).dataStatus,
  "refreshing",
  "fetching contract should render refreshing data",
);
assert.equal(
  payloadFor({ liveRefresh: { status: "complete", requiredMonths: ["2024-01"] } }).dataStatus,
  "complete",
  "completed refresh contract should render complete data",
);
assert.equal(
  payloadFor({
    rows: [],
    missingMonths: [{ year: 2024, months: [1] }],
    scraperRuns: [{ year: 2024, months: [1], success: false, rows: [], error: "upstream unavailable" }],
    liveRefresh: { status: "failed", requiredMonths: ["2024-01"] },
  }).dataStatus,
  "fetch_failed",
  "failed refresh contract should not present missing data as complete",
);
assert.equal(
  payloadFor({
    rows: [],
    missingMonths: [],
    scraperRuns: [{ year: 2024, months: [1], success: true, rows: [{ vehicle_count: 1 }] }],
    liveRefresh: { status: "complete", requiredMonths: ["2024-01"] },
  }).dataStatus,
  "missing",
  "successful scrape with no exact-filtered rows must remain unverified",
);

const rateGroup = `dashboard-query-unit-${Date.now()}`;
const limitOptions = {
  group: rateGroup,
  max: 1,
  windowMs: 60_000,
  globalMax: 100,
  trustedProxyHops: 1,
  store: "memory",
};
await enforceRateLimit({
  ...limitOptions,
  request: { headers: { "x-forwarded-for": "198.51.100.1" } },
  userId: 42,
});
await assert.rejects(
  () => enforceRateLimit({
    ...limitOptions,
    request: { headers: { "x-forwarded-for": "198.51.100.2" } },
    userId: 42,
  }),
  (error) => error.statusCode === 429 && Boolean(error.headers?.["retry-after"]),
  "the authenticated-user bucket must apply across IP addresses",
);
await enforceRateLimit({
  ...limitOptions,
  group: `${rateGroup}-guest`,
  request: { headers: { "x-forwarded-for": "198.51.100.3" } },
});
await assert.rejects(
  () => enforceRateLimit({
    ...limitOptions,
    group: `${rateGroup}-guest`,
    request: { headers: { "x-forwarded-for": "198.51.100.3" } },
  }),
  (error) => error.statusCode === 429 && Boolean(error.headers?.["retry-after"]),
  "guests must be limited by IP and receive a retry hint",
);

console.log("query refresh unit checks passed");
