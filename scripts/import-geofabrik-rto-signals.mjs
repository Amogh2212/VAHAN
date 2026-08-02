import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { closePool, query } from "../lib/db.mjs";
import {
  OSM_SIGNAL_DEFINITIONS,
  RTO_INSIGHT_DEFAULT_RADIUS_KM,
  RTO_INSIGHT_PROVIDER_OSM,
  summarizeOsmSignal,
  upsertRtoExternalSignal,
} from "../lib/rto-insights.mjs";
import { listRtoDailyRtos } from "../lib/rto-daily-snapshots.mjs";

const DEFAULT_GEOFABRIK_URL = "https://download.geofabrik.de/asia/india-latest.osm.pbf";
const DEFAULT_WORK_DIR = path.join("data", "rto-insights", "geofabrik");
const DEFAULT_SOURCE_FILE = "india-latest.osm.pbf";
const DEFAULT_FILTERED_FILE = "osm-signals-filtered.osm.pbf";
const DEFAULT_POIS_FILE = "osm-signals.geojsonseq";
const DEFAULT_EXPRESSIONS_FILE = "osm-signals-filter.txt";
const DEFAULT_EXPORT_CONFIG_FILE = "osm-signals-export-config.json";
const DEFAULT_MAX_AGE_HOURS = 24;
const DEFAULT_LIMIT = 5;
const DEFAULT_CELL_DEGREES = 0.1;
const DOWNLOAD_PROGRESS_INTERVAL_MS = 5000;

const EXTRA_EVIDENCE_TAGS = ["name", "brand", "operator", "capacity", "access"];

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  await runImport(args);
}

export async function runImport(args) {
  const paths = resolvePaths(args);
  await fs.mkdir(paths.workDir, { recursive: true });

  if (args.download) {
    await downloadGeofabrikExtract({
      url: args.geofabrikUrl,
      outputPath: paths.sourceFile,
      overwrite: args.refreshSource,
    });
  }

  const shouldPrepare = shouldPrepareGeofabrikPois({
    skipPrepare: args.skipPrepare,
    poisFile: args.poisFile,
    prepareOnly: args.prepareOnly,
    refreshSource: args.refreshSource,
    poiFileExists: await fileExists(paths.poisFile),
  });
  if (shouldPrepare) {
    await prepareGeofabrikPois({
      sourceFile: paths.sourceFile,
      filteredFile: paths.filteredFile,
      poisFile: paths.poisFile,
      expressionsFile: paths.expressionsFile,
      exportConfigFile: paths.exportConfigFile,
      osmiumBin: args.osmiumBin,
      overwrite: args.refreshSource,
    });
  }

  if (args.prepareOnly) {
    console.log(`[rto-insights:geofabrik] prepared POI file at ${paths.poisFile}`);
    return { prepared: true, poisFile: paths.poisFile };
  }

  if (!(await fileExists(paths.poisFile))) {
    throw new Error(`Missing Geofabrik POI file: ${paths.poisFile}. Run with --download, provide --source-file, or pass --pois-file.`);
  }

  const dryRun = !args.write;
  const radii = args.radiusKm.length ? args.radiusKm : [RTO_INSIGHT_DEFAULT_RADIUS_KM];
  const selectedSignals = selectSignals(args.signals);
  const freshnessCutoff = freshnessCutoffForImport(args);
  const targets = await loadTargets(args);

  console.log(`[rto-insights:geofabrik] ${dryRun ? "dry-run" : "write"} mode for ${targets.length} RTO(s), ${selectedSignals.length} signal(s), radii ${radii.join(",")} km`);
  console.log(`[rto-insights:geofabrik] POI source ${paths.poisFile}`);
  if (freshnessCutoff) console.log(`[rto-insights:geofabrik] skip fresh signals fetched since ${freshnessCutoff.toISOString()} (--max-age-hours ${args.maxAgeHours})`);
  if (args.refresh) console.log("[rto-insights:geofabrik] refresh mode: timestamp freshness skips disabled");

  const { index, stats: poiStats } = await loadPoiIndex(paths.poisFile, {
    selectedSignals,
    cellDegrees: args.cellDegrees,
  });
  console.log(`[rto-insights:geofabrik] indexed ${poiStats.indexed} POI feature(s), skipped ${poiStats.skipped} from ${poiStats.read} row(s)`);

  const sourceStat = await fs.stat(paths.poisFile);
  const stats = createImportStats();
  for (let indexNumber = 0; indexNumber < targets.length; indexNumber += 1) {
    const target = targets[indexNumber];
    const delta = await processTarget(target, {
      args,
      dryRun,
      index,
      radii,
      selectedSignals,
      freshnessCutoff,
      sourceUrl: args.geofabrikUrl,
      sourceUpdatedAt: sourceStat.mtime.toISOString(),
      sourceFile: paths.sourceFile,
      poisFile: paths.poisFile,
    });
    addImportStats(stats, delta);
    console.log(`[rto-insights:geofabrik] ${indexNumber + 1}/${targets.length} ${target.state} / ${target.rto} saved=${stats.written} computed=${stats.computed} freshSkipped=${stats.freshSkipped} skipped=${stats.skipped}`);
  }

  console.log(`[rto-insights:geofabrik] done. written=${stats.written} computed=${stats.computed} freshSkipped=${stats.freshSkipped} skipped=${stats.skipped} dryRun=${dryRun}`);
  return stats;
}

async function loadTargets(args) {
  const rtos = await listRtoDailyRtos({ state: args.state || null });
  return rtos
    .filter((item) => !args.rto || item.rto.toLowerCase().includes(args.rto.toLowerCase()))
    .slice(args.skip)
    .slice(0, args.limit);
}

async function processTarget(target, context) {
  const { args, dryRun, index, radii, selectedSignals, freshnessCutoff, sourceUrl, sourceUpdatedAt, sourceFile, poisFile } = context;
  const stats = createImportStats();
  const profile = await loadGeoProfile(target);
  if (!profile?.latitude || !profile?.longitude) {
    stats.skipped += 1;
    console.log(`[rto-insights:geofabrik] skip ${target.state} / ${target.rto}: no cached centroid`);
    return stats;
  }

  for (const radiusKm of radii) {
    for (const definition of selectedSignals) {
      if (freshnessCutoff) {
        const fresh = await findFreshSignal({
          state: target.state,
          rto: target.rto,
          signalKey: definition.key,
          radiusKm,
          fetchedSince: freshnessCutoff,
        });
        if (fresh) {
          stats.freshSkipped += 1;
          continue;
        }
      }

      const elements = index.within({
        latitude: profile.latitude,
        longitude: profile.longitude,
        radiusKm,
        definition,
      });
      const summary = summarizeOsmSignal(definition.key, elements);
      stats.computed += 1;

      if (dryRun) {
        console.log(`[rto-insights:geofabrik] would save ${definition.key}=${summary.numericValue} for ${target.state} / ${target.rto} @ ${radiusKm} km`);
        continue;
      }

      await upsertRtoExternalSignal({
        state: target.state,
        rto: target.rto,
        provider: RTO_INSIGHT_PROVIDER_OSM,
        radiusKm,
        sourceUrl,
        sourceUpdatedAt,
        fetchedAt: new Date().toISOString(),
        ...summary,
        evidence: {
          ...summary.evidence,
          source: "geofabrik_extract",
          sourceFile: path.basename(sourceFile),
          poisFile: path.basename(poisFile),
          attribution: "OpenStreetMap contributors via Geofabrik extract",
          radiusKm,
          centroid: {
            latitude: profile.latitude,
            longitude: profile.longitude,
          },
        },
      });
      stats.written += 1;
    }
  }
  return stats;
}

async function loadGeoProfile({ state, rto } = {}) {
  const result = await query(
    "select * from rto_geo_profiles where state = $1 and rto = $2 limit 1",
    [state, rto],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
  };
}

async function findFreshSignal({ state, rto, signalKey, radiusKm, fetchedSince }) {
  const result = await query(
    `
      select fetched_at
      from rto_external_signals
      where state = $1
        and rto = $2
        and provider = $3
        and signal_key = $4
        and radius_km = $5
        and period_start is null
        and period_end is null
        and fetched_at >= $6::timestamptz
      order by fetched_at desc
      limit 1
    `,
    [state, rto, RTO_INSIGHT_PROVIDER_OSM, signalKey, radiusKm, fetchedSince.toISOString()],
  );
  return result.rows[0] ?? null;
}

export async function prepareGeofabrikPois({ sourceFile, filteredFile, poisFile, expressionsFile, exportConfigFile, osmiumBin = "osmium", overwrite = false }) {
  if (!(await fileExists(sourceFile))) {
    throw new Error(`Missing Geofabrik PBF: ${sourceFile}. Run with --download or pass --source-file.`);
  }
  await assertOsmiumAvailable(osmiumBin);
  await fs.mkdir(path.dirname(filteredFile), { recursive: true });
  await fs.writeFile(expressionsFile, `${buildOsmiumFilterExpressions().join("\n")}\n`, "utf8");
  await fs.writeFile(exportConfigFile, `${JSON.stringify(buildOsmiumExportConfig(), null, 2)}\n`, "utf8");

  if (overwrite || !(await fileExists(filteredFile))) {
    console.log(`[rto-insights:geofabrik] filtering ${sourceFile} -> ${filteredFile}`);
    await runCommand(osmiumBin, [
      "tags-filter",
      "--expressions",
      expressionsFile,
      "-o",
      filteredFile,
      "-O",
      sourceFile,
    ]);
  } else {
    console.log(`[rto-insights:geofabrik] reusing existing filtered PBF ${filteredFile}`);
  }

  if (overwrite || !(await fileExists(poisFile))) {
    console.log(`[rto-insights:geofabrik] exporting ${filteredFile} -> ${poisFile}`);
    await runCommand(osmiumBin, [
      "export",
      "-o",
      poisFile,
      "-O",
      "-f",
      "geojsonseq",
      "-c",
      exportConfigFile,
      "--geometry-types=point,linestring,polygon",
      "-x",
      "print_record_separator=false",
      filteredFile,
    ]);
  } else {
    console.log(`[rto-insights:geofabrik] reusing existing POI export ${poisFile}`);
  }
}

export async function downloadGeofabrikExtract({ url = DEFAULT_GEOFABRIK_URL, outputPath, overwrite = false }) {
  if (!overwrite && await fileExists(outputPath)) {
    console.log(`[rto-insights:geofabrik] source already exists at ${outputPath}`);
    return outputPath;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.download`;
  console.log(`[rto-insights:geofabrik] downloading ${url} -> ${outputPath}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Geofabrik download failed ${response.status}: ${await response.text()}`);
  const totalBytes = Number(response.headers.get("content-length") ?? 0);
  let receivedBytes = 0;
  let lastLogAt = Date.now();
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      const now = Date.now();
      if (now - lastLogAt >= DOWNLOAD_PROGRESS_INTERVAL_MS) {
        lastLogAt = now;
        console.log(`[rto-insights:geofabrik] downloaded ${formatBytes(receivedBytes)}${totalBytes ? ` / ${formatBytes(totalBytes)}` : ""}`);
      }
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), progress, fsSync.createWriteStream(tempPath));
  await fs.rename(tempPath, outputPath);
  console.log(`[rto-insights:geofabrik] download complete ${formatBytes(receivedBytes)}`);
  return outputPath;
}

export async function loadPoiIndex(poisFile, { selectedSignals = OSM_SIGNAL_DEFINITIONS, cellDegrees = DEFAULT_CELL_DEGREES } = {}) {
  const signalDefinitions = selectedSignals.length ? selectedSignals : OSM_SIGNAL_DEFINITIONS;
  const index = createSpatialIndex({ cellDegrees });
  const stats = { read: 0, indexed: 0, skipped: 0 };
  const input = fsSync.createReadStream(poisFile, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const rawLine of lines) {
    const line = String(rawLine ?? "").replace(/^\u001e/, "").trim();
    if (!line) continue;
    stats.read += 1;
    let feature;
    try {
      feature = JSON.parse(line);
    } catch {
      stats.skipped += 1;
      continue;
    }
    const element = osmElementFromGeoJsonFeature(feature);
    if (!element || !matchesAnySignal(element.tags, signalDefinitions)) {
      stats.skipped += 1;
      continue;
    }
    index.add(element);
    stats.indexed += 1;
  }
  return { index, stats };
}

export function createSpatialIndex({ cellDegrees = DEFAULT_CELL_DEGREES } = {}) {
  const normalizedCellDegrees = Math.max(0.01, Number(cellDegrees) || DEFAULT_CELL_DEGREES);
  const cells = new Map();
  return {
    cellDegrees: normalizedCellDegrees,
    size: 0,
    add(element) {
      const latitude = Number(element.latitude);
      const longitude = Number(element.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
      const key = gridKey(latitude, longitude, normalizedCellDegrees);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(element);
      this.size += 1;
      return true;
    },
    within({ latitude, longitude, radiusKm, definition }) {
      const lat = Number(latitude);
      const lon = Number(longitude);
      const radius = Number(radiusKm);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius)) return [];
      const latIndex = Math.floor(lat / normalizedCellDegrees);
      const lonIndex = Math.floor(lon / normalizedCellDegrees);
      const latSpan = Math.ceil(radius / (111 * normalizedCellDegrees)) + 1;
      const lonKm = Math.max(20, Math.abs(111 * Math.cos(toRadians(lat))));
      const lonSpan = Math.ceil(radius / (lonKm * normalizedCellDegrees)) + 1;
      const found = [];
      for (let row = latIndex - latSpan; row <= latIndex + latSpan; row += 1) {
        for (let col = lonIndex - lonSpan; col <= lonIndex + lonSpan; col += 1) {
          const bucket = cells.get(`${row}:${col}`);
          if (!bucket) continue;
          for (const element of bucket) {
            if (definition && !matchesAnyTag(element.tags, definition.tags)) continue;
            if (haversineKm(lat, lon, element.latitude, element.longitude) <= radius) found.push(element);
          }
        }
      }
      return found;
    },
  };
}

function gridKey(latitude, longitude, cellDegrees) {
  return `${Math.floor(latitude / cellDegrees)}:${Math.floor(longitude / cellDegrees)}`;
}

export function osmElementFromGeoJsonFeature(feature) {
  if (!feature || feature.type !== "Feature") return null;
  const coordinate = representativeCoordinate(feature.geometry);
  if (!coordinate) return null;
  const properties = feature.properties && typeof feature.properties === "object" ? feature.properties : {};
  const tags = tagsFromProperties(properties);
  return {
    type: osmType(properties.osm_type ?? properties["@type"] ?? feature.id),
    id: properties.osm_id ?? properties["@id"] ?? feature.id ?? `${coordinate.longitude},${coordinate.latitude}`,
    tags,
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
  };
}

function tagsFromProperties(properties) {
  const tags = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === "osm_type" || key === "osm_id" || key.startsWith("@")) continue;
    if (value === null || value === undefined) continue;
    tags[key] = String(value);
  }
  return tags;
}

function osmType(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("relation") || text.startsWith("r")) return "relation";
  if (text.includes("way") || text.startsWith("w") || text.includes("area") || text.startsWith("a")) return "way";
  return "node";
}

export function representativeCoordinate(geometry) {
  if (!geometry || typeof geometry !== "object") return null;
  if (geometry.type === "Point") return lonLatToCoordinate(geometry.coordinates);
  if (geometry.type === "MultiPoint" || geometry.type === "LineString") return averageCoordinate(geometry.coordinates);
  if (geometry.type === "MultiLineString") return averageCoordinate(geometry.coordinates.flat());
  if (geometry.type === "Polygon") return polygonRepresentativeCoordinate(geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    const weighted = geometry.coordinates
      .map((polygon) => polygonRepresentativeCoordinate(polygon, true))
      .filter(Boolean);
    if (!weighted.length) return null;
    const totalArea = weighted.reduce((sum, item) => sum + item.area, 0);
    if (totalArea <= 0) return averageCoordinate(weighted.map((item) => [item.longitude, item.latitude]));
    return {
      longitude: weighted.reduce((sum, item) => sum + item.longitude * item.area, 0) / totalArea,
      latitude: weighted.reduce((sum, item) => sum + item.latitude * item.area, 0) / totalArea,
    };
  }
  return null;
}

function polygonRepresentativeCoordinate(rings, withArea = false) {
  const ring = Array.isArray(rings?.[0]) ? rings[0] : [];
  if (ring.length < 3) {
    const average = averageCoordinate(ring);
    return withArea && average ? { ...average, area: 0 } : average;
  }
  let area = 0;
  let centroidX = 0;
  let centroidY = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[index + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    centroidX += (x0 + x1) * cross;
    centroidY += (y0 + y1) * cross;
  }
  area /= 2;
  if (!Number.isFinite(area) || Math.abs(area) < 1e-12) {
    const average = averageCoordinate(ring);
    return withArea && average ? { ...average, area: 0 } : average;
  }
  const coordinate = {
    longitude: centroidX / (6 * area),
    latitude: centroidY / (6 * area),
  };
  return withArea ? { ...coordinate, area: Math.abs(area) } : coordinate;
}

function averageCoordinate(coordinates = []) {
  const valid = coordinates
    .map(lonLatToCoordinate)
    .filter(Boolean);
  if (!valid.length) return null;
  return {
    longitude: valid.reduce((sum, item) => sum + item.longitude, 0) / valid.length,
    latitude: valid.reduce((sum, item) => sum + item.latitude, 0) / valid.length,
  };
}

function lonLatToCoordinate(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

export function haversineKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  const earthRadiusKm = 6371.0088;
  const latA = toRadians(latitudeA);
  const latB = toRadians(latitudeB);
  const deltaLat = toRadians(latitudeB - latitudeA);
  const deltaLon = toRadians(longitudeB - longitudeA);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value) {
  return Number(value) * Math.PI / 180;
}

export function buildOsmiumFilterExpressions(definitions = OSM_SIGNAL_DEFINITIONS) {
  const expressions = new Set();
  for (const definition of definitions) {
    for (const tags of definition.tags) {
      for (const [key, value] of Object.entries(tags)) {
        expressions.add(`nwr/${key}=${value}`);
      }
    }
  }
  return Array.from(expressions).sort();
}

export function buildOsmiumExportConfig(definitions = OSM_SIGNAL_DEFINITIONS) {
  return {
    attributes: {
      type: "osm_type",
      id: "osm_id",
    },
    include_tags: uniqueStrings([
      ...definitions.flatMap((definition) => definition.tags.flatMap((tags) => Object.keys(tags))),
      ...EXTRA_EVIDENCE_TAGS,
    ]),
  };
}

function selectSignals(keys = []) {
  if (!keys.length) return OSM_SIGNAL_DEFINITIONS;
  const wanted = new Set(keys);
  const selected = OSM_SIGNAL_DEFINITIONS.filter((definition) => wanted.has(definition.key));
  if (selected.length !== wanted.size) {
    const known = OSM_SIGNAL_DEFINITIONS.map((definition) => definition.key).join(", ");
    throw new Error(`Unknown signal in --signals. Known signals: ${known}`);
  }
  return selected;
}

function matchesAnySignal(tags, definitions) {
  return definitions.some((definition) => matchesAnyTag(tags, definition.tags));
}

function matchesAnyTag(tags = {}, candidates = []) {
  return candidates.some((candidate) =>
    Object.entries(candidate).every(([key, value]) => String(tags[key] ?? "") === String(value)));
}

function resolvePaths(args) {
  const workDir = path.resolve(args.workDir);
  return {
    workDir,
    sourceFile: path.resolve(args.sourceFile || path.join(workDir, DEFAULT_SOURCE_FILE)),
    filteredFile: path.resolve(args.filteredFile || path.join(workDir, DEFAULT_FILTERED_FILE)),
    poisFile: path.resolve(args.poisFile || path.join(workDir, DEFAULT_POIS_FILE)),
    expressionsFile: path.resolve(path.join(workDir, DEFAULT_EXPRESSIONS_FILE)),
    exportConfigFile: path.resolve(path.join(workDir, DEFAULT_EXPORT_CONFIG_FILE)),
  };
}

export function freshnessCutoffFor(maxAgeHours) {
  const hours = Number(maxAgeHours);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export function freshnessCutoffForImport(args) {
  return args.refresh ? null : freshnessCutoffFor(args.maxAgeHours);
}

function createImportStats() {
  return { written: 0, computed: 0, skipped: 0, freshSkipped: 0 };
}

function addImportStats(target, delta) {
  target.written += delta.written;
  target.computed += delta.computed;
  target.skipped += delta.skipped;
  target.freshSkipped += delta.freshSkipped;
  return target;
}

async function assertOsmiumAvailable(osmiumBin) {
  try {
    await runCommand(osmiumBin, ["--version"], { quiet: true });
  } catch (error) {
    throw new Error(`Missing osmium-tool executable "${osmiumBin}". Install osmium-tool and make sure "osmium --version" works, or pass --pois-file with a pre-exported GeoJSONSeq file. Original error: ${error.message}`);
  }
}

function runCommand(command, args, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: quiet ? ["ignore", "ignore", "pipe"] : "inherit",
      windowsHide: true,
    });
    let stderr = "";
    if (quiet && child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function splitList(value = "") {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function splitNumbers(value = "") {
  return splitList(value).map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0);
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, number);
}

export function parseArgs(argv) {
  const args = {
    state: null,
    rto: null,
    skip: 0,
    limit: DEFAULT_LIMIT,
    radiusKm: [],
    signals: [],
    write: false,
    download: false,
    refresh: false,
    refreshSource: false,
    prepareOnly: false,
    skipPrepare: false,
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    workDir: DEFAULT_WORK_DIR,
    sourceFile: null,
    filteredFile: null,
    poisFile: null,
    geofabrikUrl: process.env.GEOFABRIK_OSM_URL || DEFAULT_GEOFABRIK_URL,
    osmiumBin: process.env.OSMIUM_BIN || "osmium",
    cellDegrees: DEFAULT_CELL_DEGREES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--write") args.write = true;
    else if (arg === "--download") args.download = true;
    else if (arg === "--refresh") args.refresh = true;
    else if (arg === "--refresh-source") args.refreshSource = true;
    else if (arg === "--prepare-only") args.prepareOnly = true;
    else if (arg === "--skip-prepare") args.skipPrepare = true;
    else if (arg === "--state") args.state = next();
    else if (arg === "--rto") args.rto = next();
    else if (arg === "--skip") args.skip = Math.max(0, Math.floor(Number(next()) || args.skip));
    else if (arg === "--limit") args.limit = Math.max(1, Math.floor(Number(next()) || args.limit));
    else if (arg === "--radius-km") args.radiusKm = splitNumbers(next());
    else if (arg === "--signals") args.signals = splitList(next());
    else if (arg === "--max-age-hours") args.maxAgeHours = nonNegativeNumber(next(), args.maxAgeHours);
    else if (arg.startsWith("--max-age-hours=")) args.maxAgeHours = nonNegativeNumber(arg.slice("--max-age-hours=".length), args.maxAgeHours);
    else if (arg === "--work-dir") args.workDir = next();
    else if (arg === "--source-file") args.sourceFile = next();
    else if (arg === "--filtered-file") args.filteredFile = next();
    else if (arg === "--pois-file") args.poisFile = next();
    else if (arg === "--geofabrik-url") args.geofabrikUrl = next();
    else if (arg === "--osmium-bin") args.osmiumBin = next();
    else if (arg === "--cell-degrees") args.cellDegrees = Math.max(0.01, Number(next()) || args.cellDegrees);
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.refreshSource) args.download = true;
  return args;
}

export function shouldPrepareGeofabrikPois({ skipPrepare = false, poisFile = null, prepareOnly = false, refreshSource = false, poiFileExists = false } = {}) {
  return !skipPrepare && !poisFile && (prepareOnly || refreshSource || !poiFileExists);
}

function printHelp() {
  console.log(`Usage:
  node --env-file=.env scripts/import-geofabrik-rto-signals.mjs [options]

Options:
  --write                 Save OSM signal rows. Without this, computes and prints dry-run rows.
  --download              Download the Geofabrik India PBF before preparing/importing.
  --refresh-source        Redownload and rebuild local Geofabrik intermediate files.
  --prepare-only          Download/filter/export the local POI GeoJSONSeq, then exit.
  --skip-prepare          Do not run osmium preparation; require an existing --pois-file/default export.
  --source-file path      Use an existing .osm.pbf file instead of the default work-dir source.
  --pois-file path        Use an existing GeoJSONSeq POI export and skip osmium preparation.
  --work-dir path         Local Geofabrik cache directory (default data/rto-insights/geofabrik).
  --state "Uttar Pradesh" Limit enabled RTO configs by state.
  --rto "Noida"           Limit enabled RTO configs by RTO label substring.
  --skip 10               Skip this many matched RTO configs before processing.
  --limit 2000            Max RTO configs to process (default 5).
  --radius-km 5,10,25     Radius buckets to compute.
  --signals key,key       OSM signal keys to compute.
  --max-age-hours 24      Skip signal rows fetched within this many hours (default 24; use 0 to disable).
  --refresh               Ignore --max-age-hours and recompute matching signals.
  --osmium-bin path       osmium executable name/path (default osmium or OSMIUM_BIN).
`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main()
    .catch((error) => {
      console.error(`[rto-insights:geofabrik] ${error.stack || error.message}`);
      process.exitCode = 1;
    })
    .finally(closePool);
}
