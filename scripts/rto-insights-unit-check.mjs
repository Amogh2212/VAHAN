import assert from "node:assert/strict";
import {
  buildInsightRow,
  buildOverpassQuery,
  geocodeQueriesForRto,
  parseRtoCode,
  placeLabelFromRto,
  summarizeOsmSignal,
} from "../lib/rto-insights.mjs";
import {
  assertValidOverpassBody,
  buildFalloutReport,
  clampFalloutCycles,
  clampWorkerCount,
  freshnessCutoffFor,
  freshnessCutoffForImport,
  groupTargetsByState,
  overpassRetryDelayMs,
  parseArgs,
  signalItemKey,
} from "./import-osm-rto-signals.mjs";
import {
  buildOsmiumExportConfig,
  buildOsmiumFilterExpressions,
  createSpatialIndex,
  haversineKm,
  osmElementFromGeoJsonFeature,
  parseArgs as parseGeofabrikArgs,
  representativeCoordinate,
  shouldPrepareGeofabrikPois,
} from "./import-geofabrik-rto-signals.mjs";

assert.equal(parseRtoCode("Noida RTO UP-16"), "UP-16");
assert.equal(parseRtoCode("WEST (HARI NAGAR) - DL4"), "DL-4");
assert.equal(placeLabelFromRto("Noida RTO UP-16"), "Noida");
assert.deepEqual(
  geocodeQueriesForRto({ state: "Uttar Pradesh", rto: "Noida RTO UP-16" }).slice(0, 2),
  ["UP-16 RTO Uttar Pradesh India", "Noida RTO Uttar Pradesh India"],
);

const query = buildOverpassQuery({
  signalKey: "ev_charging_station_count",
  latitude: 28.5355,
  longitude: 77.391,
  radiusKm: 10,
});
assert.match(query, /\[out:json\]\[timeout:60\]/);
assert.match(query, /node\(around:10000,28\.5355,77\.391\)\["amenity"="charging_station"\]/);
assert.match(query, /out center tags/);

const chargerElements = [
  { type: "node", id: 1, tags: { amenity: "charging_station", name: "Public EV Hub", access: "yes", capacity: "6", operator: "City" } },
  { type: "node", id: 2, tags: { amenity: "charging_station", name: "Private Depot", access: "private", capacity: "12" } },
  { type: "node", id: 1, tags: { amenity: "charging_station", name: "Duplicate" } },
  { type: "node", id: 3, tags: { amenity: "fuel" } },
];
assert.equal(summarizeOsmSignal("ev_charging_station_count", chargerElements).numericValue, 2);
assert.equal(summarizeOsmSignal("public_charging_station_count", chargerElements).numericValue, 1);
assert.equal(summarizeOsmSignal("charger_capacity_sum", chargerElements).numericValue, 18);

assert.ok(buildOsmiumFilterExpressions().includes("nwr/amenity=charging_station"));
assert.ok(buildOsmiumFilterExpressions().includes("nwr/shop=department_store"));
assert.ok(buildOsmiumExportConfig().include_tags.includes("amenity"));
assert.ok(buildOsmiumExportConfig().include_tags.includes("operator"));
const geoJsonElement = osmElementFromGeoJsonFeature({
  type: "Feature",
  id: "n1",
  properties: {
    osm_type: "node",
    osm_id: 1,
    amenity: "charging_station",
    name: "Public EV Hub",
  },
  geometry: { type: "Point", coordinates: [77.391, 28.5355] },
});
assert.equal(geoJsonElement.type, "node");
assert.equal(geoJsonElement.id, 1);
assert.equal(geoJsonElement.tags.amenity, "charging_station");
assert.equal(representativeCoordinate({
  type: "Polygon",
  coordinates: [[
    [77, 28],
    [78, 28],
    [78, 29],
    [77, 29],
    [77, 28],
  ]],
}).latitude, 28.5);
assert.ok(haversineKm(28.5355, 77.391, 28.5355, 77.391) < 0.001);
const poiIndex = createSpatialIndex({ cellDegrees: 0.05 });
poiIndex.add(geoJsonElement);
poiIndex.add({
  type: "node",
  id: 2,
  tags: { amenity: "restaurant" },
  latitude: 28.9,
  longitude: 77.8,
});
assert.equal(poiIndex.within({
  latitude: 28.5355,
  longitude: 77.391,
  radiusKm: 5,
  definition: { tags: [{ amenity: "charging_station" }] },
}).length, 1);
const geofabrikArgs = parseGeofabrikArgs(["--limit", "2000", "--refresh", "--download", "--radius-km", "5,10"]);
assert.equal(geofabrikArgs.limit, 2000);
assert.equal(geofabrikArgs.refresh, true);
assert.equal(geofabrikArgs.download, true);
assert.deepEqual(geofabrikArgs.radiusKm, [5, 10]);
assert.equal(shouldPrepareGeofabrikPois({ poiFileExists: true }), false);
assert.equal(shouldPrepareGeofabrikPois({ poiFileExists: true, refreshSource: true }), true, "a source refresh must rebuild an existing POI cache");

const row = buildInsightRow(
  {
    state: "Uttar Pradesh",
    rto: "Noida RTO UP-16",
    latest_snapshot_date: "2026-07-01",
    ev_total: 2400,
    ice_total: 6000,
    total: 8400,
  },
  {
    signalsByRto: new Map([
      [
        "Uttar Pradesh\u0000Noida RTO UP-16",
        [
          { signalKey: "ev_charging_station_count", numericValue: 2 },
          { signalKey: "public_charging_station_count", numericValue: 1 },
          { signalKey: "charger_capacity_sum", numericValue: 6 },
          { signalKey: "restaurant_count", numericValue: 120 },
          { signalKey: "cafe_count", numericValue: 50 },
          { signalKey: "hotel_count", numericValue: 14 },
          { signalKey: "retail_mall_count", numericValue: 4 },
          { signalKey: "bank_atm_count", numericValue: 80 },
          { signalKey: "vehicle_dealer_service_count", numericValue: 15 },
        ],
      ],
    ]),
    geoByKey: new Map([
      [
        "Uttar Pradesh\u0000Noida RTO UP-16",
        { latitude: 28.5355, longitude: 77.391, confidenceScore: 0.82 },
      ],
    ]),
  },
);
assert.equal(row.patternKey, "ev_demand_ahead_of_chargers");
assert.equal(row.severity, "interesting");
assert.ok(row.score > 40);
assert.ok(row.confidenceScore > 0.8);

const missingGeo = buildInsightRow(
  { state: "Uttarakhand", rto: "Haridwar ARTO - UK8", ev_total: 100, ice_total: 400, total: 500 },
  { signalsByRto: new Map(), geoByKey: new Map() },
);
assert.equal(missingGeo.patternKey, "geo_missing");
assert.equal(missingGeo.score, 0);

const defaultImportArgs = parseArgs([]);
assert.equal(defaultImportArgs.workers, 2);
assert.equal(defaultImportArgs.maxAgeHours, 24);
assert.equal(defaultImportArgs.falloutCycles, 5);
assert.equal(defaultImportArgs.retries, 5);
assert.equal(defaultImportArgs.sleepMs, 3000);
assert.equal(overpassRetryDelayMs(1, { sleepMs: defaultImportArgs.sleepMs, retryJitterMs: 0 }), 3000);
assert.equal(overpassRetryDelayMs(2, { sleepMs: defaultImportArgs.sleepMs, retryJitterMs: 0 }), 6000);
assert.deepEqual(assertValidOverpassBody({ elements: [] }), { elements: [] });
try {
  assertValidOverpassBody({ remark: "runtime error: Query timed out in Overpass API", elements: [] });
  assert.fail("Expected Overpass runtime remarks to fail");
} catch (error) {
  assert.match(error.message, /Overpass returned remark/);
  assert.equal(error.retryable, true);
  assert.equal(error.status, 504);
}
try {
  assertValidOverpassBody({ remark: "line 1: parse error: Unknown type" });
  assert.fail("Expected Overpass parse remarks to fail");
} catch (error) {
  assert.match(error.message, /Overpass returned remark/);
  assert.equal(error.retryable, false);
  assert.equal(error.status, 400);
}
assert.equal(parseArgs(["--workers", "9"]).workers, 3);
assert.equal(parseArgs(["--workers=0"]).workers, 1);
assert.equal(clampWorkerCount("bad"), 2);
assert.equal(parseArgs(["--fallout-cycles", "9"]).falloutCycles, 5);
assert.equal(parseArgs(["--fallout-cycles=0"]).falloutCycles, 1);
assert.equal(clampFalloutCycles("bad"), 5);
assert.equal(parseArgs(["--max-age-hours", "0"]).maxAgeHours, 0);
assert.equal(freshnessCutoffFor(0), null);
assert.ok(freshnessCutoffFor(24) instanceof Date);
assert.equal(freshnessCutoffForImport(parseArgs(["--refresh"])), null);
assert.equal(
  signalItemKey({ state: "Karnataka", rto: "Bengaluru Central RTO - KA01", signalKey: "hotel_count", radiusKm: 10 }),
  "Karnataka\u0000Bengaluru Central RTO - KA01\u0000hotel_count\u000010",
);

const groupedTargets = groupTargetsByState([
  { state: "Karnataka", rto: "Bengaluru Central RTO - KA01" },
  { state: "Maharashtra", rto: "Mumbai Central RTO - MH01" },
  { state: "Karnataka", rto: "Mysuru RTO - KA09" },
]);
assert.deepEqual(groupedTargets.map((group) => group.state), ["Karnataka", "Maharashtra"]);
assert.deepEqual(groupedTargets.map((group) => group.targets.length), [2, 1]);
assert.equal(groupedTargets.flatMap((group) => group.targets).length, 3);

const falloutReport = buildFalloutReport({
  args: parseArgs(["--state", "Karnataka", "--limit", "10"]),
  dryRun: false,
  stats: { written: 5, skipped: 1, freshSkipped: 2, failed: 3 },
  fallout: {
    startedAt: "2026-07-03T00:00:00.000Z",
    totalRtos: 10,
    totalItems: 90,
    failedItems: new Map([
      [
        "Karnataka\u0000Bengaluru Central RTO - KA01\u0000hotel_count\u000010",
        {
          state: "Karnataka",
          rto: "Bengaluru Central RTO - KA01",
          signalKey: "hotel_count",
          radiusKm: 10,
          attempts: 5,
          reason: "overpass_timeout",
        },
      ],
    ]),
    skippedItems: new Map([
      ["Karnataka\u0000Missing RTO\u0000missing_centroid", { state: "Karnataka", rto: "Missing RTO", reason: "missing_centroid", cycle: 1 }],
    ]),
    attemptsByReason: new Map([["overpass_timeout", 3]]),
    retryItems() {
      return Array.from(this.failedItems.values());
    },
  },
});
assert.equal(falloutReport.maxCycles, 5);
assert.equal(falloutReport.totals.remainingFailures, 1);
assert.equal(falloutReport.failureAttemptsByReason.overpass_timeout, 3);
assert.equal(falloutReport.remainingFailures[0].attempts, 5);
assert.equal(falloutReport.skippedItems[0].reason, "missing_centroid");

console.log("RTO insights unit checks passed.");
