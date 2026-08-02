import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_INPUT = path.join(ROOT_DIR, "data", "rto-insights", "rto-centroid-worklist.csv");
const DEFAULT_GEONAMES = path.join(ROOT_DIR, "data", "geo", "IN", "IN.txt");
const DEFAULT_ADMIN1 = path.join(ROOT_DIR, "data", "geo", "admin1CodesASCII.txt");

const FEATURE_WEIGHTS = new Map([
  ["PPLA", 45],
  ["PPLA2", 43],
  ["PPLA3", 40],
  ["PPLA4", 38],
  ["PPL", 36],
  ["PPLX", 30],
  ["PPLC", 28],
  ["ADM2", 34],
  ["ADM3", 28],
  ["ADM1", 20],
  ["ADM4", 18],
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const rows = parseCsv(await fs.readFile(inputPath, "utf8"));
  const admin1 = await loadAdmin1(path.resolve(args.admin1));
  const gazetteer = await loadGeoNames(path.resolve(args.geonames), admin1);
  let filled = 0;
  let missing = 0;

  for (const row of rows) {
    if (hasCoordinates(row)) continue;
    const variants = candidateNames(row);
    const match = bestMatch({ state: row.state, variants, gazetteer });
    if (!match) {
      missing += 1;
      continue;
    }

    row.latitude = formatCoordinate(match.lat);
    row.longitude = formatCoordinate(match.lon);
    row.confidence_score = formatConfidence(match.confidence);
    row.source = "geonames";
    row.reviewed = "false";
    row.notes = `geonames=${match.id}; matched="${match.name}"; query="${match.variant}"; feature=${match.featureCode}`;
    filled += 1;
  }

  await fs.writeFile(inputPath, toCsv(rows), "utf8");
  const located = rows.filter(hasCoordinates).length;
  console.log(`[rto-centroids:geonames] filled=${filled} located=${located} missing=${rows.length - located} unmatched_this_run=${missing}`);
}

async function loadAdmin1(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  const byCode = new Map();
  const byState = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("IN.")) continue;
    const [code, name, ascii] = line.split("\t");
    const adminCode = code.split(".")[1];
    const normalized = normalizeState(ascii || name);
    byCode.set(adminCode, ascii || name);
    byState.set(normalized, adminCode);
  }
  byState.set(normalizeState("Andaman & Nicobar Island"), "01");
  byState.set(normalizeState("UT of DNH and DD"), "52");
  return { byCode, byState };
}

async function loadGeoNames(filePath, admin1) {
  const text = await fs.readFile(filePath, "utf8");
  const byName = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const columns = line.split("\t");
    const featureClass = columns[6];
    const featureCode = columns[7];
    if (!["A", "P", "S"].includes(featureClass) && !FEATURE_WEIGHTS.has(featureCode)) continue;

    const record = {
      id: columns[0],
      name: columns[2] || columns[1],
      lat: Number(columns[4]),
      lon: Number(columns[5]),
      featureClass,
      featureCode,
      admin1: columns[10],
      state: admin1.byCode.get(columns[10]) ?? "",
      population: Number(columns[14]) || 0,
    };
    if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) continue;

    const names = new Set([columns[1], columns[2]]);
    for (const alt of String(columns[3] ?? "").split(",")) names.add(alt);
    for (const name of names) {
      const key = normalizeName(name);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(record);
    }
  }
  return byName;
}

function bestMatch({ state, variants, gazetteer }) {
  const stateKey = normalizeState(state);
  let best = null;
  for (const variant of variants) {
    const key = normalizeName(variant);
    const records = gazetteer.get(key) ?? [];
    for (const record of records) {
      const sameState = normalizeState(record.state) === stateKey;
      const score =
        (sameState ? 100 : 0) +
        (FEATURE_WEIGHTS.get(record.featureCode) ?? (record.featureClass === "P" ? 20 : record.featureClass === "A" ? 15 : 4)) +
        Math.min(20, Math.log10(Math.max(1, record.population)) * 4);
      const confidence = sameState ? (variant === variants[0] ? 0.68 : 0.62) : 0.48;
      if (!best || score > best.score) best = { ...record, score, confidence, variant };
    }
  }
  return best;
}

function candidateNames(row) {
  const raw = cleanPlaceLabel(row.place_label || row.rto);
  const compact = raw.replace(/\b(NIAIMT|RLA|STA|PVD)\b/gi, " ").replace(/\s+/g, " ").trim();
  const words = compact.split(/\s+/).filter(Boolean);
  const variants = [
    compact,
    raw,
    words.length > 1 ? words.slice(-1).join(" ") : null,
    words.length > 1 ? words.slice(0, -1).join(" ") : null,
    row.state,
  ];
  return uniqueStrings(variants).filter((value) => normalizeName(value).length >= 3);
}

function cleanPlaceLabel(value = "") {
  return String(value ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b[A-Z]{2}\s*[- ]?\s*\d{1,3}\b/gi, " ")
    .replace(/\b(RTO|ARTO|DTO|MVI|RTA|UO|UNIT|REGIONAL|TRANSPORT|OFFICE|AUTHORITY|STATE|STA)\b/gi, " ")
    .replace(/\b(CLUSTER|BUS|FITNESS|CENTER|TRACK|HEAD|CHD|RLA|AND)\b/gi, " ")
    .replace(/\s*[-,/]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
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
  const headers = ["state", "rto", "rto_code", "place_label", "latitude", "longitude", "confidence_score", "source", "reviewed", "notes"];
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function hasCoordinates(row) {
  return numericOrNull(row.latitude) !== null && numericOrNull(row.longitude) !== null;
}

function numericOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeState(value) {
  return normalizeName(value).replace(/^andaman and nicobar island$/, "andaman and nicobar");
}

function formatCoordinate(value) {
  return Number(value).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function formatConfidence(value) {
  return Number(value).toFixed(4);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    geonames: DEFAULT_GEONAMES,
    admin1: DEFAULT_ADMIN1,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--input") args.input = next();
    else if (arg === "--geonames") args.geonames = next();
    else if (arg === "--admin1") args.admin1 = next();
    else if (arg === "--help") {
      console.log("Usage: node scripts/fill-rto-centroid-worklist-geonames.mjs [--input path.csv]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

main().catch((error) => {
  console.error(`[rto-centroids:geonames] ${error.stack || error.message}`);
  process.exitCode = 1;
});
