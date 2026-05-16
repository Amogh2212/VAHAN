import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.join(__dirname, "data", "vahan", "vahan_fuel_monthly.csv");
const PUBLIC_DIR = path.join(__dirname, "public");
const SOURCE_LABEL = "VAHAN public dashboard aggregate data";
const execFileAsync = promisify(execFile);
const ALL_RTO = "All Vahan4 Running Office";

const MONTHS = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

// ── Comprehensive city → state + RTO mapping ──────────────────────────
// Each entry: { alias, state, rtoIncludes } — alias is matched against the query text,
// state is the VAHAN state name, rtoIncludes is the search needle for the RTO dropdown.
const CITY_DB = [
  // Uttar Pradesh
  { alias: "noida", state: "Uttar Pradesh", rtoIncludes: "noida" },
  { alias: "greater noida", state: "Uttar Pradesh", rtoIncludes: "noida" },
  { alias: "gautam buddha nagar", state: "Uttar Pradesh", rtoIncludes: "noida" },
  { alias: "lucknow", state: "Uttar Pradesh", rtoIncludes: "lucknow" },
  { alias: "ghaziabad", state: "Uttar Pradesh", rtoIncludes: "ghaziabad" },
  { alias: "agra", state: "Uttar Pradesh", rtoIncludes: "agra" },
  { alias: "kanpur", state: "Uttar Pradesh", rtoIncludes: "kanpur" },
  { alias: "varanasi", state: "Uttar Pradesh", rtoIncludes: "varanasi" },
  { alias: "prayagraj", state: "Uttar Pradesh", rtoIncludes: "allahabad" },
  { alias: "allahabad", state: "Uttar Pradesh", rtoIncludes: "allahabad" },
  { alias: "meerut", state: "Uttar Pradesh", rtoIncludes: "meerut" },
  { alias: "mathura", state: "Uttar Pradesh", rtoIncludes: "mathura" },
  { alias: "bareilly", state: "Uttar Pradesh", rtoIncludes: "bareilly" },
  { alias: "gorakhpur", state: "Uttar Pradesh", rtoIncludes: "gorakhpur" },
  // Uttarakhand
  { alias: "haridwar", state: "Uttarakhand", rtoIncludes: "haridwar" },
  { alias: "dehradun", state: "Uttarakhand", rtoIncludes: "dehradun" },
  { alias: "rishikesh", state: "Uttarakhand", rtoIncludes: "haridwar" },
  { alias: "nainital", state: "Uttarakhand", rtoIncludes: "nainital" },
  { alias: "haldwani", state: "Uttarakhand", rtoIncludes: "haldwani" },
  { alias: "roorkee", state: "Uttarakhand", rtoIncludes: "haridwar" },
  // Maharashtra
  { alias: "mumbai", state: "Maharashtra", rtoIncludes: "mumbai" },
  { alias: "pune", state: "Maharashtra", rtoIncludes: "pune" },
  { alias: "nagpur", state: "Maharashtra", rtoIncludes: "nagpur" },
  { alias: "nashik", state: "Maharashtra", rtoIncludes: "nashik" },
  { alias: "thane", state: "Maharashtra", rtoIncludes: "thane" },
  { alias: "aurangabad", state: "Maharashtra", rtoIncludes: "aurangabad" },
  // Delhi
  { alias: "new delhi", state: "Delhi", rtoIncludes: "delhi" },
  { alias: "delhi", state: "Delhi", rtoIncludes: "delhi" },
  // Karnataka
  { alias: "bangalore", state: "Karnataka", rtoIncludes: "bengaluru" },
  { alias: "bengaluru", state: "Karnataka", rtoIncludes: "bengaluru" },
  { alias: "mysore", state: "Karnataka", rtoIncludes: "mysore" },
  { alias: "mysuru", state: "Karnataka", rtoIncludes: "mysore" },
  { alias: "mangalore", state: "Karnataka", rtoIncludes: "mangalore" },
  { alias: "hubli", state: "Karnataka", rtoIncludes: "hubli" },
  // Tamil Nadu
  { alias: "chennai", state: "Tamil Nadu", rtoIncludes: "chennai" },
  { alias: "coimbatore", state: "Tamil Nadu", rtoIncludes: "coimbatore" },
  { alias: "madurai", state: "Tamil Nadu", rtoIncludes: "madurai" },
  { alias: "salem", state: "Tamil Nadu", rtoIncludes: "salem" },
  // Telangana
  { alias: "hyderabad", state: "Telangana", rtoIncludes: "hyderabad" },
  { alias: "secunderabad", state: "Telangana", rtoIncludes: "hyderabad" },
  { alias: "warangal", state: "Telangana", rtoIncludes: "warangal" },
  // Gujarat
  { alias: "ahmedabad", state: "Gujarat", rtoIncludes: "ahmedabad" },
  { alias: "surat", state: "Gujarat", rtoIncludes: "surat" },
  { alias: "vadodara", state: "Gujarat", rtoIncludes: "vadodara" },
  { alias: "rajkot", state: "Gujarat", rtoIncludes: "rajkot" },
  { alias: "gandhinagar", state: "Gujarat", rtoIncludes: "gandhinagar" },
  // Rajasthan
  { alias: "jaipur", state: "Rajasthan", rtoIncludes: "jaipur" },
  { alias: "jodhpur", state: "Rajasthan", rtoIncludes: "jodhpur" },
  { alias: "udaipur", state: "Rajasthan", rtoIncludes: "udaipur" },
  { alias: "kota", state: "Rajasthan", rtoIncludes: "kota" },
  // Haryana
  { alias: "gurugram", state: "Haryana", rtoIncludes: "gurugram" },
  { alias: "gurgaon", state: "Haryana", rtoIncludes: "gurugram" },
  { alias: "faridabad", state: "Haryana", rtoIncludes: "faridabad" },
  { alias: "karnal", state: "Haryana", rtoIncludes: "karnal" },
  { alias: "panipat", state: "Haryana", rtoIncludes: "panipat" },
  // Punjab
  { alias: "chandigarh", state: "Chandigarh", rtoIncludes: "chandigarh" },
  { alias: "ludhiana", state: "Punjab", rtoIncludes: "ludhiana" },
  { alias: "amritsar", state: "Punjab", rtoIncludes: "amritsar" },
  { alias: "jalandhar", state: "Punjab", rtoIncludes: "jalandhar" },
  // West Bengal
  { alias: "kolkata", state: "West Bengal", rtoIncludes: "kolkata" },
  { alias: "howrah", state: "West Bengal", rtoIncludes: "howrah" },
  // Bihar
  { alias: "patna", state: "Bihar", rtoIncludes: "patna" },
  // Kerala
  { alias: "kochi", state: "Kerala", rtoIncludes: "kochi" },
  { alias: "thiruvananthapuram", state: "Kerala", rtoIncludes: "thiruvananthapuram" },
  { alias: "kozhikode", state: "Kerala", rtoIncludes: "kozhikode" },
  // Madhya Pradesh
  { alias: "bhopal", state: "Madhya Pradesh", rtoIncludes: "bhopal" },
  { alias: "indore", state: "Madhya Pradesh", rtoIncludes: "indore" },
  // Odisha
  { alias: "bhubaneswar", state: "Odisha", rtoIncludes: "bhubaneswar" },
  // Assam
  { alias: "guwahati", state: "Assam", rtoIncludes: "guwahati" },
  // Jharkhand
  { alias: "ranchi", state: "Jharkhand", rtoIncludes: "ranchi" },
  { alias: "jamshedpur", state: "Jharkhand", rtoIncludes: "jamshedpur" },
  // Chhattisgarh
  { alias: "raipur", state: "Chhattisgarh", rtoIncludes: "raipur" },
  // Goa
  { alias: "goa", state: "Goa", rtoIncludes: "goa" },
  // Andhra Pradesh
  { alias: "visakhapatnam", state: "Andhra Pradesh", rtoIncludes: "visakhapatnam" },
  { alias: "vizag", state: "Andhra Pradesh", rtoIncludes: "visakhapatnam" },
  { alias: "vijayawada", state: "Andhra Pradesh", rtoIncludes: "vijayawada" },
  { alias: "tirupati", state: "Andhra Pradesh", rtoIncludes: "tirupati" },
  // All RTOs sentinel
  { alias: "all rtos", state: "", rto: ALL_RTO },
  { alias: "all rto", state: "", rto: ALL_RTO },
];

// Build STATE_ALIASES dynamically from CITY_DB + explicit state name aliases
const STATE_ALIASES = new Map([
  ["maharashtra", "Maharashtra"], ["delhi", "Delhi"], ["karnataka", "Karnataka"],
  ["tamil nadu", "Tamil Nadu"], ["telangana", "Telangana"], ["gujarat", "Gujarat"],
  ["rajasthan", "Rajasthan"], ["haryana", "Haryana"], ["punjab", "Punjab"],
  ["west bengal", "West Bengal"], ["bihar", "Bihar"], ["kerala", "Kerala"],
  ["madhya pradesh", "Madhya Pradesh"], ["odisha", "Odisha"], ["assam", "Assam"],
  ["jharkhand", "Jharkhand"], ["chhattisgarh", "Chhattisgarh"], ["goa", "Goa"],
  ["andhra pradesh", "Andhra Pradesh"], ["uttar pradesh", "Uttar Pradesh"],
  ["up", "Uttar Pradesh"], ["uttarakhand", "Uttarakhand"], ["hp", "Himachal Pradesh"],
  ["himachal pradesh", "Himachal Pradesh"], ["jammu", "Jammu & Kashmir"],
  ["sikkim", "Sikkim"], ["meghalaya", "Meghalaya"], ["tripura", "Tripura"],
  ["nagaland", "Nagaland"], ["manipur", "Manipur"], ["mizoram", "Mizoram"],
  ["arunachal pradesh", "Arunachal Pradesh"], ["chandigarh", "Chandigarh"],
  ["puducherry", "Puducherry"], ["pondicherry", "Puducherry"],
  ...CITY_DB.filter(c => c.state).map(c => [c.alias, c.state]),
]);

// Keep backward compat: RTO_ALIASES is now just CITY_DB
const RTO_ALIASES = CITY_DB;

let dataCache = null;

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

async function loadRows() {
  if (dataCache) return dataCache;
  const content = await fs.readFile(DATA_FILE, "utf8").catch(() => "");
  const [headerLine, ...lines] = content.trim().split(/\r?\n/).filter(Boolean);
  if (!headerLine) {
    dataCache = [];
    return dataCache;
  }
  const headers = parseCsvLine(headerLine);
  dataCache = lines.map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    return {
      ...row,
      year: Number(row.year),
      month: Number(row.month),
      vehicle_count: Number(row.vehicle_count || 0),
    };
  });
  return dataCache;
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseMonthYear(text) {
  const matches = [...text.matchAll(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/gi)];
  return matches.map((match) => ({
    year: Number(match[2]),
    month: MONTHS.get(match[1].toLowerCase()),
  }));
}

function parseYearOnly(text) {
  const match = text.match(/\b(20\d{2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return { from: monthKey(year, 1), to: monthKey(year, 12) };
}

function parseYearRange(text) {
  const match = text.match(/\b(20\d{2})\s*(?:-|to|and)\s*(20\d{2})\b/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end < start) return null;
  return { from: monthKey(start, 1), to: monthKey(end, 12) };
}

function parseDateRange(text) {
  const dates = parseMonthYear(text);
  if (dates.length >= 2) {
    return {
      from: monthKey(dates[0].year, dates[0].month),
      to: monthKey(dates[1].year, dates[1].month),
    };
  }
  if (dates.length === 1) {
    return {
      from: monthKey(dates[0].year, dates[0].month),
      to: monthKey(dates[0].year, dates[0].month),
    };
  }
  return parseYearRange(text) ?? parseYearOnly(text);
}

function editDistanceWithin(a, b, maxDistance) {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    let rowBest = previous[0];
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost);
      diagonal = above;
      rowBest = Math.min(rowBest, previous[j]);
    }
    if (rowBest > maxDistance) return maxDistance + 1;
  }
  return previous[b.length];
}

function findFuzzyCityAlias(text) {
  const words = text.match(/[a-z]+/g) ?? [];
  const singleWordAliases = RTO_ALIASES.filter((item) => /^[a-z]+$/.test(item.alias) && item.alias.length >= 5);

  for (const word of words) {
    if (word.length < 5) continue;
    const match = singleWordAliases
      .map((item) => ({ item, distance: editDistanceWithin(word, item.alias, 2) }))
      .filter(({ distance }) => distance <= 2)
      .sort((a, b) => a.distance - b.distance || b.item.alias.length - a.item.alias.length)[0];
    if (match) return match.item;
  }

  return null;
}

function decodeWithRules(query) {
  const text = compact(query).toLowerCase();
  const yearRange = parseDateRange(text);

  let fuelSegment = null;
  let fuelType = null;
  if (/\b(non[-\s]?ev|petrol|diesel|cng|lpg)\b/i.test(text)) fuelSegment = "NON_EV";
  if (/\b(ev|electric|battery|bov)\b/i.test(text)) fuelSegment = "EV";
  if (/\bpetrol\b/i.test(text)) fuelType = "PETROL";
  if (/\bdiesel\b/i.test(text)) fuelType = "DIESEL";
  if (/\bcng\b/i.test(text)) fuelType = "CNG";

  let state = null;
  for (const [alias, stateName] of STATE_ALIASES) {
    if (text.includes(alias)) state = stateName;
  }

  let rto = null;
  let locationText = null;
  for (const alias of RTO_ALIASES) {
    if (!text.includes(alias.alias)) continue;
    locationText = alias.alias;
    if (alias.state) state = alias.state;
    rto = alias.rto ?? alias.rtoIncludes;
  }

  if (!locationText) {
    const fuzzyAlias = findFuzzyCityAlias(text);
    if (fuzzyAlias) {
      locationText = fuzzyAlias.alias;
      if (fuzzyAlias.state) state = fuzzyAlias.state;
      rto = fuzzyAlias.rto ?? fuzzyAlias.rtoIncludes;
    }
  }

  return {
    fuelSegment,
    fuelType,
    state,
    rto,
    locationText,
    from: yearRange?.from ?? null,
    to: yearRange?.to ?? null,
    metric: "registrations",
  };
}

async function decodeWithGemini(query) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = [
    "Normalize and extract filters from this Indian VAHAN vehicle registration query.",
    "Correct obvious spelling mistakes in Indian city/state/RTO names before extracting filters.",
    "Examples: bengluru means Bengaluru/Bangalore, gurgao means Gurugram/Gurgaon, mumabi means Mumbai.",
    "Return only compact JSON with keys: fuelSegment, fuelType, state, rtoText, locationText, locationType, from, to, metric, confidence.",
    "Use official VAHAN-style state names when possible. For city/RTO queries, set state and rtoText to the likely RTO search text.",
    "Use YYYY-MM for dates. Use metric='registrations'. Never invent counts.",
    "If the user names an Indian city/RTO, infer the Indian state only when you are confident. If unsure, use null values and confidence below 0.6.",
    `Query: ${query}`,
  ].join("\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );
  if (!response.ok) throw new Error(`Gemini decode failed: ${response.status}`);
  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

function normalizeGeminiFilters(filters) {
  if (!filters) return null;
  const confidence = Number(filters.confidence ?? 1);
  if (Number.isFinite(confidence) && confidence < 0.6) {
    return { decodeWarning: "Gemini could not confidently resolve the location or filters." };
  }
  return {
    ...filters,
    rto: filters.rto ?? filters.rtoText ?? null,
    locationText: filters.locationText ?? filters.rtoText ?? null,
  };
}

function mergeFilters(ruleFilters, llmFilters) {
  if (!llmFilters) return ruleFilters;
  const ruleHasLocation = Boolean(ruleFilters.state || ruleFilters.rto || ruleFilters.locationText);
  const llmHasLocation = Boolean(llmFilters.state || llmFilters.rto || llmFilters.rtoText || llmFilters.locationText);
  return {
    fuelSegment: ruleFilters.fuelSegment ?? llmFilters.fuelSegment ?? null,
    fuelType: ruleFilters.fuelType ?? llmFilters.fuelType ?? null,
    state: ruleHasLocation ? ruleFilters.state ?? llmFilters.state ?? null : llmFilters.state ?? null,
    rto: ruleHasLocation ? ruleFilters.rto ?? llmFilters.rto ?? llmFilters.rtoText ?? null : llmFilters.rto ?? llmFilters.rtoText ?? null,
    locationText: ruleHasLocation ? ruleFilters.locationText ?? llmFilters.locationText ?? null : llmFilters.locationText ?? llmFilters.rtoText ?? null,
    from: ruleFilters.from ?? llmFilters.from ?? null,
    to: ruleFilters.to ?? llmFilters.to ?? null,
    correctedByGemini: !ruleHasLocation && llmHasLocation ? true : undefined,
    metric: "registrations",
  };
}

function resolveRto(filters, rows) {
  const rtoNeedle = filters.rto ?? filters.rtoSearch;

  // No RTO specified at all — check if we have a locationText from CITY_DB
  if (!rtoNeedle) {
    if (filters.locationText) {
      // We know the city name but it wasn't mapped to an rtoIncludes — treat as unresolved
      return { ...filters, rto: null, unresolvedLocation: filters.locationText };
    }
    return { ...filters, rto: null };
  }

  if (rtoNeedle === ALL_RTO) return { ...filters, rto: rtoNeedle };

  // Try to find a matching RTO in loaded CSV data
  const candidates = [...new Set(rows
    .filter((row) => !filters.state || row.state === filters.state)
    .map((row) => row.rto))]
    .filter((rto) => rto.toLowerCase().includes(String(rtoNeedle).toLowerCase()));

  if (candidates.length === 1) return { ...filters, rto: candidates[0] };
  if (candidates.length > 1) return { ...filters, rto: null, ambiguousRtos: candidates };

  // RTO not found in CSV — but we DO know the search text for the scraper.
  // Instead of giving up, pass the rtoSearch through so auto-scrape can use it.
  return { ...filters, rto: null, rtoSearch: rtoNeedle, unresolvedLocation: filters.locationText ?? rtoNeedle };
}

function monthsByYear(from, to) {
  if (!from || !to) return [];
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const groups = new Map();
  for (let year = fromYear; year <= toYear; year += 1) {
    const startMonth = year === fromYear ? fromMonth : 1;
    const endMonth = year === toYear ? toMonth : 12;
    const months = [];
    for (let month = startMonth; month <= endMonth; month += 1) months.push(month);
    groups.set(year, months);
  }
  return [...groups.entries()].map(([year, months]) => ({ year, months }));
}

// Find which specific year+month combos are missing from the CSV for this location
function findMissingMonths(filters, rows) {
  if (!filters.from || !filters.to) return [];
  const groups = monthsByYear(filters.from, filters.to);

  // Determine which RTO and state to check against
  const stateFilter = filters.state;
  const rtoFilter = filters.rto; // resolved formal RTO name (or null)
  const rtoSearch = filters.rtoSearch ?? filters.rto; // search needle

  // Get all year-month keys present in CSV for this location
  const loadedKeys = new Set();
  for (const row of rows) {
    if (stateFilter && row.state !== stateFilter) continue;
    if (rtoFilter && row.rto !== rtoFilter) continue;
    if (!rtoFilter && rtoSearch) {
      // RTO not formally resolved yet — fuzzy match
      if (!row.rto.toLowerCase().includes(String(rtoSearch).toLowerCase())) continue;
    } else if (!rtoFilter && !rtoSearch) {
      if (row.rto !== ALL_RTO) continue;
    }
    loadedKeys.add(`${row.year}-${row.month}`);
  }

  // Find year-month pairs NOT in CSV
  const missing = [];
  for (const group of groups) {
    const missingMonths = group.months.filter((m) => !loadedKeys.has(`${group.year}-${m}`));
    if (missingMonths.length > 0) {
      missing.push({ year: group.year, months: missingMonths });
    }
  }
  return missing;
}

function hasRequiredScrapeFilters(filters) {
  return Boolean(
    filters.state &&
    filters.from &&
    filters.to,
  );
}

function shouldAutoScrape(filters, resultRows, missingMonths) {
  if (!hasRequiredScrapeFilters(filters)) return false;
  if (filters.ambiguousRtos) return false;
  // Scrape if RTO is completely unknown in CSV
  if (filters.unresolvedLocation) return true;
  // Scrape if specific requested months are missing from CSV
  if (missingMonths.length > 0) return true;
  // Scrape if query returned zero rows (all data might be missing)
  return resultRows.length === 0;
}

async function runScraperForFilters(filters, missingMonths) {
  const rto = filters.rtoSearch ?? filters.rto ?? filters.locationText;
  // If we have specific missing months, only scrape those; otherwise scrape the full range
  const groups = missingMonths.length > 0 ? missingMonths : monthsByYear(filters.from, filters.to);
  if (!groups.length) return [];

  const runs = [];
  for (const group of groups) {
    const args = [
      "scripts/vahan-scraper.mjs",
      "--mode", "scrape",
      "--states", filters.state,
      "--years", String(group.year),
      "--months", group.months.join(","),
    ];
    if (rto) args.push("--rtos", rto);
    console.log(`[auto-scrape] ${filters.state} / ${rto} / ${group.year} months=${group.months.join(",")}`);
    try {
      const result = await execFileAsync(process.execPath, args, {
        cwd: __dirname,
        timeout: 300_000,
        maxBuffer: 1024 * 1024 * 10,
      });
      runs.push({
        year: group.year,
        months: group.months,
        success: true,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (error) {
      console.error(`[auto-scrape] Failed for ${group.year}/${group.months}: ${error.message}`);
      runs.push({
        year: group.year,
        months: group.months,
        success: false,
        error: error.message,
        stderr: error.stderr,
      });
    }
  }

  dataCache = null;
  return runs;
}

function filterRows(rows, filters) {
  return rows.filter((row) => {
    const key = monthKey(row.year, row.month);
    if (filters.from && key < filters.from) return false;
    if (filters.to && key > filters.to) return false;
    if (filters.state && row.state !== filters.state) return false;
    if (filters.rto && row.rto !== filters.rto) return false;
    if (filters.state && !filters.rto && !filters.rtoSearch && row.rto !== ALL_RTO) return false;
    if (filters.fuelSegment && row.fuel_segment !== filters.fuelSegment) return false;
    if (filters.fuelType && !row.fuel_type.toLowerCase().includes(filters.fuelType.toLowerCase())) return false;
    return true;
  });
}

function filterRowsIgnoringDate(rows, filters) {
  return filterRows(rows, { ...filters, from: null, to: null });
}

function summarizeScraperRuns(scraperRuns) {
  const failedRuns = scraperRuns.filter((run) => !run.success);
  return {
    autoTriggered: scraperRuns.length > 0,
    success: scraperRuns.length > 0 && failedRuns.length === 0,
    failedRuns: failedRuns.map((run) => ({
      year: run.year,
      months: run.months,
      error: run.error,
    })),
    errorSummary: failedRuns.map((run) => `${run.year} months ${run.months.join(",")}: ${run.error}`).join("; "),
    runs: scraperRuns.map((run) => ({
      year: run.year,
      months: run.months,
      success: run.success,
    })),
  };
}

function resolveDataStatus({ rows, missingMonths, scraper }) {
  if (scraper.autoTriggered && scraper.failedRuns.length > 0) {
    return rows.length > 0 ? "stale" : "fetch_failed";
  }
  if (missingMonths.length > 0 && rows.length > 0) return "partial";
  if (missingMonths.length > 0) return "missing";
  return "complete";
}

function summarize(rows) {
  const total = rows.reduce((sum, row) => sum + row.vehicle_count, 0);
  const byMonth = new Map();
  const byFuel = new Map();
  for (const row of rows) {
    const key = monthKey(row.year, row.month);
    byMonth.set(key, (byMonth.get(key) ?? 0) + row.vehicle_count);
    byFuel.set(row.fuel_type, (byFuel.get(row.fuel_type) ?? 0) + row.vehicle_count);
  }
  const trend = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }));
  const fuelBreakdown = [...byFuel.entries()].sort((a, b) => b[1] - a[1]).map(([fuelType, count]) => ({ fuelType, count }));
  const peak = trend.reduce((best, item) => (item.count > (best?.count ?? -1) ? item : best), null);
  return {
    total,
    monthlyAverage: trend.length ? Math.round(total / trend.length) : 0,
    peakMonth: peak?.month ?? null,
    peakMonthCount: peak?.count ?? 0,
    trend,
    fuelBreakdown,
  };
}

function freshness(rows) {
  const latest = rows
    .map((row) => monthKey(row.year, row.month))
    .sort((a, b) => b.localeCompare(a))[0] ?? null;
  return { latestMonth: latest, source: SOURCE_LABEL };
}

async function queryData(input) {
  let rows = await loadRows();
  const ruleFilters = decodeWithRules(input.query ?? "");
  let llmFilters = null;
  if (!ruleFilters.state && !ruleFilters.rto && !ruleFilters.locationText) {
    try {
      llmFilters = normalizeGeminiFilters(await decodeWithGemini(input.query ?? ""));
    } catch (error) {
      llmFilters = { decodeWarning: error.message };
    }
  }
  let filters = resolveRto(mergeFilters(ruleFilters, llmFilters), rows);
  let resultRows = filters.ambiguousRtos ? [] : filterRows(rows, filters);
  const scraperRuns = [];

  // Detect missing months even if some data already exists
  let missingMonths = findMissingMonths(filters, rows);

  if (shouldAutoScrape(filters, resultRows, missingMonths)) {
    console.log(`[query] Auto-scraping: state=${filters.state}, rto=${filters.rto ?? filters.rtoSearch ?? filters.locationText}, missing=${JSON.stringify(missingMonths)}`);
    const runs = await runScraperForFilters(filters, missingMonths);
    scraperRuns.push(...runs);

    // Reload data and re-resolve
    rows = await loadRows();
    filters = resolveRto(
      { ...filters, unresolvedLocation: null, ambiguousRtos: null, rto: filters.rto ?? null },
      rows,
    );
    resultRows = filters.ambiguousRtos ? [] : filterRows(rows, filters);
    missingMonths = findMissingMonths(filters, rows);
  }

  const scraper = summarizeScraperRuns(scraperRuns);
  if (scraper.autoTriggered && scraper.failedRuns.length > 0 && resultRows.length === 0) {
    const staleRows = filters.ambiguousRtos ? [] : filterRowsIgnoringDate(rows, filters);
    if (staleRows.length > 0) resultRows = staleRows;
  }

  const dataStatus = resolveDataStatus({ rows: resultRows, missingMonths, scraper });
  const summary = summarize(resultRows);
  return {
    filters,
    dataStatus,
    summary: {
      total: summary.total,
      monthlyAverage: summary.monthlyAverage,
      peakMonth: summary.peakMonth,
      peakMonthCount: summary.peakMonthCount,
    },
    trend: summary.trend,
    fuelBreakdown: summary.fuelBreakdown,
    rows: resultRows,
    freshness: freshness(rows),
    scraper,
    warnings: [
      llmFilters?.decodeWarning,
      scraper.failedRuns.length
        ? "Live VAHAN fetch failed for this query. Results may be missing or stale."
        : null,
      dataStatus === "stale" ? "Showing last known matching local data because the requested fresh data could not be fetched." : null,
      dataStatus === "partial" ? "Some requested months are missing from local data." : null,
      filters.unresolvedLocation ? `Could not resolve location "${filters.unresolvedLocation}" from loaded data.` : null,
      filters.ambiguousRtos ? "Location matched multiple RTOs. Choose one." : null,
    ].filter(Boolean),
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const filePath = url.pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, url.pathname);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  const content = await fs.readFile(resolved).catch(() => null);
  if (!content) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const ext = path.extname(resolved);
  const contentType = ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "text/html";
  response.writeHead(200, { "content-type": contentType });
  response.end(content);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "POST" && url.pathname === "/api/query") {
      const body = await readBody(request);
      sendJson(response, 200, await queryData(body));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/registrations") {
      const rows = await loadRows();
      const filters = resolveRto({
        state: url.searchParams.get("state") || null,
        rto: url.searchParams.get("rto") || null,
        fuelSegment: url.searchParams.get("fuelSegment") || null,
        fuelType: url.searchParams.get("fuelType") || null,
        from: url.searchParams.get("from") || null,
        to: url.searchParams.get("to") || null,
      }, rows);
      const resultRows = filterRows(rows, filters);
      const summary = summarize(resultRows);
      sendJson(response, 200, { filters, summary, trend: summary.trend, fuelBreakdown: summary.fuelBreakdown, rows: resultRows, freshness: freshness(rows) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/metadata/rtos") {
      const rows = await loadRows();
      const state = url.searchParams.get("state");
      const rtos = [...new Set(rows.filter((row) => !state || row.state === state).map((row) => row.rto))].sort();
      sendJson(response, 200, { rtos });
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      const rows = await loadRows();
      sendJson(response, 200, { status: "ok", rowCount: rows.length, ...freshness(rows) });
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`VAHAN dashboard running at http://localhost:${PORT}`);
});
