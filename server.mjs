import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { hasDatabaseUrl } from "./lib/db.mjs";
import {
  queryMakerRegistrationRows,
  readLegacyMakerFuelCsv,
  readMakerRegistrationsCsv,
} from "./lib/maker-registrations.mjs";
import {
  buildMonthlySalesReport,
  renderMonthlySalesReportHtml,
} from "./lib/monthly-sales-report.mjs";
import {
  REGISTRATION_HEADERS,
  loadRegistrationRowsFromDb,
  queryAvailableMonthFuelTypes,
  queryAvailableMonths,
  queryRegistrationFreshness,
  queryRegistrationRows,
  queryRtos,
  readRegistrationsCsv,
  upsertRegistrationRows,
} from "./lib/registrations.mjs";
import {
  buildRtoCatalogFromRows,
  loadRtoCatalog,
  resolveRtoWithCatalog,
} from "./lib/rto-resolver.mjs";
import {
  createTelegramBot,
  parseAllowedChatIds,
} from "./lib/telegram-bot.mjs";
import {
  authCookieName,
  clearCookieHeader,
  createSession,
  createTelegramLinkCode,
  currentUser,
  destroySession,
  googleLoginUrl,
  googleUserFromCode,
  hasGoogleAuthConfig,
  linkTelegramChat,
  oauthStateCookieName,
  oauthStateCookieValue,
  parseCookies,
  readOauthStateCookie,
  requireUser,
  sessionCookie,
  telegramDeepLink,
  upsertGoogleUser,
  userForTelegramChat,
} from "./lib/auth.mjs";
import {
  createTrackedQuery,
  deleteTrackedQuery,
  disableTrackedQuery,
  getTrackedQuery,
  listTrackedQueries,
  listTrackedQueryObservations,
  listTrackedQueryRuns,
  updateTrackedQuery,
} from "./lib/tracked-queries.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.join(__dirname, "data", "vahan", "vahan_fuel_monthly.csv");
const MAKER_DATA_FILE = path.join(__dirname, "data", "vahan", "vahan_maker_monthly.csv");
const LEGACY_MAKER_DATA_FILE = path.join(__dirname, "data", "vahan", "vahan_state_maker_fuel.csv");
const RTO_CATALOG_FILE = path.join(__dirname, "data", "vahan", "rto_catalog.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const SOURCE_LABEL = "VAHAN public dashboard aggregate data";
const SCRAPED_ROWS_MARKER = "VAHAN_SCRAPED_ROWS_JSON:";
const execFileAsync = promisify(execFile);
const ALL_RTO = "All Vahan4 Running Office";
const ALL_FILTER = "ALL";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const LIVE_REFRESH_DISABLED = envFlag("VAHAN_DISABLE_LIVE_REFRESH", IS_PRODUCTION);
const TELEGRAM_ENABLE_POLLING = envFlag("TELEGRAM_ENABLE_POLLING", !IS_PRODUCTION);
const TELEGRAM_ALERT_THRESHOLD_POINTS = envNumber("TELEGRAM_ALERT_THRESHOLD_POINTS", 2);
const TELEGRAM_SUMMARY_FETCH_MISSING = envFlag("TELEGRAM_SUMMARY_FETCH_MISSING", !IS_PRODUCTION);
const TELEGRAM_PUBLIC_DAILY_LIMIT = Math.max(0, envNumber("TELEGRAM_PUBLIC_DAILY_LIMIT", 0));
const TELEGRAM_PUBLIC_ACCESS = TELEGRAM_PUBLIC_DAILY_LIMIT > 0;
const REQUIRE_DATABASE_FOR_READINESS = envFlag("REQUIRE_DATABASE_FOR_READINESS", IS_PRODUCTION);
const TRUST_PROXY = envFlag("TRUST_PROXY", IS_PRODUCTION);
const MAX_JSON_BODY_BYTES = envNumber("MAX_JSON_BODY_BYTES", 65_536);
const PUBLIC_RATE_LIMIT_WINDOW_MS = envNumber("PUBLIC_RATE_LIMIT_WINDOW_MS", 60_000);
const PUBLIC_RATE_LIMIT_MAX = envNumber("PUBLIC_RATE_LIMIT_MAX", 120);
const EXPENSIVE_RATE_LIMIT_WINDOW_MS = envNumber("EXPENSIVE_RATE_LIMIT_WINDOW_MS", 60_000);
const EXPENSIVE_RATE_LIMIT_MAX = envNumber("EXPENSIVE_RATE_LIMIT_MAX", 20);
const REFRESH_JOB_TTL_MS = envNumber("REFRESH_JOB_TTL_MS", 30 * 60_000);
const MAP_REFRESH_JOB_TTL_MS = envNumber("MAP_REFRESH_JOB_TTL_MS", 60 * 60_000);
const SECURITY_HEADERS = Object.freeze({
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin",
});
const FILTER_CONTEXT_FIELDS = [
  "fuel_filter",
  "vehicle_category_filter",
  "norms_filter",
  "vehicle_class_filter",
];
let rtoCatalogCache = null;
let makerDataCache = null;
let telegramBot = null;
let telegramAllowedChatIds = new Set();
const telegramChatModes = new Map();
const telegramPublicUsage = new Map();
const sentTelegramAlertKeys = new Set();
const sentTelegramSummaryKeys = new Set();
const publicRateLimitBuckets = new Map();
const expensiveRateLimitBuckets = new Map();

const INDIA_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli",
  "Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu & Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

const VAHAN_FETCH_STATES = INDIA_STATES.filter((state) => state !== "Daman and Diu");
const TELEGRAM_SUMMARY_STATES = VAHAN_FETCH_STATES;
const TELEGRAM_SUMMARY_STATE_SET = new Set(TELEGRAM_SUMMARY_STATES);
const SUMMARY_CHOICE_KEYBOARD = {
  keyboard: [["Weekly", "Monthly"], ["Query", "Map", "Summary"]],
  resize_keyboard: true,
  one_time_keyboard: false,
  is_persistent: true,
};
const MAP_TO_VAHAN_STATE = new Map([
  ["Andaman and Nicobar Islands", "Andaman & Nicobar Island"],
  ["Dadra and Nagar Haveli", "UT of DNH and DD"],
  ["Jammu & Kashmir", "Jammu and Kashmir"],
]);
const MAP_SCRAPER_GROUP_TIMEOUT_MS = 90_000;
const DEFERRED_MAP_FETCH_STATES = new Set(["Jammu & Kashmir"]);

function envFlag(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return Boolean(defaultValue);
  return /^(1|true|yes|on)$/i.test(value);
}

function envNumber(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : defaultValue;
}

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
  ["gujrat", "Gujarat"], ["gujarath", "Gujarat"], ["gujraat", "Gujarat"],
  ["maharastra", "Maharashtra"], ["maharashtr", "Maharashtra"],
  ["karnatak", "Karnataka"], ["rajsthan", "Rajasthan"], ["rajasthan", "Rajasthan"],
  ["uttar prdesh", "Uttar Pradesh"], ["uttar pardesh", "Uttar Pradesh"],
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

const FUEL_FILTER_ALIASES = [
  { aliases: ["diesel"], value: "DIESEL", fuelSegment: "NON_EV", fuelType: "DIESEL" },
  { aliases: ["petrol"], value: "PETROL", fuelSegment: "NON_EV", fuelType: "PETROL" },
  { aliases: ["flex fuel biodiesel", "flex-fuel biodiesel", "flex-fuel bio-diesel"], value: "FLEX-FUEL(BIO-DIESEL)", fuelSegment: "NON_EV", fuelType: "FLEX-FUEL(BIO-DIESEL)" },
  { aliases: ["flex fuel ethanol", "flex-fuel ethanol"], value: "FLEX-FUEL(ETHANOL)", fuelSegment: "NON_EV", fuelType: "FLEX-FUEL(ETHANOL)" },
  { aliases: ["cng", "cng only"], value: "CNG ONLY", fuelSegment: "NON_EV", fuelType: "CNG" },
  { aliases: ["hcng"], value: "HCNG", fuelSegment: "NON_EV", fuelType: "HCNG" },
  { aliases: ["hydrogen ice", "hydrogen internal combustion", "hydrogen(ice)"], value: "HYDROGEN(ICE)", fuelSegment: "NON_EV", fuelType: "HYDROGEN(ICE)" },
  { aliases: ["petrol e20", "e20 petrol"], value: "PETROL(E20)", fuelSegment: "NON_EV", fuelType: "PETROL(E20)" },
  { aliases: ["petrol e20 cng", "petrol e20/cng", "e20 cng"], value: "PETROL(E20)/CNG", fuelSegment: "NON_EV", fuelType: "PETROL(E20)/CNG" },
  { aliases: ["petrol e20 hybrid", "petrol e20/hybrid", "e20 hybrid"], value: "PETROL(E20)/HYBRID", fuelSegment: "NON_EV", fuelType: "PETROL(E20)/HYBRID" },
  { aliases: ["petrol e20 hybrid cng", "petrol e20/hybrid/cng", "e20 hybrid cng"], value: "PETROL(E20)/HYBRID/CNG", fuelSegment: "NON_EV", fuelType: "PETROL(E20)/HYBRID/CNG" },
  { aliases: ["petrol e20 lpg", "petrol e20/lpg", "e20 lpg"], value: "PETROL(E20)/LPG", fuelSegment: "NON_EV", fuelType: "PETROL(E20)/LPG" },
  { aliases: ["electric bov", "electric(bov)", "battery operated vehicle"], value: "ELECTRIC(BOV)", fuelSegment: "EV", fuelType: "ELECTRIC" },
  { aliases: ["plug in hybrid", "plug-in hybrid", "phev"], value: "PLUG-IN HYBRID EV", fuelSegment: "EV", fuelType: "PLUG-IN HYBRID EV" },
  { aliases: ["pure ev", "battery ev"], value: "PURE EV", fuelSegment: "EV", fuelType: "PURE EV" },
  { aliases: ["strong hybrid"], value: "STRONG HYBRID EV", fuelSegment: "EV", fuelType: "STRONG HYBRID EV" },
];

const BATTERY_ELECTRIC_FUELS = ["ELECTRIC(BOV)", "PURE EV"];
const HYBRID_FUELS = [
  "DIESEL/HYBRID",
  "PETROL(E20)/HYBRID",
  "PETROL(E20)/HYBRID/CNG",
  "PETROL/HYBRID",
  "PETROL/HYBRID/CNG",
  "PLUG-IN HYBRID EV",
  "STRONG HYBRID EV",
];
const KNOWN_FUEL_TYPES = [
  "CNG ONLY",
  "DIESEL",
  "DIESEL/HYBRID",
  "FLEX-FUEL(BIO-DIESEL)",
  "FLEX-FUEL(ETHANOL)",
  "DUAL DIESEL/CNG",
  "DUAL DIESEL/LNG",
  "ELECTRIC(BOV)",
  "ETHANOL(E100)",
  "FUEL CELL HYDROGEN",
  "HCNG",
  "HYDROGEN(ICE)",
  "LNG",
  "LPG ONLY",
  "METHANOL",
  "NOT APPLICABLE",
  "PETROL",
  "PETROL(E20)",
  "PETROL(E20)/CNG",
  "PETROL(E20)/HYBRID",
  "PETROL(E20)/HYBRID/CNG",
  "PETROL(E20)/LPG",
  "PETROL/CNG",
  "PETROL/HYBRID",
  "PETROL/HYBRID/CNG",
  "PETROL/LPG",
  "PETROL/METHANOL",
  "PLUG-IN HYBRID EV",
  "PURE EV",
  "STRONG HYBRID EV",
];

const KNOWN_VEHICLE_CLASSES = [
  "ADAPTED VEHICLE",
  "AGRICULTURAL TRACTOR",
  "AMBULANCE",
  "ANIMAL AMBULANCE",
  "ARTICULATED VEHICLE",
  "AUXILIARY TRAILER",
  "BREAKDOWN VAN",
  "BULLDOZER",
  "BUS",
  "CAMPER VAN / TRAILER",
  "CAMPER VAN / TRAILER (PRIVATE USE)",
  "CASH VAN",
  "CONSTRUCTION EQUIPMENT VEHICLE",
  "CONSTRUCTION EQUIPMENT VEHICLE (COMMERCIAL)",
  "CRANE MOUNTED VEHICLE",
  "DUMPER",
  "EARTH MOVING EQUIPMENT",
  "EDUCATIONAL INSTITUTION BUS",
  "E-RICKSHAW WITH CART (G)",
  "E-RICKSHAW(P)",
  "EXCAVATOR (COMMERCIAL)",
  "EXCAVATOR (NT)",
  "FIRE FIGHTING VEHICLE",
  "FIRE TENDERS",
  "FORK LIFT",
  "GOODS CARRIER",
  "HARVESTER",
  "HEARSES",
  "LIBRARY VAN",
  "LUXURY CAB",
  "M-CYCLE/SCOOTER",
  "M-CYCLE/SCOOTER-WITH SIDE CAR",
  "MAXI CAB",
  "MOBILE CANTEEN",
  "MOBILE CLINIC",
  "MOBILE WORKSHOP",
  "MODULAR HYDRAULIC TRAILER",
  "MOPED",
  "MOTOR CAB",
  "MOTOR CAR",
  "MOTOR CARAVAN",
  "MOTOR CYCLE/SCOOTER-SIDECAR(T)",
  "MOTOR CYCLE/SCOOTER-USED FOR HIRE",
  "MOTOR CYCLE/SCOOTER-WITH TRAILER",
  "MOTORISED CYCLE (CC > 25CC)",
  "OMNI BUS",
  "OMNI BUS (PRIVATE USE)",
  "POWER TILLER",
  "POWER TILLER (COMMERCIAL)",
  "PRIVATE SERVICE VEHICLE",
  "PRIVATE SERVICE VEHICLE (INDIVIDUAL USE)",
  "PULLER TRACTOR",
  "QUADRICYCLE (COMMERCIAL)",
  "QUADRICYCLE (PRIVATE)",
  "RECOVERY VEHICLE",
  "ROAD ROLLER",
  "SCHOOL BUS",
  "SEMI-TRAILER (COMMERCIAL)",
  "SNORKED LADDERS",
  "TOW TRUCK",
  "TOWER WAGON",
  "TRACTOR (COMMERCIAL)",
  "TRACTOR-TROLLEY(COMMERCIAL)",
  "TRAILER (AGRICULTURAL)",
  "TRAILER (COMMERCIAL)",
  "TRAILER FOR PERSONAL USE",
  "TREE TRIMMING VEHICLE",
  "THREE WHEELER (GOODS)",
  "THREE WHEELER (PASSENGER)",
  "THREE WHEELER (PERSONAL)",
  "VEHICLE FITTED WITH COMPRESSOR",
  "VEHICLE FITTED WITH GENERATOR",
  "VEHICLE FITTED WITH RIG",
  "VINTAGE MOTOR VEHICLE",
  "X-RAY VAN",
];

const VEHICLE_CATEGORY_ALIASES = [
  { aliases: ["two wheeler invalid carriage", "2 wheeler invalid carriage"], value: "TWO WHEELER (Invalid Carriage)" },
  { aliases: ["two wheeler nt", "two wheeler non transport", "2 wheeler nt", "2w nt", "two wheeler", "two wheelers"], value: "TWO WHEELER(NT)" },
  { aliases: ["two wheeler t", "two wheeler transport", "2 wheeler t", "2w t", "two wheeler", "two wheelers"], value: "TWO WHEELER(T)" },
  { aliases: ["three wheeler invalid carriage", "3 wheeler invalid carriage"], value: "THREE WHEELER (Invalid Carriage)" },
  { aliases: ["three wheeler nt", "three wheeler non transport", "3 wheeler nt", "3w nt", "three wheeler", "three wheelers"], value: "THREE WHEELER(NT)" },
  { aliases: ["three wheeler t", "three wheeler transport", "3 wheeler t", "3w t", "three wheeler", "three wheelers"], value: "THREE WHEELER(T)" },
  { aliases: ["four wheeler invalid carriage", "4 wheeler invalid carriage"], value: "FOUR WHEELER (Invalid Carriage)" },
  { aliases: ["heavy goods vehicle"], value: "HEAVY GOODS VEHICLE" },
  { aliases: ["hmv", "heavy motor vehicle"], value: "HEAVY MOTOR VEHICLE" },
  { aliases: ["heavy passenger vehicle"], value: "HEAVY PASSENGER VEHICLE" },
  { aliases: ["light goods vehicle"], value: "LIGHT GOODS VEHICLE" },
  { aliases: ["lmv", "light motor vehicle"], value: "LIGHT MOTOR VEHICLE" },
  { aliases: ["light passenger vehicle"], value: "LIGHT PASSENGER VEHICLE" },
  { aliases: ["medium goods vehicle"], value: "MEDIUM GOODS VEHICLE" },
  { aliases: ["mmv", "medium motor vehicle"], value: "MEDIUM MOTOR VEHICLE" },
  { aliases: ["medium passenger vehicle"], value: "MEDIUM PASSENGER VEHICLE" },
  { aliases: ["other than mentioned above"], value: "OTHER THAN MENTIONED ABOVE" },
];

const VEHICLE_GROUP_ALIASES = [
  { aliases: ["two wheeler", "two wheelers", "2 wheeler", "2 wheelers", "2w"], value: "TWO WHEELER" },
  { aliases: ["three wheeler", "three wheelers", "3 wheeler", "3 wheelers", "3w"], value: "THREE WHEELER" },
];

const PRIVATE_FOUR_WHEELER_CLASSES = [
  "MOTOR CAR",
  "MOTOR CARAVAN",
  "OMNI BUS (PRIVATE USE)",
  "ADAPTED VEHICLE",
  "VINTAGE MOTOR VEHICLE",
];

const PRIVATE_FOUR_WHEELER_ALIASES = [
  "four wheeler",
  "four wheelers",
  "4 wheeler",
  "4 wheelers",
  "4w",
  "private four wheeler",
  "private four wheelers",
  "private 4 wheeler",
  "private 4 wheelers",
  "private 4w",
  "non transport four wheeler",
  "non transport four wheelers",
  "non transport 4 wheeler",
  "non transport 4 wheelers",
  "non transport 4w",
  "non-transport four wheeler",
  "non-transport four wheelers",
  "non-transport 4 wheeler",
  "non-transport 4 wheelers",
  "non-transport 4w",
];

const NORMS_ALIASES = [
  { aliases: ["bs i", "bharat stage i"], value: "BHARAT STAGE I" },
  { aliases: ["bs ii", "bharat stage ii"], value: "BHARAT STAGE II" },
  { aliases: ["bs iii", "bharat stage iii"], value: "BHARAT STAGE III" },
  { aliases: ["bs iii cev", "bharat stage iii cev"], value: "BHARAT STAGE III (CEV)" },
  { aliases: ["bs iii iv", "bharat stage iii iv", "bharat stage iii/iv"], value: "BHARAT STAGE III/IV" },
  { aliases: ["bs iv", "bharat stage iv"], value: "BHARAT STAGE IV" },
  { aliases: ["bs vi", "bs 6", "bharat stage vi", "bharat stage 6"], value: "BHARAT STAGE VI" },
  { aliases: ["trem stage iii", "bharat trem stage iii"], value: "BHARAT (TREM) STAGE III" },
  { aliases: ["trem stage iii a", "trem stage iiia", "bharat trem stage iii a"], value: "BHARAT (TREM) STAGE III A" },
  { aliases: ["trem stage iii b", "trem stage iiib", "bharat trem stage iii b"], value: "BHARAT (TREM) STAGE III B" },
  { aliases: ["cev stage iv"], value: "CEV STAGE IV" },
  { aliases: ["cev stage v"], value: "CEV STAGE V" },
  { aliases: ["euro 1"], value: "EURO 1" },
  { aliases: ["euro 2"], value: "EURO 2" },
  { aliases: ["euro 3"], value: "EURO 3" },
  { aliases: ["euro 4"], value: "EURO 4" },
  { aliases: ["euro 6"], value: "EURO 6" },
  { aliases: ["euro 6a"], value: "EURO 6A" },
  { aliases: ["euro 6ad"], value: "EURO 6AD" },
  { aliases: ["euro 6b"], value: "EURO 6B" },
  { aliases: ["euro 6c"], value: "EURO 6C" },
  { aliases: ["euro 6d"], value: "EURO 6D" },
  { aliases: ["not applicable"], value: "NOT APPLICABLE" },
  { aliases: ["not available"], value: "NOT AVAILABLE" },
  { aliases: ["trem stage iv"], value: "TREM STAGE IV" },
  { aliases: ["trem stage v"], value: "TREM STAGE V" },
];

const VEHICLE_CLASS_ALIASES = [
  { aliases: ["adapted vehicle"], value: "ADAPTED VEHICLE" },
  { aliases: ["agricultural tractor", "tractor agricultural"], value: "AGRICULTURAL TRACTOR" },
  { aliases: ["ambulance", "ambulances"], value: "AMBULANCE" },
  { aliases: ["animal ambulance"], value: "ANIMAL AMBULANCE" },
  { aliases: ["articulated vehicle"], value: "ARTICULATED VEHICLE" },
  { aliases: ["auxiliary trailer"], value: "AUXILIARY TRAILER" },
  { aliases: ["breakdown van"], value: "BREAKDOWN VAN" },
  { aliases: ["bulldozer"], value: "BULLDOZER" },
  { aliases: ["motor car", "car", "cars"], value: "MOTOR CAR" },
  { aliases: ["motor cab", "cab", "taxi"], value: "MOTOR CAB" },
  { aliases: ["bus", "buses"], value: "BUS" },
  { aliases: ["school bus"], value: "SCHOOL BUS" },
  { aliases: ["educational institution bus"], value: "EDUCATIONAL INSTITUTION BUS" },
  { aliases: ["omni bus"], value: "OMNI BUS" },
  { aliases: ["omni bus private use", "private use omni bus"], value: "OMNI BUS (PRIVATE USE)" },
  { aliases: ["m-cycle/scooter", "motorcycle", "motor cycle", "scooter"], value: "M-CYCLE/SCOOTER" },
  { aliases: ["m-cycle scooter with side car", "motorcycle with side car", "scooter with side car"], value: "M-CYCLE/SCOOTER-WITH SIDE CAR" },
  { aliases: ["motor cycle scooter sidecar t", "motorcycle sidecar t", "scooter sidecar t"], value: "MOTOR CYCLE/SCOOTER-SIDECAR(T)" },
  { aliases: ["motor cycle scooter used for hire", "motorcycle used for hire", "scooter used for hire"], value: "MOTOR CYCLE/SCOOTER-USED FOR HIRE" },
  { aliases: ["motor cycle scooter with trailer", "motorcycle with trailer", "scooter with trailer"], value: "MOTOR CYCLE/SCOOTER-WITH TRAILER" },
  { aliases: ["motorised cycle", "motorised cycle cc > 25cc", "motorized cycle"], value: "MOTORISED CYCLE (CC > 25CC)" },
  { aliases: ["moped"], value: "MOPED" },
  { aliases: ["goods carrier"], value: "GOODS CARRIER" },
  { aliases: ["commercial tractor", "tractor commercial"], value: "TRACTOR (COMMERCIAL)" },
  { aliases: ["puller tractor"], value: "PULLER TRACTOR" },
  { aliases: ["e-rickshaw passenger", "erickshaw passenger", "passenger e-rickshaw", "passenger erickshaw"], value: "E-RICKSHAW(P)" },
  { aliases: ["e-rickshaw cart", "erickshaw cart", "e-rickshaw goods", "erickshaw goods", "goods e-rickshaw", "goods erickshaw", "cargo e-rickshaw", "cargo erickshaw", "electric goods rickshaw"], value: "E-RICKSHAW WITH CART (G)" },
  { aliases: ["three wheeler passenger", "three wheelers passenger", "3 wheeler passenger", "3w passenger", "passenger three wheeler", "passenger 3 wheeler"], value: "THREE WHEELER (PASSENGER)" },
  { aliases: ["three wheeler goods", "three wheelers goods", "3 wheeler goods", "3w goods", "goods three wheeler", "goods 3 wheeler"], value: "THREE WHEELER (GOODS)" },
  { aliases: ["three wheeler personal", "personal three wheeler"], value: "THREE WHEELER (PERSONAL)" },
  { aliases: ["fork lift", "forklift", "fork lifts", "forklifts"], value: "FORK LIFT" },
  { aliases: ["tow truck"], value: "TOW TRUCK" },
  { aliases: ["fire tenders", "fire tender"], value: "FIRE TENDERS" },
  { aliases: ["fire fighting vehicle"], value: "FIRE FIGHTING VEHICLE" },
  { aliases: ["agricultural trailer", "trailer agricultural"], value: "TRAILER (AGRICULTURAL)" },
  { aliases: ["commercial trailer", "trailer commercial"], value: "TRAILER (COMMERCIAL)" },
  { aliases: ["personal trailer", "trailer for personal use"], value: "TRAILER FOR PERSONAL USE" },
  { aliases: ["semi trailer", "semi-trailer", "commercial semi trailer"], value: "SEMI-TRAILER (COMMERCIAL)" },
  { aliases: ["tractor trolley", "tractor-trolley", "commercial tractor trolley"], value: "TRACTOR-TROLLEY(COMMERCIAL)" },
  { aliases: ["camper van", "camper trailer"], value: "CAMPER VAN / TRAILER" },
  { aliases: ["private camper van", "private camper trailer", "camper van private use"], value: "CAMPER VAN / TRAILER (PRIVATE USE)" },
  { aliases: ["cash van"], value: "CASH VAN" },
  { aliases: ["construction equipment vehicle"], value: "CONSTRUCTION EQUIPMENT VEHICLE" },
  { aliases: ["commercial construction equipment vehicle"], value: "CONSTRUCTION EQUIPMENT VEHICLE (COMMERCIAL)" },
  { aliases: ["crane mounted vehicle"], value: "CRANE MOUNTED VEHICLE" },
  { aliases: ["dumper"], value: "DUMPER" },
  { aliases: ["earth moving equipment"], value: "EARTH MOVING EQUIPMENT" },
  { aliases: ["excavator commercial", "commercial excavator"], value: "EXCAVATOR (COMMERCIAL)" },
  { aliases: ["excavator nt"], value: "EXCAVATOR (NT)" },
  { aliases: ["harvester"], value: "HARVESTER" },
  { aliases: ["hearse", "hearses"], value: "HEARSES" },
  { aliases: ["library van"], value: "LIBRARY VAN" },
  { aliases: ["luxury cab"], value: "LUXURY CAB" },
  { aliases: ["maxi cab"], value: "MAXI CAB" },
  { aliases: ["mobile canteen"], value: "MOBILE CANTEEN" },
  { aliases: ["mobile clinic"], value: "MOBILE CLINIC" },
  { aliases: ["mobile workshop"], value: "MOBILE WORKSHOP" },
  { aliases: ["modular hydraulic trailer"], value: "MODULAR HYDRAULIC TRAILER" },
  { aliases: ["motor caravan"], value: "MOTOR CARAVAN" },
  { aliases: ["power tiller"], value: "POWER TILLER" },
  { aliases: ["commercial power tiller", "power tiller commercial"], value: "POWER TILLER (COMMERCIAL)" },
  { aliases: ["private service vehicle"], value: "PRIVATE SERVICE VEHICLE" },
  { aliases: ["individual private service vehicle", "private service vehicle individual use"], value: "PRIVATE SERVICE VEHICLE (INDIVIDUAL USE)" },
  { aliases: ["quadricycle commercial", "commercial quadricycle"], value: "QUADRICYCLE (COMMERCIAL)" },
  { aliases: ["quadricycle private", "private quadricycle"], value: "QUADRICYCLE (PRIVATE)" },
  { aliases: ["recovery vehicle"], value: "RECOVERY VEHICLE" },
  { aliases: ["road roller"], value: "ROAD ROLLER" },
  { aliases: ["snorked ladders", "snorkel ladder", "snorked ladder"], value: "SNORKED LADDERS" },
  { aliases: ["tower wagon"], value: "TOWER WAGON" },
  { aliases: ["tree trimming vehicle"], value: "TREE TRIMMING VEHICLE" },
  { aliases: ["vehicle fitted with compressor"], value: "VEHICLE FITTED WITH COMPRESSOR" },
  { aliases: ["vehicle fitted with generator"], value: "VEHICLE FITTED WITH GENERATOR" },
  { aliases: ["vehicle fitted with rig"], value: "VEHICLE FITTED WITH RIG" },
  { aliases: ["vintage motor vehicle", "vintage vehicle"], value: "VINTAGE MOTOR VEHICLE" },
  { aliases: ["x-ray van", "xray van"], value: "X-RAY VAN" },
];

let dataCache = null;
let databaseUnavailable = false;
let persistenceQueue = Promise.resolve();
let nextRefreshJobId = 1;
const refreshJobs = new Map();
const mapRefreshJobs = new Map();
const MAX_MAP_FETCH_MONTHS = 12;

function securityHeaders(headers = {}) {
  return { ...SECURITY_HEADERS, ...headers };
}

function clientIp(request) {
  const forwardedFor = TRUST_PROXY ? request.headers["x-forwarded-for"] : null;
  if (forwardedFor) return String(forwardedFor).split(",")[0].trim() || "unknown";
  return request.socket?.remoteAddress ?? "unknown";
}

function enforceRateLimit(request, group) {
  const config = group === "expensive"
    ? {
        buckets: expensiveRateLimitBuckets,
        max: EXPENSIVE_RATE_LIMIT_MAX,
        windowMs: EXPENSIVE_RATE_LIMIT_WINDOW_MS,
      }
    : {
        buckets: publicRateLimitBuckets,
        max: PUBLIC_RATE_LIMIT_MAX,
        windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
      };

  if (config.max <= 0 || config.windowMs <= 0) return;

  cleanupRateLimitBuckets();

  const now = Date.now();
  const key = `${group}:${clientIp(request)}`;
  let bucket = config.buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + config.windowMs };
    config.buckets.set(key, bucket);
  }

  if (bucket.count >= config.max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    const error = new Error("Too many requests. Please wait before trying again.");
    error.statusCode = 429;
    error.headers = { "retry-after": String(retryAfter) };
    throw error;
  }

  bucket.count += 1;
}

function cleanupRateLimitBuckets() {
  const now = Date.now();
  for (const buckets of [publicRateLimitBuckets, expensiveRateLimitBuckets]) {
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }
}

function cleanupJobMap(map, ttlMs) {
  if (ttlMs <= 0) return;
  const now = Date.now();
  for (const [id, job] of map.entries()) {
    if (job.status !== "pending" && now - job.createdAt > ttlMs) {
      map.delete(id);
    }
  }
}

function cleanupRefreshJobs() {
  cleanupJobMap(refreshJobs, REFRESH_JOB_TTL_MS);
  cleanupJobMap(mapRefreshJobs, MAP_REFRESH_JOB_TTL_MS);
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLookup(value) {
  return compact(value).toLowerCase();
}

function isSameStateLocation(value, state) {
  if (!value || !state) return false;
  const location = normalizeLookup(value);
  const stateLookup = normalizeLookup(state);
  return (
    location === stateLookup ||
    location === `${stateLookup} state` ||
    location === `state of ${stateLookup}`
  );
}

function uniqueSorted(values) {
  return [...new Set((values ?? []).filter(Boolean).map((value) => compact(value)))].sort((a, b) => a.localeCompare(b));
}

function uniqueLabelValues(values) {
  const labels = [];
  const seen = new Set();
  for (const value of values ?? []) {
    const label = compact(value);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels.sort((a, b) => a.localeCompare(b));
}

function filterContextValue(values) {
  const normalized = uniqueSorted(values).map((value) => value.toUpperCase());
  return normalized.length ? normalized.join("|") : ALL_FILTER;
}

function isRedundantFuelFilter(value, fuelType) {
  if (!value || !fuelType) return false;
  const normalizedValue = normalizeLookup(value).replace(/[()]/g, "");
  const normalizedFuelType = normalizeLookup(fuelType).replace(/[()]/g, "");
  return normalizedValue.includes(normalizedFuelType) || normalizedFuelType.includes(normalizedValue);
}

function fuelFiltersForQuery(text, matches, fuelType) {
  const wantsCheckboxContext = /\b(?:fuel\s*(?:filter|checkbox)|checkbox\s*fuel)\b/i.test(text);
  if (!wantsCheckboxContext) return [];
  return uniqueSorted(
    matches
      .map((definition) => definition.value)
      .filter((value) => !isRedundantFuelFilter(value, fuelType)),
  );
}

function filterContext(filters = {}) {
  return {
    fuel_filter: filterContextValue(filters.fuelFilters),
    vehicle_category_filter: filterContextValue(filters.vehicleCategories),
    norms_filter: filterContextValue(filters.norms),
    vehicle_class_filter: filterContextValue(filters.vehicleClasses),
  };
}

function hasActiveContext(filters = {}) {
  return Object.values(filterContext(filters)).some((value) => value !== ALL_FILTER);
}

function findFilterValues(text, definitions) {
  return uniqueSorted(
    findMatchingFilterDefinitions(text, definitions).map((definition) => definition.value),
  );
}

function findMatchingFilterDefinitions(text, definitions) {
  const normalizedText = normalizeLookup(text);
  const matches = [];

  for (const definition of definitions) {
    for (const alias of definition.aliases) {
      const normalizedAlias = normalizeLookup(alias);
      const pattern = new RegExp(`\\b${normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (pattern.test(normalizedText)) matches.push({ definition, alias: normalizedAlias });
    }
  }

  const selected = [];
  for (const match of matches.sort((a, b) => b.alias.length - a.alias.length)) {
    const shadowedBySpecificAlias = selected.some((item) =>
      item.definition.value !== match.definition.value &&
      item.alias.length > match.alias.length &&
      item.alias.includes(match.alias),
    );
    if (!shadowedBySpecificAlias) selected.push(match);
  }

  return selected.map((match) => match.definition);
}

function queryListParam(searchParams, key) {
  const values = searchParams.getAll(key);
  const expanded = values.flatMap((value) => String(value).split(/[|,]/));
  return uniqueSorted(expanded);
}

function queryFiltersFromSearchParams(searchParams, extra = {}) {
  return {
    state: searchParams.get("state") || null,
    rto: searchParams.get("rto") || null,
    locationText: searchParams.get("locationText") || null,
    fuelSegment: searchParams.get("fuelSegment") || null,
    fuelType: searchParams.get("fuelType") || null,
    fuelFilters: queryListParam(searchParams, "fuelFilters"),
    vehicleCategories: queryListParam(searchParams, "vehicleCategories"),
    norms: queryListParam(searchParams, "norms"),
    vehicleClasses: queryListParam(searchParams, "vehicleClasses"),
    from: searchParams.get("from") || null,
    to: searchParams.get("to") || null,
    ...extra,
  };
}

function normalizeMapStateName(state) {
  const lookup = {
    "Andaman & Nicobar Island": "Andaman and Nicobar Islands",
    "UT of DNH and DD": "Dadra and Nagar Haveli",
    "Jammu and Kashmir": "Jammu & Kashmir",
  };
  return lookup[state] ?? state;
}

function toVahanStateName(state) {
  return MAP_TO_VAHAN_STATE.get(state) ?? state;
}

function orderedMapFetchStates() {
  return [
    ...VAHAN_FETCH_STATES.filter((state) => !DEFERRED_MAP_FETCH_STATES.has(state)),
    ...VAHAN_FETCH_STATES.filter((state) => DEFERRED_MAP_FETCH_STATES.has(state)),
  ];
}

function uniqueInOrder(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function toRegistrationsCsv(rows) {
  const lines = [REGISTRATION_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(REGISTRATION_HEADERS.map((header) => csvEscape(row[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function rowIdentity(row) {
  return [
    row.year,
    row.month,
    row.state,
    row.rto,
    row.fuel_type,
    row.fuel_filter ?? ALL_FILTER,
    row.vehicle_category_filter ?? ALL_FILTER,
    row.norms_filter ?? ALL_FILTER,
    row.vehicle_class_filter ?? ALL_FILTER,
  ].join("||");
}

function mergeRegistrationRows(existingRows, freshRows) {
  const merged = new Map();
  for (const row of existingRows) merged.set(rowIdentity(row), row);
  for (const row of freshRows) merged.set(rowIdentity(row), row);
  return [...merged.values()].sort((a, b) =>
    a.year - b.year ||
    a.month - b.month ||
    a.state.localeCompare(b.state) ||
    a.rto.localeCompare(b.rto) ||
    String(a.fuel_filter ?? ALL_FILTER).localeCompare(String(b.fuel_filter ?? ALL_FILTER)) ||
    String(a.vehicle_category_filter ?? ALL_FILTER).localeCompare(String(b.vehicle_category_filter ?? ALL_FILTER)) ||
    String(a.norms_filter ?? ALL_FILTER).localeCompare(String(b.norms_filter ?? ALL_FILTER)) ||
    String(a.vehicle_class_filter ?? ALL_FILTER).localeCompare(String(b.vehicle_class_filter ?? ALL_FILTER)) ||
    a.fuel_type.localeCompare(b.fuel_type),
  );
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

  if (hasDatabaseUrl() && !databaseUnavailable) {
    try {
      dataCache = await loadRegistrationRowsFromDb();
      return dataCache;
    } catch (error) {
      databaseUnavailable = true;
      console.warn(`[data] Neon read failed, falling back to CSV: ${error.message}`);
    }
  }

  dataCache = await readRegistrationsCsv(DATA_FILE);
  return dataCache;
}

async function loadMakerRows() {
  if (makerDataCache) return makerDataCache;

  if (hasDatabaseUrl() && !databaseUnavailable) {
    try {
      makerDataCache = await queryMakerRegistrationRows();
      return makerDataCache;
    } catch (error) {
      console.warn(`[data] Neon maker read failed, falling back to CSV: ${error.message}`);
    }
  }

  const rows = [
    ...(await readMakerRegistrationsCsv(MAKER_DATA_FILE)),
    ...(await readLegacyMakerFuelCsv(LEGACY_MAKER_DATA_FILE)),
  ];
  const merged = new Map();
  for (const row of rows) {
    if (!row.maker) continue;
    merged.set(makerRowIdentity(row), row);
  }
  makerDataCache = [...merged.values()].sort((a, b) =>
    a.year - b.year ||
    a.month - b.month ||
    a.state.localeCompare(b.state) ||
    a.rto.localeCompare(b.rto) ||
    a.maker.localeCompare(b.maker),
  );
  return makerDataCache;
}

function makerRowIdentity(row) {
  return [
    row.year,
    row.month,
    row.state,
    row.rto,
    row.maker,
    row.fuel_filter ?? ALL_FILTER,
    row.vehicle_category_filter ?? ALL_FILTER,
    row.norms_filter ?? ALL_FILTER,
    row.vehicle_class_filter ?? ALL_FILTER,
  ].join("||");
}

async function loadCatalog(rows = []) {
  if (!rtoCatalogCache) {
    const fileCatalog = await loadRtoCatalog(RTO_CATALOG_FILE);
    let rowCatalog = buildRtoCatalogFromRows(rows);
    if (hasDatabaseUrl() && !databaseUnavailable) {
      try {
        rowCatalog = buildRtoCatalogFromRows((await queryRtos()).map((item) => ({ state: item.state, rto: item.rto })));
      } catch (error) {
        databaseUnavailable = true;
        console.warn(`[data] Neon RTO catalog read failed, using CSV catalog: ${error.message}`);
      }
    }
    rtoCatalogCache = mergeRtoCatalogs(fileCatalog, rowCatalog);
  }
  return rtoCatalogCache;
}

function useDatabaseStorage() {
  return hasDatabaseUrl() && !databaseUnavailable;
}

function mergeRtoCatalogs(primary, fallback) {
  const byState = new Map();
  for (const catalog of [fallback, primary]) {
    for (const stateGroup of catalog?.states ?? []) {
      if (!stateGroup.state) continue;
      if (!byState.has(stateGroup.state)) byState.set(stateGroup.state, new Map());
      const rtos = byState.get(stateGroup.state);
      for (const rto of stateGroup.rtos ?? []) {
        if (rto?.label) rtos.set(rto.label, rto);
      }
    }
  }
  return {
    updated_at: primary?.updated_at ?? fallback?.updated_at ?? null,
    states: [...byState.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([state, rtos]) => ({
        state,
        rtos: [...rtos.values()].sort((a, b) => a.label.localeCompare(b.label)),
      })),
  };
}

async function persistScrapedRows(rows) {
  if (!rows.length) return;

  const csvRows = mergeRegistrationRows(await readRegistrationsCsv(DATA_FILE), rows);
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, toRegistrationsCsv(csvRows), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await upsertRegistrationRows(rows);
      databaseUnavailable = false;
    } catch (error) {
      databaseUnavailable = true;
      console.warn(`[persist] Saved scraped rows to CSV, but Neon upsert failed: ${error.message}`);
    }
  }
}

function queueScrapedRowsPersistence(rows) {
  if (!rows.length) return Promise.resolve({ skipped: true, count: 0 });

  const task = persistenceQueue
    .catch(() => {})
    .then(async () => {
      await persistScrapedRows(rows);
      return { skipped: false, count: rows.length };
    });

  persistenceQueue = task.then(() => undefined, () => undefined);

  task.catch((error) => {
    console.error(`[persist] Failed to save scraped rows: ${error.message}`);
  });

  return task;
}

function persistScrapedRowsInBackground(rows) {
  if (!rows.length) return "saved";

  queueScrapedRowsPersistence(rows);

  return "pending";
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseMonthYear(text) {
  const matches = [];
  for (const match of text.matchAll(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?),?\s+(\d{4})\b/gi)) {
    matches.push({
      index: match.index,
      year: Number(match[2]),
      month: MONTHS.get(match[1].toLowerCase()),
    });
  }
  for (const match of text.matchAll(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/g)) {
    matches.push({
      index: match.index,
      year: Number(match[1]),
      month: Number(match[2]),
    });
  }
  for (const match of text.matchAll(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/g)) {
    matches.push({
      index: match.index,
      year: Number(match[2]),
      month: Number(match[1]),
    });
  }
  return matches.sort((a, b) => a.index - b.index).map((match) => ({
    year: match.year,
    month: match.month,
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

function currentMonthKey(date = new Date()) {
  return monthKey(date.getFullYear(), date.getMonth() + 1);
}

function clampFutureDateRange(filters, maxMonth = currentMonthKey()) {
  if (!filters?.from || !filters?.to || filters.to <= maxMonth) return filters;
  if (filters.from > maxMonth) return filters;
  return { ...filters, to: maxMonth, cappedFutureDateRange: true };
}

function applyDefaultDateRange(filters, defaultDateRange = null, { force = false } = {}) {
  if (!defaultDateRange || (!force && (filters?.from || filters?.to))) return filters;
  const from = defaultDateRange.from ?? defaultDateRange.month ?? null;
  const to = defaultDateRange.to ?? defaultDateRange.month ?? from;
  if (!from || !to) return filters;
  return {
    ...filters,
    from,
    to,
    defaultedDateRange: true,
    defaultedDateRangeReason: defaultDateRange.reason ?? "No date was provided, so the daily tracker used its run month",
  };
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

function closestStateAlias(word, maxDistance = 2) {
  const normalizedWord = normalizeLookup(word);
  if (normalizedWord.length < 5) return null;
  return [...STATE_ALIASES.entries()]
    .filter(([alias]) => /^[a-z ]+$/.test(alias))
    .map(([alias, state]) => ({
      alias,
      state,
      distance: editDistanceWithin(normalizedWord, alias, maxDistance),
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || a.alias.length - b.alias.length)[0] ?? null;
}

function findFuzzyCityAlias(text) {
  const words = text.match(/[a-z]+/g) ?? [];
  const singleWordAliases = RTO_ALIASES.filter((item) => /^[a-z]+$/.test(item.alias) && item.alias.length >= 5);

  for (const word of words) {
    if (word.length < 5) continue;
    const stateMatch = closestStateAlias(word, 2);
    const match = singleWordAliases
      .map((item) => ({ item, distance: editDistanceWithin(word, item.alias, 2) }))
      .filter(({ distance }) => distance <= 2)
      .sort((a, b) => a.distance - b.distance || b.item.alias.length - a.item.alias.length)[0];
    if (stateMatch && (!match || stateMatch.distance <= match.distance)) continue;
    if (match) return match.item;
  }

  return null;
}

function hasExplicitRtoIntent(text) {
  return /\b(?:rto|rtos|office|regional\s+transport|transport\s+office)\b/i.test(text);
}

function shouldTreatAliasAsStateOnly(alias, state, text) {
  if (!alias || !state || hasExplicitRtoIntent(text)) return false;
  return normalizeLookup(alias) === normalizeLookup(state);
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
  const fuelMatches = findMatchingFilterDefinitions(text, FUEL_FILTER_ALIASES);
  if (fuelMatches.length) {
    fuelSegment = fuelSegment ?? fuelMatches[0].fuelSegment ?? null;
    fuelType = fuelMatches[0].fuelType ?? fuelType;
  }
  const fuelFilters = fuelFiltersForQuery(text, fuelMatches, fuelType);
  const vehicleCategories = findFilterValues(text, VEHICLE_CATEGORY_ALIASES);
  const norms = findFilterValues(text, NORMS_ALIASES);
  const vehicleClasses = findFilterValues(text, VEHICLE_CLASS_ALIASES);

  let state = null;
  for (const [alias, stateName] of STATE_ALIASES) {
    if (text.includes(alias)) state = stateName;
  }

  let rto = null;
  let locationText = null;
  for (const alias of RTO_ALIASES) {
    if (!text.includes(alias.alias)) continue;
    if (shouldTreatAliasAsStateOnly(alias.alias, alias.state, text)) continue;
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
  const locationSource = locationText && !text.includes(locationText) ? "fuzzy_city" : locationText ? "exact_city" : state ? "state" : null;

  return {
    fuelSegment,
    fuelType,
    fuelFilters,
    vehicleCategories,
    norms,
    vehicleClasses,
    state,
    rto,
    locationText,
    locationSource,
    from: yearRange?.from ?? null,
    to: yearRange?.to ?? null,
    metric: "registrations",
  };
}

function buildSemanticVocabulary(rows = []) {
  return {
    fuelTypes: uniqueLabelValues([
      ...KNOWN_FUEL_TYPES,
      ...FUEL_FILTER_ALIASES.map((item) => item.value),
      ...rows.map((row) => row.fuel_type),
    ]),
    vehicleClasses: uniqueLabelValues([
      ...KNOWN_VEHICLE_CLASSES,
      ...VEHICLE_CLASS_ALIASES.map((item) => item.value),
      ...rows.map((row) => row.vehicle_class_filter).filter((value) => value && value !== ALL_FILTER),
    ]),
    vehicleCategories: uniqueLabelValues([
      ...VEHICLE_CATEGORY_ALIASES.map((item) => item.value),
      ...rows.map((row) => row.vehicle_category_filter).filter((value) => value && value !== ALL_FILTER),
    ]),
    vehicleGroups: uniqueLabelValues(VEHICLE_GROUP_ALIASES.map((item) => item.value)),
    norms: uniqueLabelValues([
      ...NORMS_ALIASES.map((item) => item.value),
      ...rows.map((row) => row.norms_filter).filter((value) => value && value !== ALL_FILTER),
    ]),
  };
}

function exactVocabularyLabels(values, vocabularyLabels) {
  const byKey = new Map((vocabularyLabels ?? []).map((label) => [normalizeLookup(label), label]));
  return uniqueLabelValues((values ?? []).map((value) => byKey.get(normalizeLookup(value))).filter(Boolean));
}

function findVehicleGroups(text, vocabulary) {
  const normalizedText = normalizeLookup(text);
  return exactVocabularyLabels(
    VEHICLE_GROUP_ALIASES
      .filter((definition) => definition.aliases.some((alias) => {
        const normalizedAlias = normalizeLookup(alias);
        return new RegExp(`\\b${normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalizedText);
      }))
      .map((definition) => definition.value),
    vocabulary.vehicleGroups,
  );
}

function semanticFuelSelection(text, vocabulary) {
  const normalized = normalizeLookup(text);
  const exactFuelMatches = findMatchingFilterDefinitions(normalized, FUEL_FILTER_ALIASES)
    .map((definition) => definition.value);

  if (/\b(non[-\s]?ev)\b/i.test(normalized)) return [];
  if (/\b(?:plug[-\s]?in\s+hybrid|phev)\b/i.test(normalized)) return exactVocabularyLabels(["PLUG-IN HYBRID EV"], vocabulary.fuelTypes);
  if (/\bstrong\s+hybrid\b/i.test(normalized)) return exactVocabularyLabels(["STRONG HYBRID EV"], vocabulary.fuelTypes);
  if (/\bhybrid\b/i.test(normalized)) return exactVocabularyLabels(HYBRID_FUELS, vocabulary.fuelTypes);
  if (exactFuelMatches.length) return exactVocabularyLabels(exactFuelMatches, vocabulary.fuelTypes);
  if (/\b(?:ev|electric|battery|bov)\b/i.test(normalized)) return exactVocabularyLabels(BATTERY_ELECTRIC_FUELS, vocabulary.fuelTypes);
  return [];
}

function semanticVehicleClassSelection(text, ruleFilters, vocabulary) {
  const normalized = normalizeLookup(text);
  const selected = [...(ruleFilters.vehicleClasses ?? [])];
  const mentionsErickshaw = /\b(?:e[-\s]?rickshaw|erickshaw)\b/i.test(normalized);
  const mentionsGoods = /\b(?:goods|cargo|cart)\b/i.test(normalized);
  const mentionsPassenger = /\b(?:passenger|passengers|public|people)\b/i.test(normalized);
  const mentionsPrivateFourWheeler = PRIVATE_FOUR_WHEELER_ALIASES.some((alias) => {
    const normalizedAlias = normalizeLookup(alias);
    return new RegExp(`\\b${normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalized);
  });

  if (mentionsPrivateFourWheeler) {
    selected.push(...PRIVATE_FOUR_WHEELER_CLASSES);
  }

  if (mentionsErickshaw && mentionsGoods && !mentionsPassenger) {
    selected.push("E-RICKSHAW WITH CART (G)");
  } else if (mentionsErickshaw && mentionsPassenger && !mentionsGoods) {
    selected.push("E-RICKSHAW(P)");
  } else if (mentionsErickshaw && !mentionsGoods && !mentionsPassenger) {
    selected.push("E-RICKSHAW(P)", "E-RICKSHAW WITH CART (G)");
  }

  return exactVocabularyLabels(selected, vocabulary.vehicleClasses);
}

function semanticPlanFromRules(query, ruleFilters, vocabulary) {
  const selectedFuelTypes = semanticFuelSelection(query, vocabulary);
  const selectedVehicleClasses = semanticVehicleClassSelection(query, ruleFilters, vocabulary);
  const selectedVehicleCategories = exactVocabularyLabels(ruleFilters.vehicleCategories, vocabulary.vehicleCategories);
  const selectedNorms = exactVocabularyLabels(ruleFilters.norms, vocabulary.norms);
  const selectedVehicleGroups = selectedVehicleClasses.length || selectedVehicleCategories.length
    ? []
    : findVehicleGroups(query, vocabulary);
  const selectedParts = [
    selectedFuelTypes.length ? `${selectedFuelTypes.join(", ")} fuel` : null,
    selectedVehicleGroups.length ? `${selectedVehicleGroups.join(", ")} group` : null,
    selectedVehicleClasses.length ? `${selectedVehicleClasses.join(", ")} class` : null,
    selectedVehicleCategories.length ? `${selectedVehicleCategories.join(", ")} category` : null,
  ].filter(Boolean);

  return {
    semanticIntent: selectedParts.length ? `Query matched ${selectedParts.join("; ")}` : null,
    selectedFuelTypes,
    selectedVehicleGroups,
    selectedVehicleClasses,
    selectedVehicleCategories,
    selectedNorms,
    semanticConfidence: selectedParts.length ? 0.78 : null,
    semanticExplanation: selectedParts.length
      ? "Selected exact VAHAN labels from deterministic query rules."
      : null,
  };
}

function normalizeConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return null;
  return Math.max(0, Math.min(1, confidence));
}

function normalizeSemanticPlan(plan, vocabulary) {
  if (!plan) return null;
  return {
    semanticIntent: compact(plan.semanticIntent ?? plan.intent ?? "") || null,
    selectedFuelTypes: exactVocabularyLabels(plan.selectedFuelTypes ?? plan.fuelTypes ?? [], vocabulary.fuelTypes),
    selectedVehicleGroups: exactVocabularyLabels(plan.selectedVehicleGroups ?? plan.vehicleGroups ?? [], vocabulary.vehicleGroups),
    selectedVehicleClasses: exactVocabularyLabels(plan.selectedVehicleClasses ?? plan.vehicleClasses ?? [], vocabulary.vehicleClasses),
    selectedVehicleCategories: exactVocabularyLabels(plan.selectedVehicleCategories ?? plan.vehicleCategories ?? [], vocabulary.vehicleCategories),
    selectedNorms: exactVocabularyLabels(plan.selectedNorms ?? plan.norms ?? [], vocabulary.norms),
    semanticConfidence: normalizeConfidence(plan.semanticConfidence ?? plan.confidence),
    semanticExplanation: compact(plan.semanticExplanation ?? plan.explanation ?? "") || null,
  };
}

function selectedFuelSegment(selectedFuelTypes) {
  if (!selectedFuelTypes?.length) return null;
  const fuelSet = new Set(selectedFuelTypes.map((value) => normalizeLookup(value)));
  const batterySet = new Set(BATTERY_ELECTRIC_FUELS.map((value) => normalizeLookup(value)));
  return [...fuelSet].every((value) => batterySet.has(value)) ? "EV" : null;
}

function allowLlmVehicleClass(query, label) {
  const normalizedQuery = normalizeLookup(query);
  const normalizedLabel = normalizeLookup(label);
  if (normalizedLabel === "motor car") {
    return /\b(?:car|cars|motor car|motor cars)\b/i.test(normalizedQuery);
  }
  return true;
}

function allowLlmVehicleGroup(query, label) {
  const normalizedQuery = normalizeLookup(query);
  const normalizedLabel = normalizeLookup(label);
  const patterns = {
    "two wheeler": /\b(?:two wheeler|two wheelers|2w|2 wheeler|bike|bikes|scooter|scooters|motorcycle|motorcycles)\b/i,
    "three wheeler": /\b(?:three wheeler|three wheelers|3w|3 wheeler|rickshaw|rickshaws|auto rickshaw|auto rickshaws)\b/i,
    "four wheeler": /\b(?:four wheeler|four wheelers|4w|4 wheeler|car|cars|motor car|motor cars)\b/i,
  };
  return patterns[normalizedLabel]?.test(normalizedQuery) ?? true;
}

function combineSemanticPlan(query, ruleFilters, llmFilters, vocabulary) {
  const rulePlan = semanticPlanFromRules(query, ruleFilters, vocabulary);
  const llmPlan = normalizeSemanticPlan(llmFilters, vocabulary);
  const useLlm = llmPlan && (
    llmPlan.selectedFuelTypes.length ||
    llmPlan.selectedVehicleGroups.length ||
    llmPlan.selectedVehicleClasses.length ||
    llmPlan.selectedVehicleCategories.length ||
    llmPlan.selectedNorms.length
  );
  const selectedFuelTypes = uniqueLabelValues([
    ...(useLlm ? llmPlan.selectedFuelTypes : []),
    ...rulePlan.selectedFuelTypes,
  ]);
  const llmVehicleClasses = useLlm
    ? llmPlan.selectedVehicleClasses.filter((label) => allowLlmVehicleClass(query, label))
    : [];
  const selectedVehicleClasses = uniqueLabelValues([
    ...llmVehicleClasses,
    ...rulePlan.selectedVehicleClasses,
  ]);
  const selectedVehicleCategories = rulePlan.selectedVehicleCategories;
  const selectedVehicleGroups = selectedVehicleClasses.length || selectedVehicleCategories.length
    ? []
    : uniqueLabelValues([
      ...(useLlm ? llmPlan.selectedVehicleGroups.filter((label) => allowLlmVehicleGroup(query, label)) : []),
      ...rulePlan.selectedVehicleGroups,
    ]);
  const selectedNorms = uniqueLabelValues([
    ...(useLlm ? llmPlan.selectedNorms : []),
    ...rulePlan.selectedNorms,
  ]);
  const hasSelection = selectedFuelTypes.length || selectedVehicleGroups.length || selectedVehicleClasses.length || selectedVehicleCategories.length || selectedNorms.length;
  if (!hasSelection) return {};

  const baseConfidence = useLlm ? llmPlan.semanticConfidence ?? 0.7 : rulePlan.semanticConfidence ?? 0.65;
  const directScore = [
    selectedFuelTypes.length,
    selectedVehicleGroups.length,
    selectedVehicleClasses.length,
    selectedVehicleCategories.length,
    selectedNorms.length,
  ].filter(Boolean).length * 0.04;
  const semanticConfidence = Math.min(0.98, Math.max(0.35, baseConfidence + directScore));
  return {
    selectedFuelTypes,
    selectedVehicleGroups,
    selectedVehicleClasses,
    selectedVehicleCategories,
    selectedNorms,
    semanticIntent: (useLlm ? llmPlan.semanticIntent : rulePlan.semanticIntent) ?? rulePlan.semanticIntent ?? "VAHAN semantic filter match",
    semanticConfidence,
    semanticExplanation: (useLlm ? llmPlan.semanticExplanation : rulePlan.semanticExplanation) ?? rulePlan.semanticExplanation,
  };
}

function semanticPlannerPrompt(query, vocabulary = buildSemanticVocabulary()) {
  return [
    "Plan exact filters for this Indian VAHAN vehicle registration query.",
    "Correct obvious spelling mistakes in Indian city/state/RTO names before extracting filters.",
    "Examples: bengluru means Bengaluru/Bangalore, gurgao means Gurugram/Gurgaon, mumabi means Mumbai.",
    "Choose only exact labels from the allowed VAHAN label lists below. Do not invent labels.",
    "Plain EV means battery-electric unless the user explicitly says hybrid or plug-in hybrid.",
    "Hybrid means hybrid labels only. Car means MOTOR CAR only when the user directly says car, cars, or motor car.",
    "Do not add MOTOR CAR or any vehicle class for fuel-only queries such as petrol registrations in Delhi.",
    `Broad/private/non-transport four wheeler or 4W means these private vehicle classes unless another exact class is named: ${PRIVATE_FOUR_WHEELER_CLASSES.join(", ")}.`,
    "Only select vehicle category labels when the user directly asks for that category, such as LMV, HMV, transport, non-transport, or light/heavy motor vehicle. Do not infer a vehicle category from a vehicle class.",
    "Return only compact JSON with keys: semanticIntent, selectedFuelTypes, selectedVehicleGroups, selectedVehicleClasses, selectedVehicleCategories, selectedNorms, state, rtoText, locationText, locationType, from, to, metric, semanticConfidence, semanticExplanation.",
    "Use selectedFuelTypes for exact row fuel labels. Use selectedVehicleClasses for exact VAHAN vehicle class labels.",
    "Use selectedVehicleGroups for broad vehicle groups. Do not combine a broad group with child classes in the same answer.",
    "Use official VAHAN-style state names when possible. For city/RTO queries, set state and rtoText to the likely RTO search text.",
    "Use YYYY-MM for dates. Use metric='registrations'. Never invent counts.",
    "If the user names an Indian city/RTO, infer the Indian state only when you are confident. If unsure, use null values and confidence below 0.6.",
    `Allowed fuel labels: ${vocabulary.fuelTypes.join(", ")}`,
    `Allowed vehicle class labels: ${vocabulary.vehicleClasses.join(", ")}`,
    `Allowed vehicle category labels: ${vocabulary.vehicleCategories.join(", ")}`,
    `Allowed vehicle group labels: ${vocabulary.vehicleGroups.join(", ")}`,
    `Allowed norms labels: ${vocabulary.norms.join(", ")}`,
    `Query: ${query}`,
  ].join("\n");
}

function parseJsonFromModelText(text) {
  const match = String(text ?? "").match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

async function decodeWithGemini(query, vocabulary = buildSemanticVocabulary()) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = semanticPlannerPrompt(query, vocabulary);

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
  return parseJsonFromModelText(text);
}

async function decodeWithGroq(query, vocabulary = buildSemanticVocabulary()) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const prompt = semanticPlannerPrompt(query, vocabulary);
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: "Return only compact JSON. Do not include markdown." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Groq decode failed: ${response.status}`);
  const json = await response.json();
  return parseJsonFromModelText(json.choices?.[0]?.message?.content ?? "");
}

async function decodeWithAiProviders(query, vocabulary = buildSemanticVocabulary()) {
  const warnings = [];
  const providers = [
    { name: "Gemini", enabled: Boolean(process.env.GEMINI_API_KEY), decode: () => decodeWithGemini(query, vocabulary) },
    { name: "Groq", enabled: Boolean(process.env.GROQ_API_KEY), decode: () => decodeWithGroq(query, vocabulary) },
  ];

  for (const provider of providers) {
    if (!provider.enabled) continue;
    try {
      const filters = await provider.decode();
      if (filters) return { filters: { ...filters, aiProvider: provider.name }, warnings };
      warnings.push(`${provider.name} returned no filter plan.`);
    } catch (error) {
      warnings.push(error.message);
    }
  }

  return { filters: null, warnings };
}

function normalizeGeminiFilters(filters) {
  if (!filters) return null;
  const confidence = Number(filters.confidence ?? filters.semanticConfidence ?? 1);
  if (Number.isFinite(confidence) && confidence < 0.6) {
    return { decodeWarning: "Gemini could not confidently resolve the location or filters." };
  }
  return {
    ...filters,
    aiProvider: filters.aiProvider ?? null,
    fuelFilters: uniqueSorted(filters.fuelFilters),
    selectedFuelTypes: uniqueSorted(filters.selectedFuelTypes),
    selectedVehicleGroups: uniqueSorted(filters.selectedVehicleGroups),
    selectedVehicleClasses: uniqueSorted(filters.selectedVehicleClasses),
    selectedVehicleCategories: uniqueSorted(filters.selectedVehicleCategories),
    selectedNorms: uniqueSorted(filters.selectedNorms),
    vehicleCategories: uniqueSorted(filters.vehicleCategories),
    norms: uniqueSorted(filters.norms),
    vehicleClasses: uniqueSorted(filters.vehicleClasses),
    rto: filters.rto ?? filters.rtoText ?? null,
    locationText: filters.locationText ?? filters.rtoText ?? null,
    confidence,
  };
}

function mergeFilters(ruleFilters, llmFilters) {
  if (!llmFilters) return ruleFilters;
  const ruleHasLocation = Boolean(ruleFilters.state || ruleFilters.rto || ruleFilters.locationText);
  const ruleHasWeakLocation = ruleFilters.locationSource === "fuzzy_city";
  const preferredRuleLocation = ruleHasLocation && !ruleHasWeakLocation;
  const llmHasLocation = Boolean(llmFilters.state || llmFilters.rto || llmFilters.rtoText || llmFilters.locationText);
  const llmLocationIsOnlyRuleState = Boolean(
    ruleFilters.state &&
      !ruleFilters.rto &&
      !ruleFilters.locationText &&
      [llmFilters.rto, llmFilters.rtoText, llmFilters.locationText].some((value) => isSameStateLocation(value, ruleFilters.state)),
  );
  const fuelType = ruleFilters.fuelType ?? llmFilters.fuelType ?? null;
  const fuelFilters = uniqueSorted([...(ruleFilters.fuelFilters ?? []), ...(llmFilters.fuelFilters ?? [])])
    .filter((value) => !isRedundantFuelFilter(value, fuelType));
  const preferredRto = llmLocationIsOnlyRuleState ? null : llmFilters.rto ?? llmFilters.rtoText ?? null;
  const preferredLocationText = llmLocationIsOnlyRuleState ? null : llmFilters.locationText ?? llmFilters.rtoText ?? null;
  return {
    fuelSegment: ruleFilters.fuelSegment ?? llmFilters.fuelSegment ?? null,
    fuelType,
    fuelFilters,
    vehicleCategories: uniqueSorted([...(ruleFilters.vehicleCategories ?? []), ...(llmFilters.vehicleCategories ?? [])]),
    norms: uniqueSorted([...(ruleFilters.norms ?? []), ...(llmFilters.norms ?? [])]),
    vehicleClasses: uniqueSorted([...(ruleFilters.vehicleClasses ?? []), ...(llmFilters.vehicleClasses ?? [])]),
    state: preferredRuleLocation ? ruleFilters.state ?? llmFilters.state ?? null : llmFilters.state ?? ruleFilters.state ?? null,
    rto: preferredRuleLocation ? ruleFilters.rto ?? preferredRto : preferredRto ?? ruleFilters.rto ?? null,
    locationText: preferredRuleLocation ? ruleFilters.locationText ?? preferredLocationText : preferredLocationText ?? ruleFilters.locationText ?? null,
    locationSource: preferredRuleLocation ? ruleFilters.locationSource : llmHasLocation && !llmLocationIsOnlyRuleState ? "gemini" : ruleFilters.locationSource,
    from: ruleFilters.from ?? llmFilters.from ?? null,
    to: ruleFilters.to ?? llmFilters.to ?? null,
    correctedByGemini: (!ruleHasLocation || ruleHasWeakLocation) && llmHasLocation ? true : undefined,
    metric: "registrations",
  };
}

function resolveRto(filters, rows, catalog = null) {
  if (filters.state) {
    const cleanedFilters = { ...filters };
    let changed = false;
    for (const key of ["rtoText", "locationText"]) {
      if (isSameStateLocation(cleanedFilters[key], filters.state)) {
        cleanedFilters[key] = null;
        changed = true;
      }
    }
    if (filters.aiProvider) {
      for (const key of ["rto", "rtoSearch"]) {
        if (isSameStateLocation(cleanedFilters[key], filters.state)) {
          cleanedFilters[key] = null;
          changed = true;
        }
      }
    }
    if (changed) return resolveRto(cleanedFilters, rows, catalog);
  }

  const rtoNeedle = filters.rto ?? filters.rtoSearch;

  if (catalog) {
    return resolveRtoWithCatalog(filters, catalog, rows);
  }

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
  if (
    !Number.isInteger(fromYear) ||
    !Number.isInteger(fromMonth) ||
    !Number.isInteger(toYear) ||
    !Number.isInteger(toMonth) ||
    fromMonth < 1 ||
    fromMonth > 12 ||
    toMonth < 1 ||
    toMonth > 12 ||
    fromYear * 100 + fromMonth > toYear * 100 + toMonth
  ) {
    return [];
  }
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

function monthKeyToParts(key) {
  const [year, month] = key.split("-").map(Number);
  return { year, month };
}

function addMonths(year, month, offset) {
  const date = new Date(year, month - 1 + offset, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function recentLiveMonthKeys(now = new Date()) {
  const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
  return [0, -1].map((offset) => {
    const value = addMonths(current.year, current.month, offset);
    return monthKey(value.year, value.month);
  });
}

function groupMonthKeys(keys) {
  const groups = new Map();
  for (const key of keys) {
    const { year, month } = monthKeyToParts(key);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(month);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, months]) => ({ year, months: [...new Set(months)].sort((a, b) => a - b) }));
}

function requestedMonthKeys(filters) {
  if (!filters.from || !filters.to) return [];
  return monthsByYear(filters.from, filters.to).flatMap((group) =>
    group.months.map((month) => monthKey(group.year, month)),
  );
}

function refreshMonthsForFilters(filters, rows) {
  if (!filters.from || !filters.to) return [];
  const requested = new Set(requestedMonthKeys(filters));
  const refreshKeys = new Set();

  for (const group of findMissingMonths(filters, rows)) {
    for (const month of group.months) refreshKeys.add(monthKey(group.year, month));
  }

  for (const key of recentLiveMonthKeys()) {
    if (requested.has(key)) refreshKeys.add(key);
  }

  return groupMonthKeys([...refreshKeys]);
}

async function refreshMonthsForFiltersFromDb(filters) {
  if (!filters.from || !filters.to) return [];
  const requested = new Set(requestedMonthKeys(filters));
  const loaded = await completeLoadedMonthKeysFromDb(filters);
  const refreshKeys = new Set();

  for (const key of requested) {
    if (!loaded.has(key)) refreshKeys.add(key);
  }

  for (const key of recentLiveMonthKeys()) {
    if (requested.has(key)) refreshKeys.add(key);
  }

  return groupMonthKeys([...refreshKeys]);
}

async function findMissingMonthsFromDb(filters) {
  if (!filters.from || !filters.to) return [];
  const loaded = await completeLoadedMonthKeysFromDb(filters);
  return monthsByYear(filters.from, filters.to)
    .map((group) => ({
      year: group.year,
      months: group.months.filter((month) => !loaded.has(monthKey(group.year, month))),
    }))
    .filter((group) => group.months.length > 0);
}

async function completeLoadedMonthKeysFromDb(filters) {
  const requiredFuelTypes = new Set((filters.selectedFuelTypes ?? []).map((value) => normalizeLookup(value)));
  if (!requiredFuelTypes.size) {
    return new Set((await queryAvailableMonths(filters)).map((row) => monthKey(row.year, row.month)));
  }
  const fuelsByMonth = new Map();
  for (const row of await queryAvailableMonthFuelTypes(filters)) {
    const key = monthKey(row.year, row.month);
    if (!fuelsByMonth.has(key)) fuelsByMonth.set(key, new Set());
    fuelsByMonth.get(key).add(normalizeLookup(row.fuelType));
  }
  return new Set([...fuelsByMonth.entries()]
    .filter(([, fuels]) => [...requiredFuelTypes].every((fuel) => fuels.has(fuel)))
    .map(([key]) => key));
}

function completeLoadedMonthKeys(filters, rows) {
  const requiredFuelTypes = new Set((filters.selectedFuelTypes ?? []).map((value) => normalizeLookup(value)));
  const stateFilter = filters.state;
  const rtoFilter = filters.rto;
  const rtoSearch = filters.rtoSearch ?? filters.rto;
  const requestedContext = filterContext(filters);
  const loadedKeys = new Set();
  const fuelsByMonth = new Map();

  for (const row of rows) {
    if (stateFilter && row.state !== stateFilter) continue;
    if (rtoFilter && row.rto !== rtoFilter) continue;
    if (!rtoFilter && rtoSearch) {
      if (!row.rto.toLowerCase().includes(String(rtoSearch).toLowerCase())) continue;
    } else if (!rtoFilter && !rtoSearch) {
      if (row.rto !== ALL_RTO) continue;
    }
    if (!rowMatchesContext(row, requestedContext)) continue;
    const key = monthKey(row.year, row.month);
    if (!requiredFuelTypes.size) {
      loadedKeys.add(key);
      continue;
    }
    if (!fuelsByMonth.has(key)) fuelsByMonth.set(key, new Set());
    fuelsByMonth.get(key).add(normalizeLookup(row.fuel_type));
  }

  if (!requiredFuelTypes.size) return loadedKeys;
  return new Set([...fuelsByMonth.entries()]
    .filter(([, fuels]) => [...requiredFuelTypes].every((fuel) => fuels.has(fuel)))
    .map(([key]) => key));
}

// Find which specific year+month combos are missing from the CSV for this location
function findMissingMonths(filters, rows) {
  if (!filters.from || !filters.to) return [];
  const groups = monthsByYear(filters.from, filters.to);

  // Determine which RTO and state to check against
  const stateFilter = filters.state;
  const rtoFilter = filters.rto; // resolved formal RTO name (or null)
  const rtoSearch = filters.rtoSearch ?? filters.rto; // search needle
  const requestedContext = filterContext(filters);

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
    if (!rowMatchesContext(row, requestedContext)) continue;
    loadedKeys.add(`${row.year}-${row.month}`);
  }

  const completeKeys = completeLoadedMonthKeys(filters, rows);

  // Find year-month pairs NOT in CSV
  const missing = [];
  for (const group of groups) {
    const missingMonths = group.months.filter((m) => !completeKeys.has(monthKey(group.year, m)));
    if (missingMonths.length > 0) {
      missing.push({ year: group.year, months: missingMonths });
    }
  }
  return missing;
}

function rowMatchesContext(row, requestedContext) {
  return FILTER_CONTEXT_FIELDS.every((field) => String(row[field] ?? ALL_FILTER) === requestedContext[field]);
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

function extractScrapedRows(stdout = "") {
  const line = stdout
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(SCRAPED_ROWS_MARKER));
  if (!line) return [];

  try {
    const rows = JSON.parse(line.slice(SCRAPED_ROWS_MARKER.length));
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.warn(`[auto-scrape] Could not parse scraped rows: ${error.message}`);
    return [];
  }
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
      "--no-persist",
      "--emit-rows-json",
      "--states", filters.state,
      "--years", String(group.year),
      "--months", group.months.join(","),
    ];
    if (rto) args.push("--rtos", rto);
    if (filters.fuelFilters?.length) args.push("--fuels", filters.fuelFilters.join(","));
    if (filters.vehicleCategories?.length) args.push("--vehicle-categories", filters.vehicleCategories.join(","));
    if (filters.norms?.length) args.push("--norms", filters.norms.join(","));
    if (filters.vehicleClasses?.length) args.push("--vehicle-classes", filters.vehicleClasses.join(","));
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
        rows: extractScrapedRows(result.stdout),
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (error) {
      console.error(`[auto-scrape] Failed for ${group.year}/${group.months}: ${error.message}`);
      runs.push({
        year: group.year,
        months: group.months,
        success: false,
        rows: extractScrapedRows(error.stdout),
        error: error.message,
        stderr: error.stderr,
      });
    }
  }

  return runs;
}

function hasRequestedSideFilterContext(filters = {}) {
  return Boolean(
    filters.fuelFilters?.length ||
    filters.vehicleCategories?.length ||
    filters.norms?.length ||
    filters.vehicleClasses?.length,
  );
}

function aggregateComparisonKey(row) {
  return [
    row.year,
    row.month,
    row.state,
    row.rto,
    row.fuel_segment,
    row.fuel_type,
  ].join("||");
}

function monthTotalComparisonKey(row) {
  return [
    row.year,
    row.month,
    row.state,
    row.rto,
  ].join("||");
}

function totalsByComparisonKey(rows, keyFn) {
  const totals = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    totals.set(key, (totals.get(key) ?? 0) + row.vehicle_count);
  }
  return totals;
}

async function loadUnfilteredRowsForComparison(filters) {
  const aggregateFilters = {
    ...filters,
    fuelFilters: [],
    vehicleCategories: [],
    norms: [],
    vehicleClasses: [],
    selectedVehicleGroups: [],
    selectedVehicleClasses: [],
    selectedVehicleCategories: [],
    selectedNorms: [],
  };

  if (hasDatabaseUrl()) {
    try {
      return await queryRegistrationRows(aggregateFilters);
    } catch (error) {
      console.warn(`[refresh] Neon aggregate comparison failed, falling back to CSV: ${error.message}`);
    }
  }

  return filterRows(await loadRows(), aggregateFilters);
}

async function sideFilterScrapeLooksUnapplied(filters, freshRows) {
  if (!hasRequestedSideFilterContext(filters) || !freshRows.length) return false;
  const aggregateRows = await loadUnfilteredRowsForComparison(filters);
  if (!aggregateRows.length) return false;

  const aggregateCounts = new Map(aggregateRows.map((row) => [aggregateComparisonKey(row), row.vehicle_count]));
  const rowsMatchAggregate = freshRows.every((row) => aggregateCounts.get(aggregateComparisonKey(row)) === row.vehicle_count);
  if (rowsMatchAggregate) return true;

  const freshMonthTotals = totalsByComparisonKey(freshRows, monthTotalComparisonKey);
  const aggregateMonthTotals = totalsByComparisonKey(aggregateRows, monthTotalComparisonKey);
  return freshMonthTotals.size > 0 && [...freshMonthTotals.entries()].every(([key, total]) =>
    aggregateMonthTotals.get(key) === total,
  );
}

async function runScraperForMapFilters(filters, groups) {
  const runs = [];
  for (const group of groups) {
    const args = [
      "scripts/vahan-scraper.mjs",
      "--mode", "scrape",
      "--no-persist",
      "--emit-rows-json",
      "--years", String(group.year),
      "--months", group.months.join(","),
    ];
    if (group.states?.length) args.push("--states", group.states.map(toVahanStateName).join(","));
    if (filters.vehicleCategories?.length) args.push("--vehicle-categories", filters.vehicleCategories.join(","));
    if (filters.norms?.length) args.push("--norms", filters.norms.join(","));
    if (filters.vehicleClasses?.length) args.push("--vehicle-classes", filters.vehicleClasses.join(","));
    console.log(`[map-fetch] all states / ${group.year} months=${group.months.join(",")}`);
    try {
      const result = await execFileAsync(process.execPath, args, {
        cwd: __dirname,
        timeout: 900_000,
        maxBuffer: 1024 * 1024 * 30,
      });
      runs.push({
        year: group.year,
        months: group.months,
        success: true,
        rows: extractScrapedRows(result.stdout),
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (error) {
      runs.push({
        year: group.year,
        months: group.months,
        success: false,
        rows: extractScrapedRows(error.stdout),
        error: error.message,
        stderr: error.stderr,
      });
    }
  }
  return runs;
}

function createMapProgress(groups) {
  const fetchStates = uniqueInOrder(groups.flatMap((group) => group.states?.length ? group.states : orderedMapFetchStates()));
  const states = fetchStates.map((state) => ({
    state,
    status: "pending",
    rowsScraped: 0,
    error: null,
  }));
  return {
    totalStates: states.length,
    completedStates: 0,
    failedStates: 0,
    currentState: null,
    requiredMonths: groups.flatMap((group) => group.months.map((month) => monthKey(group.year, month))),
    states,
  };
}

function updateMapProgressCounts(progress) {
  progress.completedStates = progress.states.filter((item) => item.status === "complete").length;
  progress.failedStates = progress.states.filter((item) => item.status === "failed").length;
}

function markMapProgressState(progress, state, status, details = {}) {
  if (!state) return;
  const item = progress.states.find((entry) => entry.state === normalizeMapStateName(state));
  if (!item) return;
  item.status = status;
  if (details.error !== undefined) item.error = details.error;
  if (details.rowsScraped !== undefined) item.rowsScraped += details.rowsScraped;
  if (status === "running") progress.currentState = item.state;
  else if (progress.currentState === item.state) progress.currentState = null;
  updateMapProgressCounts(progress);
}

function parseMapScraperProgressLine(line) {
  const started = line.match(/^\[(\d+)\/(\d+)\]\s+(\d{4})\s+(.+?)\s+All RTOs\b/);
  if (started) {
    return {
      type: "started",
      index: Number(started[1]),
      total: Number(started[2]),
      year: Number(started[3]),
      state: started[4].trim(),
    };
  }

  const failed = line.match(/^Failed:\s+(\d{4})\s+(.+?)\s+All RTOs:\s+(.+)$/);
  if (failed) {
    return {
      type: "failed",
      year: Number(failed[1]),
      state: failed[2].trim(),
      error: failed[3].trim(),
    };
  }

  return null;
}

async function runScraperForMapFiltersWithProgress(filters, groups, progress, onRunComplete = null) {
  const runs = [];
  for (const group of groups) {
    const args = [
      "scripts/vahan-scraper.mjs",
      "--mode", "scrape",
      "--no-persist",
      "--emit-rows-json",
      "--years", String(group.year),
      "--months", group.months.join(","),
    ];
    if (group.states?.length) args.push("--states", group.states.map(toVahanStateName).join(","));
    if (filters.vehicleCategories?.length) args.push("--vehicle-categories", filters.vehicleCategories.join(","));
    if (filters.norms?.length) args.push("--norms", filters.norms.join(","));
    if (filters.vehicleClasses?.length) args.push("--vehicle-classes", filters.vehicleClasses.join(","));

    const state = group.states?.[0] ?? null;
    console.log(`[map-fetch] ${state ?? "all states"} / ${group.year} months=${group.months.join(",")}`);
    if (state) markMapProgressState(progress, state, "running");

    try {
      const result = await execFileAsync(process.execPath, args, {
        cwd: __dirname,
        timeout: MAP_SCRAPER_GROUP_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024 * 30,
      });
      const rows = extractScrapedRows(result.stdout);
      if (state) markMapProgressState(progress, state, "complete", { rowsScraped: rows.length });
      const run = {
        state,
        year: group.year,
        months: group.months,
        success: true,
        rows,
        stdout: result.stdout,
        stderr: result.stderr,
      };
      runs.push(run);
      onRunComplete?.(run);
    } catch (error) {
      const timedOut = error.killed || /timed out|timeout/i.test(error.message);
      const message = timedOut
        ? `Map scraper timed out after ${Math.round(MAP_SCRAPER_GROUP_TIMEOUT_MS / 1000)}s.`
        : error.message;
      if (state) markMapProgressState(progress, state, "failed", { error: message });
      const run = {
        state,
        year: group.year,
        months: group.months,
        success: false,
        rows: extractScrapedRows(error.stdout),
        error: message,
        stderr: error.stderr,
      };
      runs.push(run);
      onRunComplete?.(run);
    }
  }
  return runs;
}

function filterRows(rows, filters) {
  const requestedContext = filterContext(filters);
  const selectedFuelTypes = new Set((filters.selectedFuelTypes ?? []).map((value) => normalizeLookup(value)));
  return rows.filter((row) => {
    const key = monthKey(row.year, row.month);
    if (filters.from && key < filters.from) return false;
    if (filters.to && key > filters.to) return false;
    if (filters.state && row.state !== filters.state) return false;
    if (filters.rto && row.rto !== filters.rto) return false;
    if (filters.state && !filters.rto && !filters.rtoSearch && row.rto !== ALL_RTO) return false;
    if (selectedFuelTypes.size && !selectedFuelTypes.has(normalizeLookup(row.fuel_type))) return false;
    if (filters.fuelSegment && row.fuel_segment !== filters.fuelSegment) return false;
    if (filters.fuelType && !row.fuel_type.toLowerCase().includes(filters.fuelType.toLowerCase())) return false;
    if (!rowMatchesContext(row, requestedContext)) return false;
    return true;
  });
}

function filterMapRows(rows, filters) {
  const requestedContext = filterContext(filters);
  const shouldApplyFuelFilter = filters.metric !== "ev_share";
  const selectedFuelTypes = new Set((filters.selectedFuelTypes ?? []).map((value) => normalizeLookup(value)));
  return rows.filter((row) => {
    const key = monthKey(row.year, row.month);
    if (filters.from && key < filters.from) return false;
    if (filters.to && key > filters.to) return false;
    if (filters.state && row.state !== filters.state) return false;
    if (filters.rto && row.rto !== filters.rto) return false;
    if (filters.rtoSearch && !row.rto.toLowerCase().includes(String(filters.rtoSearch).toLowerCase())) return false;
    if (shouldApplyFuelFilter && selectedFuelTypes.size && !selectedFuelTypes.has(normalizeLookup(row.fuel_type))) return false;
    if (shouldApplyFuelFilter && filters.fuelSegment && row.fuel_segment !== filters.fuelSegment) return false;
    if (shouldApplyFuelFilter && filters.fuelType && !row.fuel_type.toLowerCase().includes(filters.fuelType.toLowerCase())) return false;
    for (const field of FILTER_CONTEXT_FIELDS) {
      if (requestedContext[field] !== ALL_FILTER && String(row[field] ?? ALL_FILTER) !== requestedContext[field]) return false;
    }
    return true;
  });
}

function hasMapCoverageFor(rows, filters, state, year, month) {
  const requestedContext = filterContext(filters);
  return rows.some((row) =>
    normalizeMapStateName(row.state) === state &&
    row.year === year &&
    row.month === month &&
    row.rto === ALL_RTO &&
    rowMatchesContext(row, requestedContext),
  );
}

function mapRefreshGroupsForFilters(filters, rows) {
  const groups = monthsByYear(filters.from, filters.to);
  const refreshGroups = [];
  for (const group of groups) {
    for (const state of orderedMapFetchStates()) {
      const missingMonths = group.months.filter((month) => !hasMapCoverageFor(rows, filters, state, group.year, month));
      if (missingMonths.length) {
        refreshGroups.push({ year: group.year, months: missingMonths, states: [state] });
      }
    }
  }
  return refreshGroups;
}

function mapSavedStateCount(filters, rows) {
  const groups = monthsByYear(filters.from, filters.to);
  if (!groups.length) return 0;
  return VAHAN_FETCH_STATES.filter((state) =>
    groups.every((group) =>
      group.months.every((month) => hasMapCoverageFor(rows, filters, state, group.year, month)),
    ),
  ).length;
}

function filterRowsIgnoringDate(rows, filters) {
  return filterRows(rows, { ...filters, from: null, to: null });
}

function summarizeScraperRuns(scraperRuns) {
  const failedRuns = scraperRuns.filter((run) => !run.success);
  const rowsScraped = scraperRuns.reduce((count, run) => count + (run.rows?.length ?? 0), 0);
  return {
    autoTriggered: scraperRuns.length > 0,
    success: scraperRuns.length > 0 && failedRuns.length === 0,
    rowsScraped,
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
      rowsScraped: run.rows?.length ?? 0,
    })),
  };
}

function resolveDataStatus({ rows, missingMonths, scraper }) {
  if (
    scraper.autoTriggered &&
    scraper.rowsScraped > 0 &&
    scraper.failedRuns.length === 0 &&
    missingMonths.length === 0
  ) {
    return "live";
  }
  if (scraper.autoTriggered && scraper.failedRuns.length > 0) {
    return rows.length > 0 ? "stale" : "fetch_failed";
  }
  if (missingMonths.length > 0 && rows.length > 0) return "partial";
  if (missingMonths.length > 0) return "missing";
  return "complete";
}

function resolveImmediateDataStatus({ rows, missingMonths, liveRefresh }) {
  if (liveRefresh?.status === "pending") return "refreshing";
  return resolveDataStatus({ rows, missingMonths, scraper: summarizeScraperRuns([]) });
}

function dataReliabilityWarning(status, summary) {
  if (status === "stale") {
    return `Saved rows are being shown because the VAHAN refresh failed. Treat ${summary.total} as a stale snapshot, not the current VAHAN total.`;
  }
  if (status === "partial") {
    return "This answer is missing one or more requested months from the local dataset.";
  }
  return null;
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

function evShare(evTotal, total) {
  return total > 0 ? evTotal / total : null;
}

function mapBaseFilters(url) {
  return queryFiltersFromSearchParams(url.searchParams, { state: null, rto: null, locationText: null });
}

function mapFiltersFromUrl(url) {
  const fallback = { ...mapBaseFilters(url), metric: "ev_share" };
  const query = url.searchParams.get("query");
  return query ? mapFiltersFromQuery(query, fallback) : fallback;
}

function hasExplicitMapLocation(query, filters = {}) {
  const normalizedText = normalizeLookup(query ?? "");
  if (/\b(?:across\s+(?:all\s+)?states|all\s+states|across\s+india|pan\s+india)\b/i.test(normalizedText)) {
    return false;
  }
  if (filters.state) {
    const statePattern = new RegExp(`\\b${normalizeLookup(filters.state).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (statePattern.test(normalizedText)) return true;
    return CITY_DB.some((item) => {
      if (item.state !== filters.state) return false;
      const aliasPattern = new RegExp(`\\b${normalizeLookup(item.alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      return aliasPattern.test(normalizedText);
    });
  }
  return false;
}

function mapAggregateFilters(filters) {
  if (filters.rto || filters.rtoSearch) return filters;
  return { ...filters, rto: ALL_RTO };
}

async function loadMapRows(filters, { rtoScope = "aggregate" } = {}) {
  const queryFilters = rtoScope === "aggregate" ? mapAggregateFilters(filters) : filters;
  if (hasDatabaseUrl()) {
    try {
      return await queryRegistrationRows(queryFilters, {
        stateRtoMode: rtoScope === "all" ? "all" : "aggregate",
      });
    } catch (error) {
      console.warn(`[map] Neon read failed, falling back to CSV: ${error.message}`);
    }
  }
  return filterMapRows(await loadRows(), queryFilters);
}

function mapSummaryPayload(rows, filters, liveRefresh = null) {
  const resultRows = filterMapRows(rows, filters);
  const states = summarizeMapStateRows(resultRows);
  return {
    filters,
    states,
    coverage: {
      availableStates: states.filter((item) => item.rowCount > 0).length,
      totalStates: states.length,
      rowCount: resultRows.length,
      latestMonth: freshness(rows).latestMonth,
    },
    liveRefresh,
  };
}

function mapRefreshInfo(job) {
  return {
    jobId: job.id,
    status: job.status,
    requiredMonths: job.requiredMonths,
    error: job.error ?? null,
    savedStateCount: job.savedStateCount ?? null,
    fetchStateCount: job.progress?.totalStates ?? null,
    progress: job.progress,
    persistence: {
      saves: job.saveStatuses.map((save) => ({
        state: save.state,
        year: save.year,
        months: save.months,
        status: save.status,
        rowsSaved: save.rowsSaved ?? 0,
        error: save.error ?? null,
      })),
    },
    scraper: {
      runs: job.runs.map((run) => ({
        state: run.state ?? null,
        year: run.year,
        months: run.months,
        success: run.success,
        rowsScraped: run.rows?.length ?? 0,
        error: run.error ?? null,
      })),
    },
  };
}

function mapSavedRefreshInfo(groups) {
  const progress = createMapProgress(groups.map((group) => ({ ...group, states: VAHAN_FETCH_STATES })));
  for (const state of progress.states) state.status = "complete";
  updateMapProgressCounts(progress);
  return {
    jobId: null,
    status: "complete",
    source: "saved",
    requiredMonths: groups.flatMap((group) => group.months.map((month) => monthKey(group.year, month))),
    error: null,
    savedStateCount: VAHAN_FETCH_STATES.length,
    fetchStateCount: 0,
    progress,
    scraper: { runs: [] },
  };
}

function mapFiltersFromQuery(query, fallback = {}) {
  const ruleFilters = decodeWithRules(query ?? "");
  const isEvShareQuery = /\b(?:ev|electric)\s+share\b/i.test(query ?? "") ||
    /\bshare\b.*\b(?:ev|electric)\b/i.test(query ?? "");
  const hasLocation = hasExplicitMapLocation(query, ruleFilters);
  return {
    ...fallback,
    metric: isEvShareQuery ? "ev_share" : "registrations",
    fuelSegment: isEvShareQuery ? null : ruleFilters.fuelSegment ?? fallback.fuelSegment ?? null,
    fuelType: isEvShareQuery ? null : ruleFilters.fuelType ?? fallback.fuelType ?? null,
    fuelFilters: isEvShareQuery
      ? []
      : ruleFilters.fuelFilters?.length ? ruleFilters.fuelFilters : fallback.fuelFilters ?? [],
    state: hasLocation ? ruleFilters.state ?? fallback.state ?? null : fallback.state ?? null,
    rto: hasLocation ? ruleFilters.rto ?? fallback.rto ?? null : fallback.rto ?? null,
    locationText: hasLocation ? ruleFilters.locationText ?? fallback.locationText ?? null : fallback.locationText ?? null,
    from: ruleFilters.from ?? fallback.from ?? null,
    to: ruleFilters.to ?? fallback.to ?? null,
    vehicleCategories: ruleFilters.vehicleCategories?.length ? ruleFilters.vehicleCategories : fallback.vehicleCategories ?? [],
    norms: ruleFilters.norms?.length ? ruleFilters.norms : fallback.norms ?? [],
    vehicleClasses: ruleFilters.vehicleClasses?.length ? ruleFilters.vehicleClasses : fallback.vehicleClasses ?? [],
  };
}

function startMapRefreshJob({ filters, baseRows, groups, savedStateCount = null }) {
  cleanupRefreshJobs();
  const id = String(nextRefreshJobId++);
  const job = {
    id,
    status: "pending",
    filters,
    groups,
    baseRows,
    liveRows: [],
    requiredMonths: groups.flatMap((group) => group.months.map((month) => monthKey(group.year, month))),
    runs: [],
    saveStatuses: [],
    saveTasks: [],
    savedStateCount,
    progress: createMapProgress(groups),
    error: null,
    payload: null,
    createdAt: Date.now(),
  };
  mapRefreshJobs.set(id, job);

  job.promise = (async () => {
    try {
      const runs = await runScraperForMapFiltersWithProgress(filters, groups, job.progress, (run) => {
        job.runs.push(run);
        if (run.rows?.length) {
          job.liveRows = mergeRegistrationRows(job.liveRows, run.rows);
        }
        const save = {
          state: run.state ?? null,
          year: run.year,
          months: run.months,
          status: run.rows?.length ? "pending" : "skipped",
          rowsSaved: 0,
          error: null,
        };
        job.saveStatuses.push(save);
        if (run.rows?.length) {
          const saveTask = queueScrapedRowsPersistence(run.rows)
            .then((result) => {
              save.status = result.skipped ? "skipped" : "saved";
              save.rowsSaved = result.count ?? 0;
            })
            .catch((error) => {
              save.status = "failed";
              save.error = error.message;
            });
          job.saveTasks.push(saveTask);
        }
      });
      const freshRows = runs.flatMap((run) => run.rows ?? []);
      if (freshRows.length) {
        if (hasDatabaseUrl()) {
          dataCache = null;
        } else {
          dataCache = mergeRegistrationRows(await loadRows(), freshRows);
        }
      }
      await Promise.allSettled(job.saveTasks);
      const combinedRows = mergeRegistrationRows(baseRows, freshRows);
      job.status = runs.some((run) => !run.success) ? "failed" : "complete";
      job.error = job.status === "failed" ? runs.find((run) => !run.success)?.error ?? "One or more VAHAN scrape runs failed." : null;
      if (job.status === "failed") {
        const failedRuns = runs.filter((run) => !run.success);
        notifyTelegramAlert([
          "Map refresh failed.",
          `Scope: ${describeFilters(filters)}`,
          `Failed states: ${failedRuns.length}`,
          failedRuns[0]?.state ? `First failed: ${failedRuns[0].state}` : null,
          job.error,
        ].filter(Boolean).join("\n"));
      } else {
        void checkTelegramBigChangeAlerts(filters).catch((error) => console.warn(`[telegram] big-change alert failed: ${error.message}`));
      }
      job.payload = mapSummaryPayload(combinedRows, filters, mapRefreshInfo(job));
    } catch (error) {
      await Promise.allSettled(job.saveTasks);
      job.status = "failed";
      job.error = error.message;
      notifyTelegramAlert([
        "Map refresh failed.",
        `Scope: ${describeFilters(filters)}`,
        error.message,
      ].join("\n"));
      job.payload = mapSummaryPayload(mapRefreshDisplayRows(job), filters, mapRefreshInfo(job));
    }
  })();

  return job;
}

function mapRefreshDisplayRows(job) {
  return mergeRegistrationRows(job.baseRows, job.liveRows);
}

function summarizeMapStateRows(rows) {
  const byState = new Map();
  for (const state of INDIA_STATES) {
    byState.set(state, {
      state,
      total: 0,
      evTotal: 0,
      evShare: null,
      rowCount: 0,
      rtoCount: 0,
      hasRtoData: false,
    });
  }

  for (const row of rows) {
    const stateName = normalizeMapStateName(row.state);
    if (!byState.has(stateName)) {
      byState.set(stateName, {
        state: stateName,
        total: 0,
        evTotal: 0,
        evShare: null,
        rowCount: 0,
        rtoCount: 0,
        hasRtoData: false,
      });
    }
    const item = byState.get(stateName);
    item.total += row.vehicle_count;
    if (row.fuel_segment === "EV") item.evTotal += row.vehicle_count;
    item.rowCount += 1;
    if (!item.rtos) item.rtos = new Set();
    if (row.rto && row.rto !== ALL_RTO) item.rtos.add(row.rto);
  }

  return [...byState.values()]
    .map((item) => ({
      state: item.state,
      total: item.total,
      evTotal: item.evTotal,
      evShare: evShare(item.evTotal, item.total),
      rowCount: item.rowCount,
      rtoCount: item.rtos?.size ?? 0,
      hasRtoData: Boolean(item.rtos?.size),
    }))
    .sort((a, b) => a.state.localeCompare(b.state));
}

function summarizeMapRtoRows(rows) {
  const byRto = new Map();
  for (const row of rows) {
    if (row.rto === ALL_RTO) continue;
    if (!byRto.has(row.rto)) {
      byRto.set(row.rto, {
        rto: row.rto,
        total: 0,
        evTotal: 0,
        rowCount: 0,
        months: new Set(),
        fuels: new Map(),
      });
    }
    const item = byRto.get(row.rto);
    item.total += row.vehicle_count;
    if (row.fuel_segment === "EV") item.evTotal += row.vehicle_count;
    item.rowCount += 1;
    item.months.add(monthKey(row.year, row.month));
    item.fuels.set(row.fuel_type, (item.fuels.get(row.fuel_type) ?? 0) + row.vehicle_count);
  }

  return [...byRto.values()]
    .map((item) => ({
      rto: item.rto,
      total: item.total,
      evTotal: item.evTotal,
      evShare: evShare(item.evTotal, item.total),
      rowCount: item.rowCount,
      months: [...item.months].sort(),
      topFuels: [...item.fuels.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([fuelType, count]) => ({ fuelType, count })),
    }))
    .sort((a, b) => b.evShare - a.evShare || b.evTotal - a.evTotal || a.rto.localeCompare(b.rto));
}

function freshness(rows) {
  const latest = rows
    .map((row) => monthKey(row.year, row.month))
    .sort((a, b) => b.localeCompare(a))[0] ?? null;
  return { latestMonth: latest, source: SOURCE_LABEL };
}

async function freshnessFromDb() {
  const stats = await queryRegistrationFreshness();
  return { latestMonth: stats.latestMonth, source: SOURCE_LABEL, rowCount: stats.rowCount };
}

function dashboardPayload({
  filters,
  rows,
  scraperRuns = [],
  missingMonths,
  llmFilters,
  persistenceStatus = "saved",
  liveRefresh = null,
  preFiltered = false,
  freshnessInfo = null,
}) {
  const scraper = summarizeScraperRuns(scraperRuns);
  const resultRows = filters.ambiguousRtos ? [] : preFiltered ? rows : filterRows(rows, filters);
  const status = liveRefresh?.status === "pending"
    ? resolveImmediateDataStatus({ rows: resultRows, missingMonths, liveRefresh })
    : resolveDataStatus({ rows: resultRows, missingMonths, scraper });
  const summary = summarize(resultRows);

  return {
    filters,
    dataStatus: status,
    persistenceStatus,
    summary: {
      total: summary.total,
      monthlyAverage: summary.monthlyAverage,
      peakMonth: summary.peakMonth,
      peakMonthCount: summary.peakMonthCount,
    },
    trend: summary.trend,
    fuelBreakdown: summary.fuelBreakdown,
    rows: resultRows,
    freshness: freshnessInfo ?? freshness(rows),
    scraper,
    liveRefresh,
    warnings: [
      llmFilters?.decodeWarning,
      liveRefresh?.status === "pending" ? `Fetching ${liveRefresh.requiredMonths.length} missing/latest month${liveRefresh.requiredMonths.length === 1 ? "" : "s"} from VAHAN. Saved data is shown now and will update automatically.` : null,
      liveRefresh?.status === "failed" ? "Live VAHAN refresh failed. Results may still be incomplete." : null,
      scraper.failedRuns.length
        ? "Live VAHAN fetch failed for this query. Results may be missing or stale."
        : null,
      persistenceStatus === "pending" ? "Fresh VAHAN data is displayed now and is being saved in the background." : null,
      status === "stale" ? "Showing last known matching local data because the live fetch failed." : null,
      dataReliabilityWarning(status, summary),
      status === "partial" ? "Some requested months are missing from local data." : null,
      filters.semanticConfidence !== null && filters.semanticConfidence !== undefined && filters.semanticConfidence < 0.75
        ? "Semantic filter confidence is medium/low. Review the interpreted filters before using the result."
        : null,
      filters.selectedVehicleGroups?.length
        ? `Interpreted broad vehicle group: ${filters.selectedVehicleGroups.join(", ")}. Current saved/filter path does not yet apply VAHAN category-group selectors, so use this as interpretation metadata until group fetching is added.`
        : null,
      filters.cappedFutureDateRange ? `Date range was capped at ${filters.to} because future VAHAN months are not available yet.` : null,
      filters.defaultedDateRange ? `${filters.defaultedDateRangeReason} (${filters.from} to ${filters.to}).` : null,
      filters.correctedByGemini ? `${filters.aiProvider ?? "AI"} helped interpret the location or filters; counts still come only from VAHAN data.` : null,
      filters.rtoResolution?.status === "resolved" && filters.rtoResolution.query
        ? `Resolved ${filters.rtoResolution.query} to ${filters.rtoResolution.rto} using the VAHAN RTO catalog.`
        : null,
      filters.unresolvedLocation ? `Could not resolve location "${filters.unresolvedLocation}" from loaded data.` : null,
      filters.ambiguousRtos ? "Location matched multiple RTOs. Choose one." : null,
    ].filter(Boolean),
  };
}

function liveRefreshInfo(job) {
  return {
    jobId: job.id,
    status: job.status,
    requiredMonths: job.requiredMonths,
    error: job.error ?? null,
  };
}

function startLiveRefreshJob({ filters, baseRows, refreshGroups, llmFilters }) {
  cleanupRefreshJobs();
  const id = String(nextRefreshJobId++);
  const job = {
    id,
    status: "pending",
    filters,
    baseRows,
    refreshGroups,
    requiredMonths: refreshGroups.flatMap((group) => group.months.map((month) => monthKey(group.year, month))),
    llmFilters,
    scraperRuns: [],
    freshRows: [],
    persistenceStatus: "saved",
    error: null,
    payload: null,
    createdAt: Date.now(),
  };
  refreshJobs.set(id, job);

  job.promise = (async () => {
    try {
      const runs = await runScraperForFilters(filters, refreshGroups);
      const freshRows = runs.flatMap((run) => run.rows ?? []);
      job.scraperRuns = runs;
      job.freshRows = freshRows;

      if (await sideFilterScrapeLooksUnapplied(filters, freshRows)) {
        throw new Error("VAHAN returned the same rows as the unfiltered report; side filters were not applied, so the scrape was rejected.");
      }

      if (freshRows.length > 0) {
        if (hasDatabaseUrl()) {
          dataCache = null;
        } else {
          const currentRows = await loadRows();
          dataCache = mergeRegistrationRows(currentRows, freshRows);
        }
        job.persistenceStatus = persistScrapedRowsInBackground(freshRows);
      }

      const combinedRows = mergeRegistrationRows(baseRows, freshRows);
      const missingMonths = findMissingMonths(filters, combinedRows);
      job.status = runs.some((run) => !run.success) ? "failed" : "complete";
      if (job.status === "failed") {
        notifyTelegramAlert([
          "Query refresh failed.",
          `Scope: ${describeFilters(filters)}`,
          runs.find((run) => !run.success)?.error ?? "One or more VAHAN scraper runs failed.",
        ].join("\n"));
      }
      job.payload = dashboardPayload({
        filters,
        rows: combinedRows,
        scraperRuns: runs,
        missingMonths,
        llmFilters,
        persistenceStatus: job.persistenceStatus,
        liveRefresh: liveRefreshInfo(job),
        preFiltered: false,
        freshnessInfo: hasDatabaseUrl() ? await freshnessFromDb().catch(() => null) : null,
      });
    } catch (error) {
      job.status = "failed";
      job.error = error.message;
      notifyTelegramAlert([
        "Query refresh failed.",
        `Scope: ${describeFilters(filters)}`,
        error.message,
      ].join("\n"));
      job.payload = dashboardPayload({
        filters,
        rows: baseRows,
        scraperRuns: job.scraperRuns,
        missingMonths: findMissingMonths(filters, baseRows),
        llmFilters,
        liveRefresh: liveRefreshInfo(job),
        preFiltered: false,
        freshnessInfo: hasDatabaseUrl() ? await freshnessFromDb().catch(() => null) : null,
      });
      console.error(`[refresh:${id}] ${error.message}`);
    }
  })();

  return job;
}

export async function queryData(input) {
  const query = String(input.query ?? "").trim();
  if (!query) {
    const error = new Error("Enter a query before running the dashboard.");
    error.statusCode = 400;
    throw error;
  }

  let rows = await loadRows();
  const useDatabase = useDatabaseStorage();
  const semanticVocabulary = buildSemanticVocabulary(rows);
  const catalog = await loadCatalog(rows);
  const ruleFilters = decodeWithRules(query);
  let llmFilters = null;
  if (process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY) {
    const aiDecode = await decodeWithAiProviders(query, semanticVocabulary);
    llmFilters = normalizeGeminiFilters(aiDecode.filters);
    if (aiDecode.warnings.length) {
      const recoveredBy = llmFilters?.aiProvider ? `${llmFilters.aiProvider} used successfully after fallback.` : null;
      llmFilters = {
        ...(llmFilters ?? {}),
        decodeWarning: [...aiDecode.warnings, recoveredBy].filter(Boolean).join("; "),
      };
    }
  }
  const semanticPlan = combineSemanticPlan(query, ruleFilters, llmFilters, semanticVocabulary);
  const mergedFilters = {
    ...mergeFilters(ruleFilters, llmFilters),
    ...semanticPlan,
  };
  if (semanticPlan.selectedFuelTypes?.length) {
    const exactFuelType = semanticPlan.selectedFuelTypes.length === 1 ? semanticPlan.selectedFuelTypes[0] : null;
    if (!exactFuelType || !mergedFilters.fuelType || !normalizeLookup(exactFuelType).includes(normalizeLookup(mergedFilters.fuelType))) {
      mergedFilters.fuelType = null;
    }
    const semanticSegment = selectedFuelSegment(semanticPlan.selectedFuelTypes);
    if (semanticSegment) {
      mergedFilters.fuelSegment = semanticSegment;
    } else if (mergedFilters.fuelSegment === "EV") {
      mergedFilters.fuelSegment = null;
    }
  }
  if ("selectedVehicleCategories" in semanticPlan) mergedFilters.vehicleCategories = semanticPlan.selectedVehicleCategories ?? [];
  if (semanticPlan.selectedVehicleGroups?.length) mergedFilters.selectedVehicleGroups = semanticPlan.selectedVehicleGroups;
  if (semanticPlan.selectedVehicleClasses?.length) mergedFilters.vehicleClasses = semanticPlan.selectedVehicleClasses;
  if (semanticPlan.selectedNorms?.length) mergedFilters.norms = semanticPlan.selectedNorms;
  const shouldUseDefaultDateRange = Boolean(input.defaultDateRange && !ruleFilters.from && !ruleFilters.to);
  let filters = resolveRto(
    clampFutureDateRange(applyDefaultDateRange(mergedFilters, input.defaultDateRange, { force: shouldUseDefaultDateRange })),
    rows,
    catalog,
  );
  let immediateRows = rows;
  if (useDatabase && !filters.ambiguousRtos) {
    try {
      immediateRows = await queryRegistrationRows(filters);
    } catch (error) {
      databaseUnavailable = true;
      rows = await readRegistrationsCsv(DATA_FILE);
      dataCache = rows;
      immediateRows = rows;
      console.warn(`[data] Neon query failed, using CSV rows: ${error.message}`);
    }
  }
  const queryUsesDatabase = useDatabaseStorage();
  const missingMonths = hasRequiredScrapeFilters(filters) && !filters.ambiguousRtos && !filters.unresolvedLocation
    ? queryUsesDatabase
      ? await findMissingMonthsFromDb(filters)
      : findMissingMonths(filters, rows)
    : [];
  const refreshGroups = !LIVE_REFRESH_DISABLED && hasRequiredScrapeFilters(filters) && !filters.ambiguousRtos && !filters.unresolvedLocation
    ? queryUsesDatabase
      ? await refreshMonthsForFiltersFromDb(filters)
      : refreshMonthsForFilters(filters, rows)
    : [];
  const liveRefreshJob = refreshGroups.length
    ? startLiveRefreshJob({ filters, baseRows: immediateRows, refreshGroups, llmFilters })
    : null;

  return dashboardPayload({
    filters,
    rows: immediateRows,
    missingMonths,
    llmFilters,
    liveRefresh: liveRefreshJob ? liveRefreshInfo(liveRefreshJob) : null,
    preFiltered: queryUsesDatabase,
    freshnessInfo: queryUsesDatabase ? await freshnessFromDb().catch(() => null) : null,
  });
}

export async function waitForQueryRefresh(jobId, { timeoutMs = 300_000, pollMs = 1000 } = {}) {
  const job = refreshJobs.get(String(jobId));
  if (!job) {
    const error = new Error("Refresh job not found");
    error.statusCode = 404;
    throw error;
  }

  const started = Date.now();
  while (job.status === "pending" || !job.payload) {
    if (Date.now() - started > timeoutMs) {
      const error = new Error(`Timed out waiting for refresh job ${jobId}`);
      error.statusCode = 504;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return job.payload ?? { liveRefresh: liveRefreshInfo(job) };
}

function telegramNumber(value) {
  return new Intl.NumberFormat("en-IN").format(Math.round(Number(value) || 0));
}

function telegramPercent(value) {
  return value === null || value === undefined
    ? "No data"
    : `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value * 100)}%`;
}

function telegramPoints(value) {
  if (value === null || value === undefined) return "No data";
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value * 100)} pts`;
}

function previousMonthKey(value) {
  const [year, month] = String(value ?? "").split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isTelegramSummaryState(state) {
  return TELEGRAM_SUMMARY_STATE_SET.has(normalizeMapStateName(state));
}

function telegramSummaryCoverage(rows) {
  const states = new Set();
  let rowCount = 0;
  for (const row of rows) {
    const state = normalizeMapStateName(row.state);
    if (!TELEGRAM_SUMMARY_STATE_SET.has(state)) continue;
    states.add(state);
    rowCount += 1;
  }
  return {
    availableStates: states.size,
    totalStates: TELEGRAM_SUMMARY_STATES.length,
    rowCount,
  };
}

function describeFilters(filters = {}) {
  return [
    filters.state,
    filters.rto && filters.rto !== ALL_RTO ? filters.rto : null,
    filters.from && filters.to ? `${filters.from} to ${filters.to}` : filters.from ?? filters.to,
  ].filter(Boolean).join(", ") || "All saved data";
}

function formatDashboardTelegramResult(data, query) {
  const total = data.summary?.total ?? 0;
  const evTotal = data.rows?.reduce((sum, row) => sum + (row.fuel_segment === "EV" ? row.vehicle_count : 0), 0) ?? 0;
  const share = evShare(evTotal, total);
  const topFuels = (data.fuelBreakdown ?? [])
    .slice(0, 4)
    .map((fuel) => `${fuel.fuelType}: ${telegramNumber(fuel.count)}`)
    .join("\n");
  const warnings = (data.warnings ?? []).slice(0, 3).map((warning) => `- ${warning}`).join("\n");
  return [
    "Query Result",
    query ? `Query: ${query}` : null,
    `Scope: ${describeFilters(data.filters)}`,
    `Total registrations: ${telegramNumber(total)}`,
    `EV registrations: ${telegramNumber(evTotal)}`,
    `EV share: ${telegramPercent(share)}`,
    data.summary?.peakMonth ? `Peak month: ${data.summary.peakMonth} (${telegramNumber(data.summary.peakMonthCount)})` : null,
    topFuels ? `Top fuels:\n${topFuels}` : null,
    warnings ? `Warnings:\n${warnings}` : null,
    data.liveRefresh?.status === "pending" ? `Refresh job running: ${data.liveRefresh.jobId}` : null,
  ].filter(Boolean).join("\n");
}

function sortStatesByEvShare(states) {
  return states
    .filter((item) => item.rowCount > 0 && item.evShare !== null)
    .sort((a, b) => b.evShare - a.evShare || b.evTotal - a.evTotal || a.state.localeCompare(b.state));
}

function formatMapTopStates(data, limit = 5) {
  const top = sortStatesByEvShare(data.states).slice(0, limit);
  const rows = top.map((item, index) =>
    `${index + 1}. ${item.state}: ${telegramPercent(item.evShare)} (${telegramNumber(item.evTotal)} EV / ${telegramNumber(item.total)})`,
  );
  return [
    "Top EV States",
    `Scope: ${describeFilters(data.filters)}`,
    data.coverage ? `Coverage: ${data.coverage.availableStates}/${data.coverage.totalStates} states, ${telegramNumber(data.coverage.rowCount)} rows` : null,
    rows.join("\n") || "No saved state data found for this request.",
  ].filter(Boolean).join("\n");
}

function formatMapStateDetail(data, state) {
  const item = data.states.find((entry) => entry.state === state) ??
    data.states.find((entry) => normalizeLookup(entry.state) === normalizeLookup(state));
  if (!item || item.rowCount === 0) return `No saved map data found for ${state}.`;
  return [
    "State Map Result",
    `${item.state}: ${telegramPercent(item.evShare)} EV share`,
    `EV registrations: ${telegramNumber(item.evTotal)}`,
    `Total registrations: ${telegramNumber(item.total)}`,
    `Saved RTOs: ${telegramNumber(item.rtoCount)}`,
    `Scope: ${describeFilters(data.filters)}`,
  ].join("\n");
}

function findStatesInText(text) {
  const normalized = normalizeLookup(text);
  return INDIA_STATES.filter((state) => normalized.includes(normalizeLookup(state)));
}

function formatMapComparison(data, states) {
  const [leftState, rightState] = states;
  const left = data.states.find((item) => item.state === leftState);
  const right = data.states.find((item) => item.state === rightState);
  if (!left?.rowCount || !right?.rowCount) return `Could not compare ${leftState} and ${rightState}; one side has no saved data.`;
  const delta = left.evShare - right.evShare;
  return [
    "Map Comparison",
    `Scope: ${describeFilters(data.filters)}`,
    `${left.state}: ${telegramPercent(left.evShare)}`,
    `${right.state}: ${telegramPercent(right.evShare)}`,
    `Difference: ${telegramPoints(delta)}`,
    `Higher EV share: ${delta >= 0 ? left.state : right.state}`,
  ].join("\n");
}

async function telegramMapDataForText(text) {
  const filters = mapFiltersFromQuery(text, { metric: "ev_share" });
  const rows = await loadMapRows(filters);
  return mapSummaryPayload(rows, filters);
}

async function handleTelegramQuery(text) {
  const data = await queryData({ query: text });
  return formatDashboardTelegramResult(data, text);
}

async function handleTelegramMap(text) {
  const data = await telegramMapDataForText(text);
  const states = findStatesInText(text);
  if (/\bcompare\b|\bvs\b|\bversus\b/i.test(text) && states.length >= 2) {
    return formatMapComparison(data, states.slice(0, 2));
  }
  if (states.length === 1 && !/\btop\b|\bbest\b|\brank/i.test(text)) {
    return formatMapStateDetail(data, states[0]);
  }
  return formatMapTopStates(data);
}

function telegramSummaryFetchStateCount(groups) {
  return new Set(groups.flatMap((group) => group.states ?? [])).size;
}

async function fetchMissingTelegramSummaryRows(filters, rows, onFetchStart = null) {
  const refreshGroups = mapRefreshGroupsForFilters(filters, rows);
  if (!refreshGroups.length) {
    return { rows, refreshGroups, runs: [], fetchedRows: 0, failedRuns: [] };
  }

  if (onFetchStart) {
    try {
      await onFetchStart({ filters, refreshGroups });
    } catch (error) {
      console.warn(`[telegram] summary fetch notice failed: ${error.message}`);
    }
  }

  const progress = createMapProgress(refreshGroups);
  const saveTasks = [];
  const runs = await runScraperForMapFiltersWithProgress(filters, refreshGroups, progress, (run) => {
    if (run.rows?.length) saveTasks.push(queueScrapedRowsPersistence(run.rows));
  });
  await Promise.allSettled(saveTasks);

  const freshRows = runs.flatMap((run) => run.rows ?? []);
  if (freshRows.length) {
    if (hasDatabaseUrl()) {
      dataCache = null;
    } else {
      dataCache = mergeRegistrationRows(await loadRows(), freshRows);
    }
  }

  return {
    rows: mergeRegistrationRows(rows, freshRows),
    refreshGroups,
    runs,
    fetchedRows: freshRows.length,
    failedRuns: runs.filter((run) => !run.success),
  };
}

async function buildTelegramSummary({
  label = "Latest",
  fetchMissing = TELEGRAM_SUMMARY_FETCH_MISSING,
  onFetchStart = null,
} = {}) {
  const freshnessInfo = hasDatabaseUrl() ? await freshnessFromDb().catch(() => null) : freshness(await loadRows());
  const latestMonth = freshnessInfo?.latestMonth;
  if (!latestMonth) return "No saved VAHAN data is available yet.";
  const filters = { from: latestMonth, to: latestMonth, metric: "ev_share" };
  const initialRows = await loadMapRows(filters);
  const refresh = fetchMissing
    ? await fetchMissingTelegramSummaryRows(filters, initialRows, onFetchStart)
    : { rows: initialRows, refreshGroups: [], runs: [], fetchedRows: 0, failedRuns: [] };
  const resultRows = filterMapRows(refresh.rows, filters);
  const data = mapSummaryPayload(refresh.rows, filters);
  const summaryStates = data.states.filter((item) => isTelegramSummaryState(item.state));
  const coverage = telegramSummaryCoverage(resultRows);
  const ranked = sortStatesByEvShare(summaryStates);
  const bottom = [...ranked].reverse().slice(0, 5);
  const missing = summaryStates.filter((item) => item.rowCount === 0).map((item) => item.state);
  const topRows = ranked.slice(0, 5).map((item, index) => `${index + 1}. ${item.state}: ${telegramPercent(item.evShare)}`).join("\n");
  const bottomRows = bottom.map((item, index) => `${index + 1}. ${item.state}: ${telegramPercent(item.evShare)}`).join("\n");
  const fetchedStateCount = telegramSummaryFetchStateCount(refresh.refreshGroups);
  const fetchLine = refresh.refreshGroups.length
    ? `Fetch attempted: ${telegramNumber(fetchedStateCount)} missing states, ${telegramNumber(refresh.fetchedRows)} rows fetched${refresh.failedRuns.length ? `, ${telegramNumber(refresh.failedRuns.length)} failed` : ""}.`
    : !fetchMissing && coverage.availableStates < coverage.totalStates
      ? "Fetch skipped for missing states."
      : null;
  return [
    `${label} EV Summary`,
    `Month: ${latestMonth}`,
    fetchLine,
    `Coverage: ${coverage.availableStates}/${coverage.totalStates} states, ${telegramNumber(coverage.rowCount)} rows`,
    topRows ? `Top EV share:\n${topRows}` : null,
    bottomRows ? `Lowest EV share:\n${bottomRows}` : null,
    missing.length ? `Missing states: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ` +${missing.length - 8} more` : ""}` : "Missing states: none",
  ].filter(Boolean).join("\n");
}

async function sendTelegramAlert(text) {
  if (!telegramBot) return;
  await telegramBot.broadcast(`Alert\n${text}`);
}

function notifyTelegramAlert(text) {
  if (!telegramBot) return;
  void sendTelegramAlert(text).catch((error) => console.warn(`[telegram] alert failed: ${error.message}`));
}

async function checkTelegramBigChangeAlerts(filters = {}) {
  if (!telegramBot) return;
  const currentMonth = filters.to ?? (hasDatabaseUrl()
    ? (await freshnessFromDb().catch(() => null))?.latestMonth
    : freshness(await loadRows()).latestMonth);
  const previousMonth = previousMonthKey(currentMonth);
  if (!currentMonth || !previousMonth) return;
  const currentRows = await loadMapRows({ ...filters, from: currentMonth, to: currentMonth, metric: "ev_share" });
  const previousRows = await loadMapRows({ ...filters, from: previousMonth, to: previousMonth, metric: "ev_share" });
  const current = new Map(summarizeMapStateRows(currentRows).map((item) => [item.state, item]));
  const previous = new Map(summarizeMapStateRows(previousRows).map((item) => [item.state, item]));
  const threshold = TELEGRAM_ALERT_THRESHOLD_POINTS / 100;
  const changes = [];
  for (const [state, item] of current) {
    const before = previous.get(state);
    if (!item.rowCount || !before?.rowCount || item.evShare === null || before.evShare === null) continue;
    const delta = item.evShare - before.evShare;
    if (Math.abs(delta) >= threshold) changes.push({ state, item, before, delta });
  }
  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  for (const change of changes.slice(0, 5)) {
    const key = `ev-share-change:${currentMonth}:${change.state}:${change.delta.toFixed(4)}`;
    if (sentTelegramAlertKeys.has(key)) continue;
    sentTelegramAlertKeys.add(key);
    await sendTelegramAlert([
      `EV share changed for ${change.state}`,
      `${previousMonth}: ${telegramPercent(change.before.evShare)}`,
      `${currentMonth}: ${telegramPercent(change.item.evShare)}`,
      `Change: ${telegramPoints(change.delta)}`,
    ].join("\n"));
  }
}

function scheduleTelegramSummaries() {
  if (!telegramBot) return;
  setInterval(() => {
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const isMorning = now.getHours() === 9;
    const jobs = [];
    if (isMorning && now.getDay() === 1) jobs.push(["weekly", "Weekly"]);
    if (isMorning && now.getDate() === 1) jobs.push(["monthly", "Monthly"]);
    for (const [kind, label] of jobs) {
      const key = `${kind}:${dateKey}`;
      if (sentTelegramSummaryKeys.has(key)) continue;
      sentTelegramSummaryKeys.add(key);
      void buildTelegramSummary({ label })
        .then((summary) => telegramBot.broadcast(summary))
        .catch((error) => console.warn(`[telegram] ${kind} summary failed: ${error.message}`));
    }
  }, 60 * 60 * 1000);
}

function telegramUsageDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isTrustedTelegramChat(chatId) {
  return telegramAllowedChatIds.has(String(chatId));
}

function consumeTelegramPublicQuota(chatId) {
  if (isTrustedTelegramChat(chatId)) {
    return { allowed: true, trusted: true, remaining: Infinity, limit: Infinity };
  }
  if (!TELEGRAM_PUBLIC_ACCESS) {
    return { allowed: false, trusted: false, remaining: 0, limit: 0 };
  }

  const key = `${telegramUsageDateKey()}:${chatId}`;
  const used = telegramPublicUsage.get(key) ?? 0;
  if (used >= TELEGRAM_PUBLIC_DAILY_LIMIT) {
    return { allowed: false, trusted: false, remaining: 0, limit: TELEGRAM_PUBLIC_DAILY_LIMIT };
  }
  const nextUsed = used + 1;
  telegramPublicUsage.set(key, nextUsed);
  return {
    allowed: true,
    trusted: false,
    remaining: TELEGRAM_PUBLIC_DAILY_LIMIT - nextUsed,
    limit: TELEGRAM_PUBLIC_DAILY_LIMIT,
  };
}

function telegramQuotaLine(quota) {
  if (!quota || quota.trusted || !Number.isFinite(quota.remaining)) return null;
  return `Free messages left today: ${quota.remaining}/${quota.limit}`;
}

function withTelegramQuota(text, quota) {
  const quotaLine = telegramQuotaLine(quota);
  return quotaLine ? `${text}\n\n${quotaLine}` : text;
}

async function handleTelegramMessage({ chatId, text, bot }) {
  try {
    const normalized = text.trim().toLowerCase();
    const startLinkCode = normalized.startsWith("/start ") ? text.trim().split(/\s+/, 2)[1] : null;
    const linkCode = normalized.startsWith("/link ") ? text.trim().split(/\s+/, 2)[1] : startLinkCode;

    if (linkCode) {
      const user = await linkTelegramChat(linkCode, chatId);
      await bot.sendKeyboard(chatId, user
        ? `Telegram linked to ${user.email}. You can now use Query, Map, and Summary.`
        : "That link code is invalid or expired. Sign in on the website and generate a fresh Telegram link.");
      return;
    }

    if (normalized === "/start" || normalized === "/help") {
      telegramChatModes.set(String(chatId), "neutral");
      await bot.sendKeyboard(chatId, [
        "VAHAN Telegram Command Center",
        "Link your Google account from the website before using the bot.",
        "Use the keyboard buttons:",
        "Query - ask dashboard questions",
        "Map - ask state/map questions",
        "Summary - get the latest EV ranking and coverage summary",
        "If buttons are hidden, use Telegram's command menu or type /query, /map, /summary, /weekly, or /monthly.",
      ].join("\n"));
      return;
    }

    const linkedUser = await userForTelegramChat(chatId);
    if (!linkedUser && !isTrustedTelegramChat(chatId)) {
      await bot.sendKeyboard(chatId, [
        "Login required.",
        "Open Tracked queries on the website, sign in with Google, then use the Telegram link button.",
        `Your chat ID: ${chatId}`,
      ].join("\n"));
      return;
    }

    const quota = linkedUser
      ? { allowed: true, trusted: true, remaining: Infinity, limit: Infinity }
      : consumeTelegramPublicQuota(chatId);
    if (!quota.allowed) {
      await bot.sendKeyboard(chatId, TELEGRAM_PUBLIC_ACCESS
        ? [
          "Daily public limit reached.",
          `Public users get ${TELEGRAM_PUBLIC_DAILY_LIMIT} messages per day.`,
          `Ask the admin to add your chat ID to TELEGRAM_ALLOWED_CHAT_IDS for unlimited access: ${chatId}`,
        ].join("\n")
        : [
          "Access is private right now.",
          `Ask the admin to add your chat ID to TELEGRAM_ALLOWED_CHAT_IDS: ${chatId}`,
        ].join("\n"));
      return;
    }

    if (normalized === "query" || normalized === "/query") {
      telegramChatModes.set(String(chatId), "query");
      await bot.sendKeyboard(chatId, withTelegramQuota("Send a VAHAN query.", quota));
      return;
    }
    if (normalized === "map" || normalized === "/map") {
      telegramChatModes.set(String(chatId), "map");
      await bot.sendKeyboard(chatId, withTelegramQuota("Send a map/state query.", quota));
      return;
    }
    const sendSummary = async (summaryLabel) => {
      telegramChatModes.set(String(chatId), "neutral");
      const summary = await buildTelegramSummary({
        label: summaryLabel,
        onFetchStart: ({ filters, refreshGroups }) => bot.sendMessage(chatId, [
          `${summaryLabel} EV Summary`,
          `Fetching ${telegramNumber(telegramSummaryFetchStateCount(refreshGroups))} missing states for ${filters.from} before creating the summary.`,
          "This can take a few minutes.",
        ].join("\n")),
      });
      await bot.sendKeyboard(chatId, withTelegramQuota(summary, quota));
    };

    if (normalized === "summary" || normalized === "/summary") {
      telegramChatModes.set(String(chatId), "summary");
      await bot.sendMessage(chatId, withTelegramQuota("Which summary do you want?", quota), {
        reply_markup: SUMMARY_CHOICE_KEYBOARD,
      });
      return;
    }
    if (normalized === "/weekly" || (telegramChatModes.get(String(chatId)) === "summary" && ["weekly", "week", "weeks"].includes(normalized))) {
      await sendSummary("Weekly");
      return;
    }
    if (normalized === "/monthly" || (telegramChatModes.get(String(chatId)) === "summary" && ["monthly", "month", "months"].includes(normalized))) {
      await sendSummary("Monthly");
      return;
    }

    const mode = telegramChatModes.get(String(chatId)) ?? "neutral";
    const reply = mode === "map" ? await handleTelegramMap(text) : await handleTelegramQuery(text);
    await bot.sendKeyboard(chatId, withTelegramQuota(reply, quota));
  } catch (error) {
    console.warn(`[telegram] message failed: ${error.message}`);
    await bot.sendKeyboard(chatId, [
      "I could not process that message.",
      error.message,
      "Use Query, Map, Summary, /weekly, or /monthly.",
    ].join("\n"));
  }
}

function startTelegramCommandCenter() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedChatIds = parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
  telegramAllowedChatIds = allowedChatIds;
  if (!token) {
    console.log("[telegram] disabled; configure TELEGRAM_BOT_TOKEN to enable.");
    return null;
  }
  const bot = createTelegramBot({
    token,
    allowedChatIds,
    allowPublicAccess: true,
    polling: TELEGRAM_ENABLE_POLLING,
    onMessage: handleTelegramMessage,
    logger: console,
  });
  telegramBot = bot;
  void bot.setCommands([
    { command: "start", description: "Show help and shortcuts" },
    { command: "query", description: "Ask dashboard questions" },
    { command: "map", description: "Ask map or state questions" },
    { command: "summary", description: "Choose weekly or monthly summary" },
    { command: "weekly", description: "Get weekly EV summary" },
    { command: "monthly", description: "Get monthly EV summary" },
  ]).catch((error) => console.warn(`[telegram] command menu setup failed: ${error.message}`));
  bot.start();
  scheduleTelegramSummaries();
  console.log(`[telegram] command center enabled for ${allowedChatIds.size} allowed chat(s); public daily limit=${TELEGRAM_PUBLIC_ACCESS ? TELEGRAM_PUBLIC_DAILY_LIMIT : "off"}.`);
  return bot;
}

async function readBody(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      const error = new Error(`Request body must be ${MAX_JSON_BODY_BYTES} bytes or smaller.`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, securityHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  }));
  response.end(JSON.stringify(payload));
}

function monthlySalesReportInput(url) {
  return {
    month: url.searchParams.get("month") || null,
    fuelScope: url.searchParams.get("fuelScope") || url.searchParams.get("fuel-scope") || "all",
    fuel: url.searchParams.get("fuel") || null,
  };
}

async function buildMonthlySalesReportForUrl(url) {
  return buildMonthlySalesReport({
    rows: await loadRows(),
    makerRows: await loadMakerRows(),
    ...monthlySalesReportInput(url),
    sourceLabel: SOURCE_LABEL,
  });
}

async function renderMonthlySalesReportPdf(report) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    await page.setContent(renderMonthlySalesReportHtml(report), { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "12mm",
        right: "10mm",
        bottom: "12mm",
        left: "10mm",
      },
    });
  } finally {
    await browser.close();
  }
}

function sendJsonWithHeaders(response, status, payload, headers = {}) {
  response.writeHead(status, securityHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  }));
  response.end(JSON.stringify(payload));
}

function redirect(response, location, headers = {}) {
  response.writeHead(302, securityHeaders({ location, ...headers }));
  response.end();
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  let requestedPath;
  try {
    requestedPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^[/\\]+/, "");
  } catch {
    response.writeHead(400, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
    response.end("Bad request");
    return;
  }
  const publicRoot = path.resolve(PUBLIC_DIR);
  const resolved = path.resolve(publicRoot, requestedPath);
  if (resolved !== publicRoot && !resolved.startsWith(`${publicRoot}${path.sep}`)) {
    response.writeHead(403, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
    response.end("Forbidden");
    return;
  }
  const content = await fs.readFile(resolved).catch(() => null);
  if (!content) {
    response.writeHead(404, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
    response.end("Not found");
    return;
  }
  const ext = path.extname(resolved);
  const contentType = ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "text/html";
  response.writeHead(200, securityHeaders({
    "content-type": contentType,
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
  }));
  response.end(content);
}

async function postgresHealthPayload() {
  const dbFreshness = await freshnessFromDb();
  databaseUnavailable = false;
  return {
    status: "ok",
    storage: "postgres",
    rowCount: dbFreshness.rowCount,
    latestMonth: dbFreshness.latestMonth,
    source: dbFreshness.source,
    database: { status: "ok" },
    liveRefreshDisabled: LIVE_REFRESH_DISABLED,
  };
}

async function csvHealthPayload(databaseStatus = null) {
  const rows = await loadRows();
  return {
    status: "ok",
    storage: "csv",
    rowCount: rows.length,
    ...freshness(rows),
    database: databaseStatus ?? {
      status: hasDatabaseUrl() ? "unavailable" : "not_configured",
    },
    liveRefreshDisabled: LIVE_REFRESH_DISABLED,
  };
}

async function livenessHealthPayload() {
  if (useDatabaseStorage()) {
    try {
      return await postgresHealthPayload();
    } catch (error) {
      databaseUnavailable = true;
      console.warn(`[data] Neon health read failed, using CSV health: ${error.message}`);
      return csvHealthPayload({ status: "unavailable", error: error.message });
    }
  }
  return csvHealthPayload();
}

async function readinessHealthPayload() {
  if (!hasDatabaseUrl()) {
    if (REQUIRE_DATABASE_FOR_READINESS) {
      const error = new Error("DATABASE_URL is required for production readiness.");
      error.statusCode = 503;
      throw error;
    }
    return csvHealthPayload({ status: "not_configured" });
  }

  try {
    return await postgresHealthPayload();
  } catch (error) {
    databaseUnavailable = true;
    if (REQUIRE_DATABASE_FOR_READINESS) {
      const readinessError = new Error(`Database readiness check failed: ${error.message}`);
      readinessError.statusCode = 503;
      throw readinessError;
    }
    return csvHealthPayload({ status: "unavailable", error: error.message });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/reports/monthly-sales") {
      sendJson(response, 200, await buildMonthlySalesReportForUrl(url));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/reports/monthly-sales/pdf") {
      const report = await buildMonthlySalesReportForUrl(url);
      const pdf = await renderMonthlySalesReportPdf(report);
      const filename = `monthly-sales-${report.period.month}-${report.fuelSelection.scope}${report.fuelSelection.fuel ? `-${report.fuelSelection.fuel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""}.pdf`;
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
      });
      response.end(pdf);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/me") {
      const user = await currentUser(request);
      sendJson(response, 200, {
        authenticated: Boolean(user),
        googleConfigured: hasGoogleAuthConfig(),
        user,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/auth/google") {
      const login = googleLoginUrl({ returnTo: url.searchParams.get("returnTo") || "/tracked.html" });
      const stateCookie = oauthStateCookieValue(login.state, login.returnTo);
      redirect(response, login.url, {
        "set-cookie": `${oauthStateCookieName()}=${stateCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/auth/google/callback") {
      const stored = readOauthStateCookie(request);
      if (!stored?.state || stored.state !== url.searchParams.get("state")) {
        sendJson(response, 400, { error: "Google login state did not match." });
        return;
      }
      const profile = await googleUserFromCode(url.searchParams.get("code"));
      const user = await upsertGoogleUser(profile);
      const session = await createSession(user.id);
      redirect(response, stored.returnTo || "/tracked.html", {
        "set-cookie": [
          sessionCookie(session),
          clearCookieHeader(oauthStateCookieName()),
        ],
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/auth/logout") {
      await destroySession(parseCookies(request)[authCookieName()]);
      sendJsonWithHeaders(response, 200, { ok: true }, {
        "set-cookie": clearCookieHeader(authCookieName()),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/telegram/link-code") {
      const user = await requireUser(request);
      const link = await createTelegramLinkCode(user.id);
      sendJson(response, 201, {
        ...link,
        deepLink: telegramDeepLink(link.code),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/query") {
      enforceRateLimit(request, "expensive");
      const body = await readBody(request);
      sendJson(response, 200, await queryData(body));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/query-refresh/")) {
      cleanupRefreshJobs();
      const jobId = decodeURIComponent(url.pathname.slice("/api/query-refresh/".length));
      const job = refreshJobs.get(jobId);
      if (!job) {
        sendJson(response, 404, { error: "Refresh job not found" });
        return;
      }
      if (job.status === "pending") {
        sendJson(response, 200, { liveRefresh: liveRefreshInfo(job) });
        return;
      }
      sendJson(response, 200, job.payload ?? { liveRefresh: liveRefreshInfo(job) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/tracked-queries") {
      const user = await requireUser(request);
      sendJson(response, 200, { trackedQueries: await listTrackedQueries({ userId: user.id }) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/tracked-queries") {
      const user = await requireUser(request);
      const body = await readBody(request);
      sendJson(response, 201, { trackedQuery: await createTrackedQuery(body, { userId: user.id }) });
      return;
    }
    const trackedObservationMatch = url.pathname.match(/^\/api\/tracked-queries\/(\d+)\/observations$/);
    if (request.method === "GET" && trackedObservationMatch) {
      const user = await requireUser(request);
      const trackedQueryId = Number(trackedObservationMatch[1]);
      const trackedQuery = await getTrackedQuery(trackedQueryId, { userId: user.id });
      if (!trackedQuery) {
        sendJson(response, 404, { error: "Tracked query not found" });
        return;
      }
      sendJson(response, 200, {
        trackedQuery,
        observations: await listTrackedQueryObservations(trackedQueryId, {
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          limit: url.searchParams.get("limit"),
        }),
      });
      return;
    }
    const trackedRunsMatch = url.pathname.match(/^\/api\/tracked-queries\/(\d+)\/runs$/);
    if (request.method === "GET" && trackedRunsMatch) {
      const user = await requireUser(request);
      const trackedQueryId = Number(trackedRunsMatch[1]);
      const trackedQuery = await getTrackedQuery(trackedQueryId, { userId: user.id });
      if (!trackedQuery) {
        sendJson(response, 404, { error: "Tracked query not found" });
        return;
      }
      sendJson(response, 200, {
        trackedQuery,
        runs: await listTrackedQueryRuns(trackedQueryId, {
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          limit: url.searchParams.get("limit"),
        }),
      });
      return;
    }
    const trackedQueryMatch = url.pathname.match(/^\/api\/tracked-queries\/(\d+)$/);
    if (trackedQueryMatch && request.method === "PATCH") {
      const user = await requireUser(request);
      const body = await readBody(request);
      const trackedQuery = await updateTrackedQuery(Number(trackedQueryMatch[1]), body, { userId: user.id });
      if (!trackedQuery) {
        sendJson(response, 404, { error: "Tracked query not found" });
        return;
      }
      sendJson(response, 200, { trackedQuery });
      return;
    }
    if (trackedQueryMatch && request.method === "DELETE") {
      const user = await requireUser(request);
      const hardDelete = /^(1|true|yes)$/i.test(url.searchParams.get("hard") ?? "");
      const trackedQuery = hardDelete
        ? await deleteTrackedQuery(Number(trackedQueryMatch[1]), { userId: user.id })
        : await disableTrackedQuery(Number(trackedQueryMatch[1]), { userId: user.id });
      if (!trackedQuery) {
        sendJson(response, 404, { error: "Tracked query not found" });
        return;
      }
      sendJson(response, 200, { trackedQuery, deleted: hardDelete });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/registrations") {
      const useDatabase = hasDatabaseUrl();
      const rows = useDatabase ? [] : await loadRows();
      const catalog = await loadCatalog(rows);
      const filters = resolveRto(queryFiltersFromSearchParams(url.searchParams), rows, catalog);
      const resultRows = useDatabase && !filters.ambiguousRtos
        ? await queryRegistrationRows(filters)
        : filterRows(rows, filters);
      const summary = summarize(resultRows);
      sendJson(response, 200, {
        filters,
        summary,
        trend: summary.trend,
        fuelBreakdown: summary.fuelBreakdown,
        rows: resultRows,
        freshness: useDatabase ? await freshnessFromDb() : freshness(rows),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/map/summary") {
      const filters = mapFiltersFromUrl(url);
      const rows = await loadMapRows(filters);
      sendJson(response, 200, mapSummaryPayload(rows, filters));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/map/query") {
      enforceRateLimit(request, "expensive");
      const body = await readBody(request);
      const fallbackFilters = {
        ...mapBaseFilters(url),
        from: body.from ?? url.searchParams.get("from") ?? null,
        to: body.to ?? url.searchParams.get("to") ?? null,
        vehicleCategories: uniqueSorted(body.vehicleCategories ?? []),
        norms: uniqueSorted(body.norms ?? []),
        vehicleClasses: uniqueSorted(body.vehicleClasses ?? []),
      };
      const filters = mapFiltersFromQuery(body.query ?? "", fallbackFilters);
      const groups = monthsByYear(filters.from, filters.to);
      if (!groups.length) {
        sendJson(response, 400, { error: "Choose a valid month range where From is earlier than or equal to To." });
        return;
      }
      const monthCount = groups.reduce((count, group) => count + group.months.length, 0);
      if (monthCount > MAX_MAP_FETCH_MONTHS) {
        sendJson(response, 400, { error: `Map fetch supports up to ${MAX_MAP_FETCH_MONTHS} months at a time. Narrow the date range and try again.` });
        return;
      }
      const rows = await loadMapRows(filters);
      const refreshGroups = LIVE_REFRESH_DISABLED ? [] : mapRefreshGroupsForFilters(filters, rows);
      const savedStateCount = mapSavedStateCount(filters, rows);
      if (!refreshGroups.length) {
        sendJson(response, 200, mapSummaryPayload(rows, filters, mapSavedRefreshInfo(groups)));
        return;
      }
      const job = startMapRefreshJob({ filters, baseRows: rows, groups: refreshGroups, savedStateCount });
      sendJson(response, 202, mapSummaryPayload(mapRefreshDisplayRows(job), filters, mapRefreshInfo(job)));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/map-refresh/")) {
      cleanupRefreshJobs();
      const jobId = decodeURIComponent(url.pathname.slice("/api/map-refresh/".length));
      const job = mapRefreshJobs.get(jobId);
      if (!job) {
        sendJson(response, 404, { error: "Map refresh job not found" });
        return;
      }
      if (job.status === "pending") {
        sendJson(response, 200, mapSummaryPayload(mapRefreshDisplayRows(job), job.filters, mapRefreshInfo(job)));
        return;
      }
      sendJson(response, 200, job.payload ?? mapSummaryPayload(job.baseRows, job.filters, mapRefreshInfo(job)));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/map/state/") && url.pathname.endsWith("/rtos")) {
      const state = decodeURIComponent(url.pathname.slice("/api/map/state/".length, -"/rtos".length));
      const filters = mapFiltersFromUrl(url);
      const rows = await loadMapRows({ ...filters, state }, { rtoScope: "all" });
      const stateRows = filterMapRows(rows, { ...filters, state });
      const stateSummary = summarizeMapStateRows(stateRows).find((item) => item.state === state) ?? {
        state,
        total: 0,
        evTotal: 0,
        evShare: null,
        rowCount: 0,
        rtoCount: 0,
        hasRtoData: false,
      };
      sendJson(response, 200, {
        filters: { ...filters, state },
        state: stateSummary,
        rtos: summarizeMapRtoRows(stateRows),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/metadata/rtos") {
      const rows = await loadRows();
      const useDatabase = useDatabaseStorage();
      const catalog = await loadCatalog(rows);
      const state = url.searchParams.get("state");
      const catalogRtos = (catalog.states ?? [])
        .filter((stateGroup) => !state || stateGroup.state === state)
        .flatMap((stateGroup) => stateGroup.rtos.map((rto) => rto.label));
      const rowRtos = useDatabase
        ? (await queryRtos(state)).map((row) => row.rto)
        : rows.filter((row) => !state || row.state === state).map((row) => row.rto);
      const rtos = [...new Set([...catalogRtos, ...rowRtos])].sort();
      sendJson(response, 200, { rtos, catalogUpdatedAt: catalog.updated_at });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/metadata/rto-resolve") {
      const rows = await loadRows();
      const catalog = await loadCatalog(rows);
      const filters = resolveRto({
        state: url.searchParams.get("state") || null,
        rto: url.searchParams.get("rto") || null,
        rtoText: url.searchParams.get("rtoText") || null,
        locationText: url.searchParams.get("q") || url.searchParams.get("locationText") || null,
      }, rows, catalog);
      sendJson(response, 200, {
        query: url.searchParams.get("q") || url.searchParams.get("locationText") || url.searchParams.get("rtoText") || null,
        state: filters.state ?? null,
        status: filters.rtoResolution?.status ?? "none",
        rto: filters.rto ?? null,
        candidates: filters.rtoResolution?.candidates ?? [],
        resolution: filters.rtoResolution ?? null,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, await livenessHealthPayload());
      return;
    }
    if (request.method === "GET" && url.pathname === "/ready") {
      sendJson(response, 200, await readinessHealthPayload());
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (status >= 500) console.error(`[request] ${request.method} ${request.url}: ${error.stack ?? error.message}`);
    const message = status >= 500 && IS_PRODUCTION
      ? "Internal server error"
      : error.message || (status === 500 ? "Internal server error" : "Request failed");
    sendJsonWithHeaders(response, status, { error: message }, error.headers ?? {});
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`VAHAN dashboard running at http://localhost:${PORT}`);
    startTelegramCommandCenter();
  });
}
