import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { geocodeQueriesForRto } from "../lib/rto-insights.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_INPUT = path.join(ROOT_DIR, "data", "rto-insights", "rto-centroid-worklist.csv");
const DEFAULT_CACHE = path.join(ROOT_DIR, "data", "rto-insights", "rto-geocode-cache.json");
const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const cachePath = path.resolve(args.cache);
  const rows = parseCsv(await fs.readFile(inputPath, "utf8"));
  const cache = await readJson(cachePath, {});
  let alreadyLocated = 0;
  let filled = 0;
  let failed = 0;

  for (const row of rows) {
    if (hasCoordinates(row)) {
      alreadyLocated += 1;
      continue;
    }

    const key = cacheKey(row);
    let match = cache[key];
    if (match === undefined) {
      match = await geocodeRow(row, args);
      if (!args.dryRun) {
        cache[key] = match ?? null;
        await writeJson(cachePath, cache);
      }
    }

    if (match?.lat && match?.lon) {
      row.latitude = formatCoordinate(match.lat);
      row.longitude = formatCoordinate(match.lon);
      row.confidence_score = formatConfidence(confidenceForMatch(match));
      row.source = "nominatim";
      row.reviewed = "false";
      row.notes = noteForMatch(match);
      filled += 1;
      if (!args.dryRun && filled % args.flushEvery === 0) await writeTextWithRetry(inputPath, toCsv(rows));
      console.log(`[rto-centroids] filled ${filled}: ${row.state} / ${row.rto_code || row.rto} -> ${row.latitude},${row.longitude}`);
    } else {
      failed += 1;
      console.log(`[rto-centroids] no match: ${row.state} / ${row.rto_code || row.rto}`);
    }
  }

  if (!args.dryRun) await writeTextWithRetry(inputPath, toCsv(rows));
  if (!args.dryRun) await writeJson(cachePath, cache);

  const located = rows.filter(hasCoordinates).length;
  console.log(`[rto-centroids] done rows=${rows.length} located=${located} missing=${rows.length - located} newly_filled=${filled} already_located=${alreadyLocated} failed=${failed}`);
  console.log(`[rto-centroids] worksheet=${inputPath}`);
  console.log(`[rto-centroids] cache=${cachePath}`);
}

async function geocodeRow(row, args) {
  const cleanPlace = cleanPlaceLabel(row.place_label);
  const queries = [
    cleanPlace ? `${cleanPlace} ${row.state} India` : null,
    cleanPlace ? `${cleanPlace} RTO ${row.state} India` : null,
    ...geocodeQueriesForRto({ state: row.state, rto: cleanPlace || row.rto }),
    ...geocodeQueriesForRto({ state: row.state, rto: row.rto }),
  ];

  for (const query of uniqueStrings(queries)) {
    const match = await geocode(query, args);
    await sleep(args.sleepMs);
    if (!match) continue;
    return { ...match, query };
  }
  return null;
}

async function geocode(query, args) {
  if (args.dryRun) {
    console.log(`[rto-centroids] would geocode: ${query}`);
    return null;
  }

  const url = new URL(args.nominatimUrl);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", query);
  url.searchParams.set("countrycodes", "in");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url, { headers: { "User-Agent": args.userAgent } });
  if (!response.ok) throw new Error(`Nominatim failed ${response.status}: ${await response.text()}`);
  const rows = await response.json();
  return rows[0] ?? null;
}

function confidenceForMatch(match) {
  const importance = Number(match.importance);
  if (match.type === "government" || /rto|transport/i.test(match.display_name ?? "")) return 0.76;
  if (Number.isFinite(importance) && importance >= 0.45) return 0.72;
  if (Number.isFinite(importance) && importance >= 0.25) return 0.66;
  return 0.6;
}

function noteForMatch(match) {
  const osm = match.osm_type && match.osm_id ? `osm=${match.osm_type}/${match.osm_id}` : "osm=unknown";
  return `geocoded query="${String(match.query ?? "").replace(/"/g, "'")}"; ${osm}`;
}

function hasCoordinates(row) {
  return numericOrNull(row.latitude) !== null && numericOrNull(row.longitude) !== null;
}

function cleanPlaceLabel(value = "") {
  return String(value ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(RTO|ARTO|DTO|MVI|RTA|UO|UNIT|REGIONAL|TRANSPORT|OFFICE|AUTHORITY|STATE|STA)\b/gi, " ")
    .replace(/\b(CLUSTER|BUS|FITNESS|CENTER|TRACK|HEAD|CHD|RLA|AND)\b/gi, " ")
    .replace(/\s*[-,/]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cacheKey(row) {
  return `${row.state}\u0000${row.rto}\u0000${row.place_label ?? ""}`;
}

function parseCsv(text) {
  const records = [];
  let field = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    records.push(row);
  }

  const headers = records.shift()?.map((header) => header.trim()) ?? [];
  return records
    .filter((record) => record.some((value) => String(value ?? "").trim()))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

function toCsv(rows) {
  const headers = [
    "state",
    "rto",
    "rto_code",
    "place_label",
    "latitude",
    "longitude",
    "confidence_score",
    "source",
    "reviewed",
    "notes",
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n") + "\n";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeTextWithRetry(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextWithRetry(filePath, text) {
  let attempt = 0;
  while (true) {
    try {
      await fs.writeFile(filePath, text, "utf8");
      return;
    } catch (error) {
      attempt += 1;
      if (attempt >= 60) throw error;
      await sleep(1000);
    }
  }
}

function formatCoordinate(value) {
  return Number(value).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function formatConfidence(value) {
  return Number(value).toFixed(4);
}

function numericOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    cache: DEFAULT_CACHE,
    dryRun: false,
    flushEvery: 25,
    nominatimUrl: DEFAULT_NOMINATIM_URL,
    sleepMs: 1100,
    userAgent: process.env.OSM_USER_AGENT || "VahanEY-RtoCentroidWorksheet/0.1 (local data enrichment)",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--input") args.input = next();
    else if (arg === "--cache") args.cache = next();
    else if (arg === "--nominatim-url") args.nominatimUrl = next();
    else if (arg === "--sleep-ms") args.sleepMs = Number(next());
    else if (arg === "--flush-every") args.flushEvery = Number(next());
    else if (arg === "--user-agent") args.userAgent = next();
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/fill-rto-centroid-worklist.mjs [options]

Options:
  --input path.csv             Worksheet to fill.
  --cache path.json            Geocode cache path.
  --sleep-ms 1100              Delay between Nominatim calls.
  --flush-every 25             Write worksheet after this many filled rows.
  --dry-run                    Print lookup attempts without writing.
`);
}

main().catch((error) => {
  console.error(`[rto-centroids] ${error.stack || error.message}`);
  process.exitCode = 1;
});
