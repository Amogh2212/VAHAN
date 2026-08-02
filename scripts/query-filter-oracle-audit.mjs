import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { closePool, hasDatabaseUrl, query as dbQuery } from "../lib/db.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const AUDIT_DATE = "2026-07-30";
const ORACLE_PATH = path.join(ROOT, "data", "query-audits", `random-filter-oracle-${AUDIT_DATE}.csv`);
const REPORT_PREFIX = path.join(ROOT, "reports", `query-filter-audit-${AUDIT_DATE}`);
const CHECKPOINT_PATH = `${REPORT_PREFIX}.checkpoint.json`;
const GROQ_CALL_CAP = 50;
const GROQ_INTERVAL_MS = 30_250;
const EMPTY_FILTERS = Object.freeze({
  fuelSegment: "",
  fuelType: "",
  fuelFilters: [],
  selectedFuelTypes: [],
  vehicleCategories: [],
  selectedVehicleCategories: [],
  selectedVehicleGroups: [],
  vehicleClasses: [],
  selectedVehicleClasses: [],
  norms: [],
  selectedNorms: [],
  excludedFuelTypes: [],
  excludedVehicleGroups: [],
  excludedVehicleClasses: [],
  excludedVehicleCategories: [],
  excludedNorms: [],
});
const ARRAY_FILTER_FIELDS = [
  "fuelFilters",
  "selectedFuelTypes",
  "vehicleCategories",
  "selectedVehicleCategories",
  "selectedVehicleGroups",
  "vehicleClasses",
  "selectedVehicleClasses",
  "norms",
  "selectedNorms",
  "excludedFuelTypes",
  "excludedVehicleGroups",
  "excludedVehicleClasses",
  "excludedVehicleCategories",
  "excludedNorms",
];
const ASSERTED_FILTER_FIELDS = [
  "state",
  "from",
  "to",
  "fuelSegment",
  "fuelType",
  ...ARRAY_FILTER_FIELDS,
];
const DATA_FILES = [
  path.join(ROOT, "data", "vahan", "vahan_fuel_monthly.csv"),
  path.join(ROOT, "data", "vahan", "vahan_fuel_monthly.errors.jsonl"),
  path.join(ROOT, "data", "vahan", "vahan_fuel_monthly.summary.json"),
];

function parseArguments(argv) {
  const options = {
    lanes: ["rules", "groq"],
    generateOnly: false,
    resume: false,
    reportOnly: false,
    basePort: 33170,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--generate-only") options.generateOnly = true;
    else if (argument === "--resume") options.resume = true;
    else if (argument === "--report-only") options.reportOnly = true;
    else if (argument === "--lane") {
      const lane = String(argv[index += 1] ?? "").toLowerCase();
      if (!["rules", "groq", "both"].includes(lane)) throw new Error("--lane must be rules, groq, or both.");
      options.lanes = lane === "both" ? ["rules", "groq"] : [lane];
    } else if (argument === "--port") {
      options.basePort = Number(argv[index += 1]);
      if (!Number.isInteger(options.basePort) || options.basePort < 1024 || options.basePort > 65000) {
        throw new Error("--port must be an integer from 1024 to 65000.");
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function expected(overrides = {}) {
  return {
    ...EMPTY_FILTERS,
    state: "",
    rtoContains: "",
    from: "",
    to: "",
    ...overrides,
  };
}

function auditCase(id, group, query, filters, families, pairId = "", notes = "") {
  return {
    caseId: id,
    caseGroup: group,
    pairId,
    query,
    families: [...families],
    notes,
    expected: expected(filters),
  };
}

function frozenOracleCases() {
  const twoWheeler = ["TWO WHEELER(NT)", "TWO WHEELER(T)"];
  const threeWheeler = ["THREE WHEELER(NT)", "THREE WHEELER(T)"];
  const fourWheeler = ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"];
  const batteryEv = ["ELECTRIC(BOV)", "PURE EV"];
  return [
    auditCase("Q001", "coverage", "Show vehicle registrations in Maharashtra for January 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01" }, ["geography", "date"], "P01"),
    auditCase("Q002", "coverage", "Show registrations in Delhi from February 2025 to March 2025.", { state: "Delhi", from: "2025-02", to: "2025-03" }, ["geography", "date"]),
    auditCase("Q003", "coverage", "Show diesel vehicle registrations in Karnataka during April 2024.", { state: "Karnataka", from: "2024-04", to: "2024-04", fuelSegment: "NON_EV", fuelType: "DIESEL", selectedFuelTypes: ["DIESEL"] }, ["geography", "date", "fuel"], "P02"),
    auditCase("Q004", "coverage", "Show petrol vehicle registrations in Tamil Nadu during May 2024.", { state: "Tamil Nadu", from: "2024-05", to: "2024-05", fuelSegment: "NON_EV", fuelType: "PETROL", selectedFuelTypes: ["PETROL"] }, ["geography", "date", "fuel"]),
    auditCase("Q005", "coverage", "Show EV registrations in Uttar Pradesh during June 2024.", { state: "Uttar Pradesh", from: "2024-06", to: "2024-06", fuelSegment: "EV", selectedFuelTypes: batteryEv }, ["geography", "date", "fuel"], "P03"),
    auditCase("Q006", "coverage", "Show CNG registrations in Gujarat during July 2024.", { state: "Gujarat", from: "2024-07", to: "2024-07", fuelSegment: "NON_EV", fuelType: "CNG", selectedFuelTypes: ["CNG ONLY"] }, ["geography", "date", "fuel"]),
    auditCase("Q007", "coverage", "Show electric BOV registrations in Rajasthan during August 2024.", { state: "Rajasthan", from: "2024-08", to: "2024-08", fuelSegment: "EV", fuelType: "ELECTRIC", selectedFuelTypes: ["ELECTRIC(BOV)"] }, ["geography", "date", "fuel"]),
    auditCase("Q008", "coverage", "Show pure EV registrations in West Bengal during September 2024.", { state: "West Bengal", from: "2024-09", to: "2024-09", fuelSegment: "EV", fuelType: "PURE EV", selectedFuelTypes: ["PURE EV"] }, ["geography", "date", "fuel"]),
    auditCase("Q009", "coverage", "Show two wheeler registrations in Bihar during October 2024.", { state: "Bihar", from: "2024-10", to: "2024-10", vehicleCategories: twoWheeler, selectedVehicleCategories: twoWheeler }, ["geography", "date", "category"], "P04"),
    auditCase("Q010", "coverage", "Show three wheeler registrations in Kerala during November 2024.", { state: "Kerala", from: "2024-11", to: "2024-11", vehicleCategories: threeWheeler, selectedVehicleCategories: threeWheeler }, ["geography", "date", "category"]),
    auditCase("Q011", "coverage", "Show four wheeler registrations in Telangana during December 2024.", { state: "Telangana", from: "2024-12", to: "2024-12", vehicleCategories: fourWheeler, selectedVehicleCategories: fourWheeler }, ["geography", "date", "category"]),
    auditCase("Q012", "coverage", "Show LMV registrations in Madhya Pradesh during January 2025.", { state: "Madhya Pradesh", from: "2025-01", to: "2025-01", vehicleCategories: ["LIGHT MOTOR VEHICLE"], selectedVehicleCategories: ["LIGHT MOTOR VEHICLE"] }, ["geography", "date", "category"]),
    auditCase("Q013", "coverage", "Show HMV registrations in Odisha during February 2025.", { state: "Odisha", from: "2025-02", to: "2025-02", vehicleCategories: ["HEAVY MOTOR VEHICLE"], selectedVehicleCategories: ["HEAVY MOTOR VEHICLE"] }, ["geography", "date", "category"]),
    auditCase("Q014", "coverage", "Show motor car registrations in Assam during March 2025.", { state: "Assam", from: "2025-03", to: "2025-03", vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] }, ["geography", "date", "class"], "P05"),
    auditCase("Q015", "coverage", "Show bus registrations in Jharkhand during April 2025.", { state: "Jharkhand", from: "2025-04", to: "2025-04", vehicleClasses: ["BUS"], selectedVehicleClasses: ["BUS"] }, ["geography", "date", "class"]),
    auditCase("Q016", "coverage", "Show goods carrier registrations in Haryana during May 2025.", { state: "Haryana", from: "2025-05", to: "2025-05", vehicleClasses: ["GOODS CARRIER"], selectedVehicleClasses: ["GOODS CARRIER"] }, ["geography", "date", "class"]),
    auditCase("Q017", "coverage", "Show passenger e-rickshaw registrations in Punjab during June 2025.", { state: "Punjab", from: "2025-06", to: "2025-06", vehicleClasses: ["E-RICKSHAW(P)"], selectedVehicleClasses: ["E-RICKSHAW(P)"] }, ["geography", "date", "class"]),
    auditCase("Q018", "coverage", "Show scooter registrations in Andhra Pradesh during July 2025.", { state: "Andhra Pradesh", from: "2025-07", to: "2025-07", vehicleClasses: ["M-CYCLE/SCOOTER"], selectedVehicleClasses: ["M-CYCLE/SCOOTER"] }, ["geography", "date", "class"]),
    auditCase("Q019", "coverage", "Show BS VI vehicle registrations in Chandigarh during August 2025.", { state: "Chandigarh", from: "2025-08", to: "2025-08", norms: ["BHARAT STAGE VI"], selectedNorms: ["BHARAT STAGE VI"] }, ["geography", "date", "norm"], "P06"),
    auditCase("Q020", "coverage", "Show BS IV vehicle registrations in Goa during September 2025.", { state: "Goa", from: "2025-09", to: "2025-09", norms: ["BHARAT STAGE IV"], selectedNorms: ["BHARAT STAGE IV"] }, ["geography", "date", "norm"]),
    auditCase("Q021", "coverage", "Show BS III motor car registrations in Maharashtra during October 2025.", { state: "Maharashtra", from: "2025-10", to: "2025-10", vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"], norms: ["BHARAT STAGE III"], selectedNorms: ["BHARAT STAGE III"] }, ["geography", "date", "class", "norm"]),
    auditCase("Q022", "coverage", "Show BS VI diesel motor car registrations in Delhi during November 2025.", { state: "Delhi", from: "2025-11", to: "2025-11", fuelSegment: "NON_EV", fuelType: "DIESEL", selectedFuelTypes: ["DIESEL"], vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"], norms: ["BHARAT STAGE VI"], selectedNorms: ["BHARAT STAGE VI"] }, ["geography", "date", "fuel", "class", "norm"], "P07"),
    auditCase("Q023", "coverage", "Show BS VI EV two wheeler registrations in Karnataka during December 2025.", { state: "Karnataka", from: "2025-12", to: "2025-12", fuelSegment: "EV", selectedFuelTypes: batteryEv, vehicleCategories: twoWheeler, selectedVehicleCategories: twoWheeler, norms: ["BHARAT STAGE VI"], selectedNorms: ["BHARAT STAGE VI"] }, ["geography", "date", "fuel", "category", "norm"]),
    auditCase("Q024", "coverage", "Show petrol bus registrations in Tamil Nadu during January 2025.", { state: "Tamil Nadu", from: "2025-01", to: "2025-01", fuelSegment: "NON_EV", fuelType: "PETROL", selectedFuelTypes: ["PETROL"], vehicleClasses: ["BUS"], selectedVehicleClasses: ["BUS"] }, ["geography", "date", "fuel", "class"]),
    auditCase("Q025", "coverage", "Show motor car registrations at MH-12 RTO during January 2025.", { state: "Maharashtra", rtoContains: "MH-12", from: "2025-01", to: "2025-01", vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] }, ["geography", "rto", "date", "class"], "P08"),
    auditCase("Q026", "coverage", "Show diesel registrations at DL-01 RTO during February 2025.", { state: "Delhi", rtoContains: "DL-01", from: "2025-02", to: "2025-02", fuelSegment: "NON_EV", fuelType: "DIESEL", selectedFuelTypes: ["DIESEL"] }, ["geography", "rto", "date", "fuel"]),
    auditCase("Q027", "coverage", "Show EV registrations at KA-01 RTO during March 2025.", { state: "Karnataka", rtoContains: "KA-01", from: "2025-03", to: "2025-03", fuelSegment: "EV", selectedFuelTypes: batteryEv }, ["geography", "rto", "date", "fuel"]),
    auditCase("Q028", "coverage", "Show two wheeler registrations at TN-01 RTO during April 2025.", { state: "Tamil Nadu", rtoContains: "TN-01", from: "2025-04", to: "2025-04", vehicleCategories: twoWheeler, selectedVehicleCategories: twoWheeler }, ["geography", "rto", "date", "category"]),
    auditCase("Q029", "coverage", "Show BS VI registrations at UP-16 RTO during May 2025.", { state: "Uttar Pradesh", rtoContains: "UP-16", from: "2025-05", to: "2025-05", norms: ["BHARAT STAGE VI"], selectedNorms: ["BHARAT STAGE VI"] }, ["geography", "rto", "date", "norm"]),
    auditCase("Q030", "coverage", "Show BS IV CNG three wheeler registrations in Gujarat during June 2025.", { state: "Gujarat", from: "2025-06", to: "2025-06", fuelSegment: "NON_EV", fuelType: "CNG", selectedFuelTypes: ["CNG ONLY"], vehicleCategories: threeWheeler, selectedVehicleCategories: threeWheeler, norms: ["BHARAT STAGE IV"], selectedNorms: ["BHARAT STAGE IV"] }, ["geography", "date", "fuel", "category", "norm"], "P10"),
    auditCase("Q031", "spelling_shorthand", "Show EV 4w BS6 registrations in Maharastra during January 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01", fuelSegment: "EV", selectedFuelTypes: batteryEv, vehicleCategories: fourWheeler, selectedVehicleCategories: fourWheeler, norms: ["BHARAT STAGE VI"], selectedNorms: ["BHARAT STAGE VI"] }, ["spelling", "geography", "date", "fuel", "category", "norm"], "P09"),
    auditCase("Q032", "spelling_shorthand", "Show diesel 2w registrations in Gujrat during February 2025.", { state: "Gujarat", from: "2025-02", to: "2025-02", fuelSegment: "NON_EV", fuelType: "DIESEL", selectedFuelTypes: ["DIESEL"], vehicleCategories: twoWheeler, selectedVehicleCategories: twoWheeler }, ["spelling", "geography", "date", "fuel", "category"]),
    auditCase("Q033", "spelling_shorthand", "Show CNG 3w registrations in UP during March 2025.", { state: "Uttar Pradesh", from: "2025-03", to: "2025-03", fuelSegment: "NON_EV", fuelType: "CNG", selectedFuelTypes: ["CNG ONLY"], vehicleCategories: threeWheeler, selectedVehicleCategories: threeWheeler }, ["shorthand", "geography", "date", "fuel", "category"]),
    auditCase("Q034", "spelling_shorthand", "Show petrol LMV registrations in Karnatak during April 2025.", { state: "Karnataka", from: "2025-04", to: "2025-04", fuelSegment: "NON_EV", fuelType: "PETROL", selectedFuelTypes: ["PETROL"], vehicleCategories: ["LIGHT MOTOR VEHICLE"], selectedVehicleCategories: ["LIGHT MOTOR VEHICLE"] }, ["spelling", "geography", "date", "fuel", "category"]),
    auditCase("Q035", "spelling_shorthand", "Show diesel HMV registrations in Rajsthan during May 2025.", { state: "Rajasthan", from: "2025-05", to: "2025-05", fuelSegment: "NON_EV", fuelType: "DIESEL", selectedFuelTypes: ["DIESEL"], vehicleCategories: ["HEAVY MOTOR VEHICLE"], selectedVehicleCategories: ["HEAVY MOTOR VEHICLE"] }, ["spelling", "geography", "date", "fuel", "category"]),
    auditCase("Q036", "spelling_shorthand", "Show BOV motor car registrations in Delhi during June 2025.", { state: "Delhi", from: "2025-06", to: "2025-06", fuelSegment: "EV", selectedFuelTypes: batteryEv, vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] }, ["shorthand", "geography", "date", "fuel", "class"], "P11"),
    auditCase("Q037", "spelling_shorthand", "Show E20 petrol motor car registrations in Maharashtra during July 2025.", { state: "Maharashtra", from: "2025-07", to: "2025-07", fuelSegment: "NON_EV", fuelType: "PETROL(E20)", selectedFuelTypes: ["PETROL(E20)"], vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] }, ["shorthand", "geography", "date", "fuel", "class"]),
    auditCase("Q038", "spelling_shorthand", "Show PHEV motor car registrations in Karnataka during August 2025.", { state: "Karnataka", from: "2025-08", to: "2025-08", fuelType: "PLUG-IN HYBRID EV", selectedFuelTypes: ["PLUG-IN HYBRID EV"], vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] }, ["shorthand", "geography", "date", "fuel", "class"]),
    auditCase("Q039", "spelling_shorthand", "Show 2w NT registrations in Delhi during September 2025.", { state: "Delhi", from: "2025-09", to: "2025-09", vehicleCategories: ["TWO WHEELER(NT)"], selectedVehicleCategories: ["TWO WHEELER(NT)"] }, ["shorthand", "geography", "date", "category"]),
    auditCase("Q040", "spelling_shorthand", "Show BS6 erickshaw passenger registrations in Delhi during October 2025.", { state: "Delhi", from: "2025-10", to: "2025-10", vehicleClasses: ["E-RICKSHAW(P)"], selectedVehicleClasses: ["E-RICKSHAW(P)"], norms: ["BHARAT STAGE VI"], selectedNorms: ["BHARAT STAGE VI"] }, ["shorthand", "spelling", "geography", "date", "class", "norm"]),
    auditCase("Q041", "paraphrase", "For Maharashtra, give the registration total for vehicles in Jan 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01" }, ["paraphrase", "geography", "date"], "P01"),
    auditCase("Q042", "paraphrase", "How many diesel vehicles were registered in Karnataka in Apr 2024?", { state: "Karnataka", from: "2024-04", to: "2024-04", fuelSegment: "NON_EV", fuelType: "DIESEL", selectedFuelTypes: ["DIESEL"] }, ["paraphrase", "geography", "date", "fuel"], "P02"),
    auditCase("Q043", "paraphrase", "Give Uttar Pradesh electric vehicle registrations for Jun 2024.", { state: "Uttar Pradesh", from: "2024-06", to: "2024-06", fuelSegment: "EV", selectedFuelTypes: batteryEv }, ["paraphrase", "geography", "date", "fuel"], "P03"),
    auditCase("Q044", "paraphrase", "In Bihar, what was the two-wheeler registration total for Oct 2024?", { state: "Bihar", from: "2024-10", to: "2024-10", vehicleCategories: twoWheeler, selectedVehicleCategories: twoWheeler }, ["paraphrase", "geography", "date", "category"], "P04"),
    auditCase("Q045", "paraphrase", "Return Assam motor-car registrations for Mar 2025.", { state: "Assam", from: "2025-03", to: "2025-03", vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] }, ["paraphrase", "geography", "date", "class"], "P05"),
    auditCase("Q046", "paraphrase", "Give Chandigarh Bharat Stage 6 vehicle registrations for Aug 2025.", { state: "Chandigarh", from: "2025-08", to: "2025-08", norms: ["BHARAT STAGE VI"], selectedNorms: ["BHARAT STAGE VI"] }, ["paraphrase", "geography", "date", "norm"], "P06"),
    auditCase("Q047", "paraphrase", "For Nov 2025 in Delhi, total BS6 diesel motor cars registered.", { state: "Delhi", from: "2025-11", to: "2025-11", fuelSegment: "NON_EV", fuelType: "DIESEL", selectedFuelTypes: ["DIESEL"], vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"], norms: ["BHARAT STAGE VI"], selectedNorms: ["BHARAT STAGE VI"] }, ["paraphrase", "geography", "date", "fuel", "class", "norm"], "P07"),
    auditCase("Q048", "paraphrase", "At RTO MH 12, return Jan 2025 motor-car registrations.", { state: "Maharashtra", rtoContains: "MH-12", from: "2025-01", to: "2025-01", vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] }, ["paraphrase", "geography", "rto", "date", "class"], "P08"),
    auditCase("Q049", "paraphrase", "Show Maharashtra electric four-wheeler Bharat Stage VI registrations for Jan 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01", fuelSegment: "EV", selectedFuelTypes: batteryEv, vehicleCategories: fourWheeler, selectedVehicleCategories: fourWheeler, norms: ["BHARAT STAGE VI"], selectedNorms: ["BHARAT STAGE VI"] }, ["paraphrase", "geography", "date", "fuel", "category", "norm"], "P09"),
    auditCase("Q050", "paraphrase", "For Gujarat in Jun 2025, return CNG BS4 three-wheeler registrations.", { state: "Gujarat", from: "2025-06", to: "2025-06", fuelSegment: "NON_EV", fuelType: "CNG", selectedFuelTypes: ["CNG ONLY"], vehicleCategories: threeWheeler, selectedVehicleCategories: threeWheeler, norms: ["BHARAT STAGE IV"], selectedNorms: ["BHARAT STAGE IV"] }, ["paraphrase", "geography", "date", "fuel", "category", "norm"], "P10"),
  ];
}

function csvCell(value) {
  const text = value === null || value === undefined
    ? ""
    : Array.isArray(value)
      ? value.join("|")
      : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, columns) {
  return `${[
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n")}\n`;
}

function oracleRows(cases) {
  return cases.map((item) => ({
    case_id: item.caseId,
    case_group: item.caseGroup,
    pair_id: item.pairId,
    query: item.query,
    families: item.families,
    expected_state: item.expected.state,
    expected_rto_contains: item.expected.rtoContains,
    expected_from: item.expected.from,
    expected_to: item.expected.to,
    expected_fuel_segment: item.expected.fuelSegment,
    expected_fuel_type: item.expected.fuelType,
    expected_fuel_filters: item.expected.fuelFilters,
    expected_selected_fuel_types: item.expected.selectedFuelTypes,
    expected_vehicle_categories: item.expected.vehicleCategories,
    expected_selected_vehicle_categories: item.expected.selectedVehicleCategories,
    expected_selected_vehicle_groups: item.expected.selectedVehicleGroups,
    expected_vehicle_classes: item.expected.vehicleClasses,
    expected_selected_vehicle_classes: item.expected.selectedVehicleClasses,
    expected_norms: item.expected.norms,
    expected_selected_norms: item.expected.selectedNorms,
    expected_excluded_fuel_types: item.expected.excludedFuelTypes,
    expected_excluded_vehicle_groups: item.expected.excludedVehicleGroups,
    expected_excluded_vehicle_classes: item.expected.excludedVehicleClasses,
    expected_excluded_vehicle_categories: item.expected.excludedVehicleCategories,
    expected_excluded_norms: item.expected.excludedNorms,
    notes: item.notes,
  }));
}

const ORACLE_COLUMNS = [
  "case_id", "case_group", "pair_id", "query", "families",
  "expected_state", "expected_rto_contains", "expected_from", "expected_to",
  "expected_fuel_segment", "expected_fuel_type", "expected_fuel_filters",
  "expected_selected_fuel_types", "expected_vehicle_categories",
  "expected_selected_vehicle_categories", "expected_selected_vehicle_groups",
  "expected_vehicle_classes", "expected_selected_vehicle_classes",
  "expected_norms", "expected_selected_norms", "expected_excluded_fuel_types",
  "expected_excluded_vehicle_groups", "expected_excluded_vehicle_classes",
  "expected_excluded_vehicle_categories", "expected_excluded_norms", "notes",
];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function writeFrozenOracle(cases) {
  if (cases.length !== 50) throw new Error(`Oracle must contain exactly 50 cases; found ${cases.length}.`);
  const groups = cases.reduce((counts, item) => {
    counts[item.caseGroup] = (counts[item.caseGroup] ?? 0) + 1;
    return counts;
  }, {});
  if (groups.coverage !== 30 || groups.spelling_shorthand !== 10 || groups.paraphrase !== 10) {
    throw new Error(`Oracle mix must be 30 coverage, 10 spelling/shorthand, 10 paraphrase; found ${JSON.stringify(groups)}.`);
  }
  const ids = new Set(cases.map((item) => item.caseId));
  const queries = new Set(cases.map((item) => item.query.toLowerCase()));
  if (ids.size !== 50 || queries.size !== 50) throw new Error("Oracle case IDs and queries must be unique.");
  const csv = toCsv(oracleRows(cases), ORACLE_COLUMNS);
  await fs.mkdir(path.dirname(ORACLE_PATH), { recursive: true });
  const existing = await fs.readFile(ORACLE_PATH, "utf8").catch(() => null);
  if (existing !== null && existing !== csv) {
    throw new Error(`Frozen oracle already exists with different content: ${ORACLE_PATH}`);
  }
  if (existing === null) await fs.writeFile(ORACLE_PATH, csv, "utf8");
  return { path: ORACLE_PATH, sha256: sha256(csv), bytes: Buffer.byteLength(csv) };
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeRtoCode(value) {
  return normalize(value).replaceAll(" ", "");
}

function normalizedArray(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(normalize).filter(Boolean))].sort();
}

function sameArray(left, right) {
  return JSON.stringify(normalizedArray(left)) === JSON.stringify(normalizedArray(right));
}

function actualFilterSnapshot(filters = {}) {
  return {
    state: filters.state ?? "",
    rto: filters.rto ?? "",
    from: filters.from ?? "",
    to: filters.to ?? "",
    fuelSegment: filters.fuelSegment ?? "",
    fuelType: filters.fuelType ?? "",
    ...Object.fromEntries(ARRAY_FILTER_FIELDS.map((field) => [field, Array.isArray(filters[field]) ? filters[field] : []])),
  };
}

function compareFilters(item, payload) {
  const actual = actualFilterSnapshot(payload?.filters);
  const mismatches = [];
  for (const field of ASSERTED_FILTER_FIELDS) {
    const wanted = item.expected[field];
    const found = actual[field];
    const matches = Array.isArray(wanted)
      ? sameArray(wanted, found)
      : normalize(wanted) === normalize(found);
    if (!matches) {
      mismatches.push({
        field,
        expected: wanted,
        actual: found,
      });
    }
  }
  if (item.expected.rtoContains && !normalizeRtoCode(actual.rto).includes(normalizeRtoCode(item.expected.rtoContains))) {
    mismatches.push({
      field: "rto",
      expected: `contains ${item.expected.rtoContains}`,
      actual: actual.rto,
    });
  }
  if (!item.expected.rtoContains && actual.rto) {
    mismatches.push({ field: "rto", expected: "", actual: actual.rto });
  }
  return { actual, mismatches };
}

function monthRange(from, to) {
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) return [];
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const months = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
    if (months.length > 240) break;
  }
  return months;
}

function canonicalRows(rows) {
  return [...(rows ?? [])]
    .map((row) => ({
      year: Number(row.year),
      month: Number(row.month),
      state: row.state ?? "",
      rto: row.rto ?? "",
      fuel_type: row.fuel_type ?? "",
      fuel_filter: row.fuel_filter ?? "",
      vehicle_category_filter: row.vehicle_category_filter ?? "",
      norms_filter: row.norms_filter ?? "",
      vehicle_class_filter: row.vehicle_class_filter ?? "",
      vehicle_count: Number(row.vehicle_count),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function verifyData(item, payload) {
  const issues = [];
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!Array.isArray(payload?.rows)) issues.push("rows_not_array");
  const duplicateKeys = new Set();
  const seenKeys = new Set();
  const byMonth = new Map();
  const byFuel = new Map();
  let total = 0;

  for (const [index, row] of rows.entries()) {
    const required = [
      "year", "month", "state", "rto", "fuel_type", "fuel_filter",
      "vehicle_category_filter", "norms_filter", "vehicle_class_filter", "vehicle_count",
    ];
    for (const field of required) {
      if (row[field] === null || row[field] === undefined || row[field] === "") {
        issues.push(`row_${index}_missing_${field}`);
      }
    }
    const count = Number(row.vehicle_count);
    if (!Number.isFinite(count) || count < 0) issues.push(`row_${index}_invalid_vehicle_count`);
    else total += count;

    const month = `${Number(row.year)}-${String(Number(row.month)).padStart(2, "0")}`;
    if (item.expected.from && (month < item.expected.from || month > item.expected.to)) {
      issues.push(`row_${index}_outside_date_range`);
    }
    if (item.expected.state && normalize(row.state) !== normalize(item.expected.state)) {
      issues.push(`row_${index}_wrong_state`);
    }
    if (item.expected.rtoContains && !normalizeRtoCode(row.rto).includes(normalizeRtoCode(item.expected.rtoContains))) {
      issues.push(`row_${index}_wrong_rto`);
    }
    if (item.expected.selectedFuelTypes.length && !normalizedArray(item.expected.selectedFuelTypes).includes(normalize(row.fuel_type))) {
      issues.push(`row_${index}_wrong_fuel`);
    }
    const contextChecks = [
      ["vehicle_category_filter", item.expected.vehicleCategories],
      ["norms_filter", item.expected.norms],
      ["vehicle_class_filter", item.expected.vehicleClasses],
    ];
    for (const [field, wanted] of contextChecks) {
      if (wanted.length && !sameArray(wanted, String(row[field] ?? "").split("|"))) {
        issues.push(`row_${index}_wrong_${field}`);
      }
    }

    const key = [
      row.year, row.month, normalize(row.state), normalize(row.rto), normalize(row.fuel_type),
      normalize(row.fuel_filter), normalize(row.vehicle_category_filter),
      normalize(row.norms_filter), normalize(row.vehicle_class_filter),
    ].join("\u0000");
    if (seenKeys.has(key)) duplicateKeys.add(key);
    seenKeys.add(key);
    if (Number.isFinite(count)) {
      byMonth.set(month, (byMonth.get(month) ?? 0) + count);
      byFuel.set(String(row.fuel_type), (byFuel.get(String(row.fuel_type)) ?? 0) + count);
    }
  }
  if (duplicateKeys.size) issues.push(`duplicate_registration_grain_keys:${duplicateKeys.size}`);
  if (Number(payload?.summary?.total) !== total) issues.push(`summary_total_mismatch:${payload?.summary?.total}:${total}`);

  const expectedTrend = [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, count]) => ({ month, count }));
  const actualTrend = (payload?.trend ?? []).map((entry) => ({ month: entry.month, count: Number(entry.count) }));
  if (JSON.stringify(expectedTrend) !== JSON.stringify(actualTrend)) issues.push("trend_mismatch");

  const expectedFuel = Object.fromEntries([...byFuel.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const actualFuel = Object.fromEntries(
    (payload?.fuelBreakdown ?? [])
      .map((entry) => [String(entry.fuelType), Number(entry.count)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  if (JSON.stringify(expectedFuel) !== JSON.stringify(actualFuel)) issues.push("fuel_breakdown_mismatch");

  const expectedPeak = expectedTrend.reduce(
    (best, entry) => (entry.count > (best?.count ?? -1) ? entry : best),
    null,
  );
  if ((payload?.summary?.peakMonth ?? null) !== (expectedPeak?.month ?? null)) issues.push("peak_month_mismatch");
  if (Number(payload?.summary?.peakMonthCount ?? 0) !== Number(expectedPeak?.count ?? 0)) issues.push("peak_month_count_mismatch");

  const wantedMonths = monthRange(item.expected.from, item.expected.to);
  const presentMonths = new Set(expectedTrend.map((entry) => entry.month));
  const missingMonths = wantedMonths.filter((month) => !presentMonths.has(month));
  const acknowledgedMissing = ["partial", "missing", "stale", "fetch_failed", "refreshing"].includes(payload?.dataStatus)
    || (payload?.warnings ?? []).some((warning) => /\b(?:missing|partial|incomplete|stale)\b/i.test(warning));
  if (missingMonths.length && !acknowledgedMissing) issues.push(`missing_months_not_reported:${missingMonths.join("|")}`);
  if (payload?.liveRefresh !== null && payload?.liveRefresh !== undefined) issues.push("live_refresh_was_started");

  return {
    issues: [...new Set(issues)],
    recomputed: {
      total,
      trend: expectedTrend,
      fuelBreakdown: expectedFuel,
      peakMonth: expectedPeak?.month ?? null,
      peakMonthCount: expectedPeak?.count ?? 0,
      missingMonths,
    },
  };
}

async function fileHashes() {
  const hashes = {};
  for (const file of DATA_FILES) {
    const label = path.relative(ROOT, file).replaceAll("\\", "/");
    const content = await fs.readFile(file).catch(() => null);
    hashes[label] = content ? sha256(content) : null;
  }
  return hashes;
}

async function databaseProfile() {
  if (!hasDatabaseUrl()) {
    return { status: "unverified", reason: "DATABASE_URL is not configured.", mode: "select_only" };
  }
  try {
    const profile = await dbQuery(`
      select count(*)::bigint as row_count,
             count(*) filter (where vehicle_count < 0)::bigint as negative_count,
             count(*) filter (
               where year is null or month is null or state is null or state = ''
                  or rto is null or rto = '' or fuel_type is null or fuel_type = ''
                  or fuel_filter is null or vehicle_category_filter is null
                  or norms_filter is null or vehicle_class_filter is null
                  or vehicle_count is null
             )::bigint as missing_required_count,
             min(make_date(year, month, 1))::text as earliest_month,
             max(make_date(year, month, 1))::text as latest_month
        from registrations
    `);
    const duplicates = await dbQuery(`
      select count(*)::bigint as duplicate_group_count
        from (
          select year, month, state, rto, fuel_type, fuel_filter,
                 vehicle_category_filter, norms_filter, vehicle_class_filter
            from registrations
           group by year, month, state, rto, fuel_type, fuel_filter,
                    vehicle_category_filter, norms_filter, vehicle_class_filter
          having count(*) > 1
        ) duplicate_groups
    `);
    const row = profile.rows[0] ?? {};
    return {
      status: "verified",
      mode: "select_only",
      rowCount: Number(row.row_count ?? 0),
      negativeCount: Number(row.negative_count ?? 0),
      missingRequiredCount: Number(row.missing_required_count ?? 0),
      duplicateGroupCount: Number(duplicates.rows[0]?.duplicate_group_count ?? 0),
      earliestMonth: row.earliest_month ?? null,
      latestMonth: row.latest_month ?? null,
    };
  } catch (error) {
    return { status: "unverified", reason: error.message, mode: "select_only" };
  }
}

function safeServerEnvironment(lane, port) {
  return {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "development",
    AI_QUERY_PROVIDER: lane === "groq" ? "groq" : "none",
    GROQ_AI_MIN_INTERVAL_MS: "30000",
    GROQ_AI_CACHE_TTL_MS: "86400000",
    GROQ_AI_RATE_LIMIT_COOLDOWN_MS: "300000",
    RATE_LIMIT_STORE: "memory",
    ALLOW_IN_MEMORY_RATE_LIMIT: "1",
    EXPENSIVE_RATE_LIMIT_MAX: "10000",
    EXPENSIVE_RATE_LIMIT_GLOBAL_MAX: "10000",
    MAX_EXPENSIVE_CONCURRENCY: "1",
    VAHAN_DISABLE_LIVE_REFRESH: "1",
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_ALLOWED_CHAT_IDS: "",
    TELEGRAM_ENABLE_POLLING: "0",
    TELEGRAM_SUMMARY_FETCH_MISSING: "0",
    TELEGRAM_PUBLIC_DAILY_LIMIT: "0",
    FACTOR_AGENT_ENABLED: "0",
  };
}

async function waitForServer(port, child) {
  const url = `http://127.0.0.1:${port}/health`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (child.exitCode !== null) throw new Error(`Audit server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Startup races are expected for a few polling intervals.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for audit server on port ${port}.`);
}

async function startServer(lane, port) {
  const logs = [];
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: safeServerEnvironment(lane, port),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const capture = (stream, label) => {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      logs.push(...String(chunk).split(/\r?\n/).filter(Boolean).map((line) => `[${label}] ${line}`));
      if (logs.length > 200) logs.splice(0, logs.length - 200);
    });
  };
  capture(child.stdout, "stdout");
  capture(child.stderr, "stderr");
  try {
    await waitForServer(port, child);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n${logs.join("\n")}`);
  }
  return { child, logs };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill();
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function postQuery(port, query) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: `Non-JSON response: ${text.slice(0, 500)}` };
    }
    return {
      httpStatus: response.status,
      ok: response.ok,
      body,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
    };
  } catch (error) {
    return {
      httpStatus: null,
      ok: false,
      body: { error: error.message },
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
    };
  }
}

function providerWasInconclusive(lane, payload) {
  return lane === "groq" && payload?.filters?.aiProvider !== "Groq";
}

function classify({ apiResult, filterMismatches, dataIssues, providerInconclusive }) {
  if (!apiResult.ok) return "api_error";
  if (filterMismatches.length) return "filter_mismatch";
  if (dataIssues.length) return "data_inconsistency";
  if (providerInconclusive) return "provider_inconclusive";
  return "pass";
}

function resultFor(item, lane, apiResult, groqCallAttempted) {
  if (!apiResult.ok) {
    return {
      caseId: item.caseId,
      caseGroup: item.caseGroup,
      pairId: item.pairId,
      families: item.families,
      query: item.query,
      expected: item.expected,
      lane,
      classification: "api_error",
      providerFallback: lane === "groq",
      groqCallAttempted,
      httpStatus: apiResult.httpStatus,
      filterMismatches: [],
      dataIssues: [],
      actualFilters: null,
      warnings: [],
      dataStatus: null,
      summaryTotal: null,
      rowCount: null,
      evidence: apiResult,
    };
  }
  const filterCheck = compareFilters(item, apiResult.body);
  const dataCheck = verifyData(item, apiResult.body);
  const providerInconclusive = providerWasInconclusive(lane, apiResult.body);
  const blockedBeforeGroqCall = lane === "groq" && (apiResult.body.warnings ?? []).some(
    (warning) => /quota reserve|cooling down between dashboard queries/i.test(warning),
  );
  return {
    caseId: item.caseId,
    caseGroup: item.caseGroup,
    pairId: item.pairId,
    families: item.families,
    query: item.query,
    expected: item.expected,
    lane,
    classification: classify({
      apiResult,
      filterMismatches: filterCheck.mismatches,
      dataIssues: dataCheck.issues,
      providerInconclusive,
    }),
    providerFallback: providerInconclusive,
    groqCallAttempted: groqCallAttempted && !blockedBeforeGroqCall,
    httpStatus: apiResult.httpStatus,
    filterMismatches: filterCheck.mismatches,
    dataIssues: dataCheck.issues,
    actualFilters: filterCheck.actual,
    warnings: apiResult.body.warnings ?? [],
    dataStatus: apiResult.body.dataStatus ?? null,
    summaryTotal: apiResult.body.summary?.total ?? null,
    rowCount: apiResult.body.rows?.length ?? null,
    recomputed: dataCheck.recomputed,
    evidence: apiResult,
  };
}

export function groqPauseFromWarnings(warnings, now = Date.now()) {
  for (const warning of warnings ?? []) {
    const quotaMatch = String(warning).match(
      /Groq (request|token) quota reserve is active until ([^;]+);/i,
    );
    const rateLimitMatch = String(warning).match(
      /Groq is temporarily rate-limited until ([^;]+);/i,
    );
    const kind = quotaMatch?.[1]?.toLowerCase() ?? (rateLimitMatch ? "rate_limit" : null);
    const resetText = quotaMatch?.[2] ?? rateLimitMatch?.[1];
    const resetAt = Date.parse(resetText ?? "");
    if (kind && Number.isFinite(resetAt)) {
      return {
        kind,
        resetAt: Math.max(now, resetAt),
        warning: String(warning),
      };
    }
  }
  return null;
}

async function waitForGroqReset(pause, checkpoint) {
  const resumeAt = pause.resetAt + 250;
  checkpoint.groqPauseUntil = new Date(resumeAt).toISOString();
  checkpoint.quotaPauses = [
    ...(checkpoint.quotaPauses ?? []),
    {
      kind: pause.kind,
      observedAt: new Date().toISOString(),
      resetAt: new Date(pause.resetAt).toISOString(),
    },
  ];
  await saveCheckpoint(checkpoint);
  const waitMs = Math.max(0, resumeAt - Date.now());
  console.log(`[groq] ${pause.kind} quota pause; continuing at ${new Date(resumeAt).toISOString()}`);
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  checkpoint.groqPauseUntil = null;
  await saveCheckpoint(checkpoint);
}

async function loadCheckpoint(oracleHash, resume) {
  if (!resume) return { version: 1, oracleSha256: oracleHash, results: [] };
  const checkpoint = JSON.parse(await fs.readFile(CHECKPOINT_PATH, "utf8").catch(() => '{"results":[]}'));
  if (checkpoint.oracleSha256 && checkpoint.oracleSha256 !== oracleHash) {
    throw new Error("Checkpoint belongs to a different oracle file.");
  }
  return { ...checkpoint, version: 1, oracleSha256: oracleHash, results: checkpoint.results ?? [] };
}

async function saveCheckpoint(checkpoint) {
  await fs.mkdir(path.dirname(CHECKPOINT_PATH), { recursive: true });
  const temporary = `${CHECKPOINT_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  await fs.rename(temporary, CHECKPOINT_PATH);
}

function canSkipCheckpointResult(result) {
  if (!result) return false;
  if (result.lane === "rules") return true;
  return result.groqCallAttempted === true || result.classification !== "provider_inconclusive";
}

async function runLane({ lane, port, cases, checkpoint }) {
  const existingByCase = new Map(
    checkpoint.results
      .filter((result) => result.lane === lane)
      .map((result) => [result.caseId, result]),
  );
  const callsAlreadyAttempted = checkpoint.results.filter(
    (result) => result.lane === "groq" && result.groqCallAttempted,
  ).length;
  let groqAttemptCount = callsAlreadyAttempted;
  let lastGroqQueryAt = 0;
  let callCapReached = false;
  const server = await startServer(lane, port);
  try {
    if (lane === "groq" && Date.parse(checkpoint.groqPauseUntil ?? "") > Date.now()) {
      await waitForGroqReset({
        kind: "checkpoint",
        resetAt: Date.parse(checkpoint.groqPauseUntil),
      }, checkpoint);
    }
    for (const [index, item] of cases.entries()) {
      const prior = existingByCase.get(item.caseId);
      if (canSkipCheckpointResult(prior)) {
        console.log(`[${lane}] ${index + 1}/50 ${item.caseId} checkpoint`);
        continue;
      }
      while (true) {
        if (lane === "groq" && groqAttemptCount >= GROQ_CALL_CAP) {
          callCapReached = true;
          break;
        }
        if (lane === "groq" && lastGroqQueryAt) {
          const delay = Math.max(0, GROQ_INTERVAL_MS - (Date.now() - lastGroqQueryAt));
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        }
        console.log(`[${lane}] ${index + 1}/50 ${item.caseId} running`);
        const groqCallCandidate = lane === "groq";
        const requestStartedAt = Date.now();
        const apiResult = await postQuery(port, item.query);
        const result = resultFor(item, lane, apiResult, groqCallCandidate);
        if (result.groqCallAttempted) {
          groqAttemptCount += 1;
          lastGroqQueryAt = requestStartedAt;
        }
        checkpoint.results = checkpoint.results.filter(
          (candidate) => !(candidate.lane === lane && candidate.caseId === item.caseId),
        );
        checkpoint.results.push(result);
        checkpoint.updatedAt = new Date().toISOString();
        checkpoint.groqAttemptCount = groqAttemptCount;
        await saveCheckpoint(checkpoint);
        console.log(`[${lane}] ${item.caseId} ${result.classification}`);
        const pause = lane === "groq" ? groqPauseFromWarnings(result.warnings) : null;
        if (!pause) break;
        await waitForGroqReset(pause, checkpoint);
      }
      if (callCapReached) {
        break;
      }
    }
  } finally {
    await stopServer(server);
  }
  if (callCapReached) {
    for (const item of cases) {
      if (checkpoint.results.some((result) => result.lane === lane && result.caseId === item.caseId)) continue;
      checkpoint.results.push({
        caseId: item.caseId,
        caseGroup: item.caseGroup,
        pairId: item.pairId,
        families: item.families,
        query: item.query,
        expected: item.expected,
        lane,
        classification: "provider_inconclusive",
        providerFallback: true,
        groqCallAttempted: false,
        httpStatus: null,
        filterMismatches: [],
        dataIssues: [],
        actualFilters: null,
        warnings: ["Groq lane stopped before this case because the 50-call cap was reached."],
        dataStatus: null,
        summaryTotal: null,
        rowCount: null,
        evidence: null,
      });
    }
    checkpoint.updatedAt = new Date().toISOString();
    checkpoint.groqAttemptCount = groqAttemptCount;
    await saveCheckpoint(checkpoint);
  }
  checkpoint.serverLogs = {
    ...(checkpoint.serverLogs ?? {}),
    [lane]: server.logs,
  };
  return { callCapReached, groqAttemptCount };
}

function canonicalPairFilter(result) {
  if (!result.actualFilters) return null;
  return Object.fromEntries([
    ...["state", "rto", "from", "to", "fuelSegment", "fuelType"].map(
      (field) => [field, normalize(result.actualFilters[field])],
    ),
    ...ARRAY_FILTER_FIELDS.map((field) => [field, normalizedArray(result.actualFilters[field])]),
  ]);
}

function applyPairChecks(results) {
  const pairIssues = [];
  for (const result of results) {
    result.filterMismatches = result.filterMismatches.filter((issue) => issue.field !== "paraphrase_pair");
    result.dataIssues = result.dataIssues.filter((issue) => !issue.startsWith("paraphrase_pair_result_mismatch:"));
    if (result.evidence) {
      result.classification = classify({
        apiResult: result.evidence,
        filterMismatches: result.filterMismatches,
        dataIssues: result.dataIssues,
        providerInconclusive: result.providerFallback,
      });
    }
  }
  const lanes = [...new Set(results.map((result) => result.lane))];
  for (const lane of lanes) {
    const pairIds = [...new Set(results.filter((result) => result.lane === lane).map((result) => result.pairId).filter(Boolean))];
    for (const pairId of pairIds) {
      const pair = results.filter((result) => result.lane === lane && result.pairId === pairId);
      if (pair.length !== 2 || pair.some((result) => !result.evidence?.ok)) continue;
      const [first, second] = pair;
      const sameFilters = JSON.stringify(canonicalPairFilter(first)) === JSON.stringify(canonicalPairFilter(second));
      const sameRows = JSON.stringify(canonicalRows(first.evidence.body.rows)) === JSON.stringify(canonicalRows(second.evidence.body.rows));
      const sameTotal = Number(first.summaryTotal) === Number(second.summaryTotal);
      if (!sameFilters) {
        pairIssues.push({ lane, pairId, type: "filter_mismatch", cases: pair.map((result) => result.caseId) });
        for (const result of pair) {
          result.filterMismatches.push({ field: "paraphrase_pair", expected: "identical filters", actual: `differs in ${pairId}` });
          if (result.classification !== "api_error") result.classification = "filter_mismatch";
        }
      }
      if (!sameRows || !sameTotal) {
        pairIssues.push({ lane, pairId, type: "data_inconsistency", cases: pair.map((result) => result.caseId) });
        for (const result of pair) {
          result.dataIssues.push(`paraphrase_pair_result_mismatch:${pairId}`);
          if (!["api_error", "filter_mismatch"].includes(result.classification)) result.classification = "data_inconsistency";
        }
      }
    }
  }
  return pairIssues;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function familyRates(results) {
  const familyMap = new Map();
  for (const result of results) {
    for (const family of result.families) {
      const key = `${result.lane}:${family}`;
      const entry = familyMap.get(key) ?? {
        lane: result.lane,
        family,
        total: 0,
        conclusive: 0,
        inconclusive: 0,
        pass: 0,
      };
      entry.total += 1;
      if (result.classification === "pass") entry.pass += 1;
      if (result.classification === "provider_inconclusive") entry.inconclusive += 1;
      else entry.conclusive += 1;
      familyMap.set(key, entry);
    }
  }
  return [...familyMap.values()]
    .map((entry) => ({ ...entry, passRate: entry.conclusive ? entry.pass / entry.conclusive : null }))
    .sort((left, right) => left.lane.localeCompare(right.lane) || left.family.localeCompare(right.family));
}

function followUpRows(results) {
  const failures = results.filter((result) => !["pass", "provider_inconclusive"].includes(result.classification));
  const failingFamilies = [...new Set(failures.flatMap((result) => result.families))];
  return failingFamilies.flatMap((family) => {
    const examples = failures.filter((result) => result.families.includes(family)).slice(0, 3);
    return examples.map((result, index) => ({
      follow_up_id: `FU-${family.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${index + 1}`,
      family,
      source_case_id: result.caseId,
      lane: result.lane,
      source_classification: result.classification,
      suggested_query: result.query.replace(/\bShow\b/i, index % 2 ? "Return" : "How many"),
      purpose: `Target the ${family} failure with controlled wording while retaining the same independent expected filters.`,
      execution_status: "not_run_to_preserve_50_call_groq_cap",
    }));
  });
}

function flattenResult(result) {
  return {
    case_id: result.caseId,
    case_group: result.caseGroup,
    pair_id: result.pairId,
    lane: result.lane,
    classification: result.classification,
    provider_fallback: result.providerFallback,
    groq_call_attempted: result.groqCallAttempted,
    http_status: result.httpStatus,
    families: result.families,
    query: result.query,
    expected_state: result.expected.state,
    actual_state: result.actualFilters?.state ?? "",
    expected_rto_contains: result.expected.rtoContains,
    actual_rto: result.actualFilters?.rto ?? "",
    expected_from: result.expected.from,
    actual_from: result.actualFilters?.from ?? "",
    expected_to: result.expected.to,
    actual_to: result.actualFilters?.to ?? "",
    expected_fuel_segment: result.expected.fuelSegment,
    actual_fuel_segment: result.actualFilters?.fuelSegment ?? "",
    expected_fuel_type: result.expected.fuelType,
    actual_fuel_type: result.actualFilters?.fuelType ?? "",
    expected_selected_fuel_types: result.expected.selectedFuelTypes,
    actual_selected_fuel_types: result.actualFilters?.selectedFuelTypes ?? [],
    expected_vehicle_categories: result.expected.vehicleCategories,
    actual_vehicle_categories: result.actualFilters?.vehicleCategories ?? [],
    expected_vehicle_classes: result.expected.vehicleClasses,
    actual_vehicle_classes: result.actualFilters?.vehicleClasses ?? [],
    expected_norms: result.expected.norms,
    actual_norms: result.actualFilters?.norms ?? [],
    filter_mismatches: result.filterMismatches.map((issue) => `${issue.field}:${JSON.stringify(issue.expected)}=>${JSON.stringify(issue.actual)}`),
    data_issues: result.dataIssues,
    warnings: result.warnings,
    data_status: result.dataStatus,
    summary_total: result.summaryTotal,
    row_count: result.rowCount,
  };
}

const RESULT_COLUMNS = [
  "case_id", "case_group", "pair_id", "lane", "classification", "provider_fallback",
  "groq_call_attempted", "http_status", "families", "query", "expected_state", "actual_state",
  "expected_rto_contains", "actual_rto", "expected_from", "actual_from", "expected_to", "actual_to",
  "expected_fuel_segment", "actual_fuel_segment", "expected_fuel_type", "actual_fuel_type",
  "expected_selected_fuel_types", "actual_selected_fuel_types",
  "expected_vehicle_categories", "actual_vehicle_categories",
  "expected_vehicle_classes", "actual_vehicle_classes", "expected_norms", "actual_norms",
  "filter_mismatches", "data_issues", "warnings", "data_status", "summary_total", "row_count",
];

function markdownReport(report) {
  const classifications = countBy(report.results, (result) => `${result.lane}:${result.classification}`);
  const lines = [
    "# Query Filter Audit",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Outcome",
    "",
    `- Frozen oracle: 50 unique cases (30 coverage, 10 spelling/shorthand, 10 paired paraphrases).`,
    `- Groq calls: ${report.groqAttemptCount}/${GROQ_CALL_CAP}; quota pauses: ${report.groqQuotaPauseCount}; call-cap stop: ${report.groqCallCapReached ? "yes" : "no"}.`,
    `- Database consistency: ${report.database.status}${report.database.reason ? ` (${report.database.reason})` : ""}.`,
    `- Live VAHAN source accuracy: not verified by this audit.`,
    "",
    "## Classification counts",
    "",
    "| Lane | Classification | Count |",
    "|---|---:|---:|",
    ...Object.entries(classifications)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => {
        const [lane, classification] = key.split(":");
        return `| ${lane} | ${classification} | ${count} |`;
      }),
    "",
    "## Pass rates by filter family",
    "",
    "| Lane | Family | Passed | Conclusive | Inconclusive | Pass rate |",
    "|---|---|---:|---:|---:|---:|",
    ...report.familyRates.map((entry) =>
      `| ${entry.lane} | ${entry.family} | ${entry.pass} | ${entry.conclusive} | ${entry.inconclusive} | ${entry.passRate === null ? "N/A" : `${(entry.passRate * 100).toFixed(1)}%`} |`,
    ),
    "",
    "## Safety and evidence",
    "",
    `- API execution used POST /api/query with concurrency 1.`,
    `- Groq spacing was at least 30 seconds and cache TTL was 24 hours. Quota retries occur only after the reported reset timestamp.`,
    `- Live refresh was disabled and every response was checked for an unexpected refresh job.`,
    `- Telegram was disabled and API rate limiting used in-memory state.`,
    `- The audit database code issued SELECT statements only.`,
    `- VAHAN data-file hashes were unchanged: ${report.safety.dataFilesUnchanged ? "yes" : "no"}.`,
    "",
    "## Scope limits",
    "",
    "Passing cases show consistency for this sample; they do not prove the parser or stored data is error-free. Zero rows are evaluated separately from semantic filter correctness. Counts were not compared with the official VAHAN website.",
    "",
    `Targeted follow-up cases generated for failing families: ${report.followUps.length}. They were not sent to Groq, preserving the 50-call cap.`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function writeReports(report) {
  const orderedResults = [...report.results].sort(
    (left, right) => left.lane.localeCompare(right.lane) || left.caseId.localeCompare(right.caseId),
  );
  report.results = orderedResults;
  const resultCsv = toCsv(orderedResults.map(flattenResult), RESULT_COLUMNS);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = markdownReport(report);
  await fs.mkdir(path.dirname(REPORT_PREFIX), { recursive: true });
  await Promise.all([
    fs.writeFile(`${REPORT_PREFIX}.csv`, resultCsv, "utf8"),
    fs.writeFile(`${REPORT_PREFIX}.json`, json, "utf8"),
    fs.writeFile(`${REPORT_PREFIX}.md`, markdown, "utf8"),
    fs.writeFile(
      `${REPORT_PREFIX}-follow-ups.csv`,
      toCsv(report.followUps, ["follow_up_id", "family", "source_case_id", "lane", "source_classification", "suggested_query", "purpose", "execution_status"]),
      "utf8",
    ),
  ]);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const cases = frozenOracleCases();
  const oracle = await writeFrozenOracle(cases);
  console.log(`Frozen oracle: ${oracle.path} (${oracle.sha256})`);
  if (options.generateOnly) return;

  const beforeHashes = await fileHashes();
  const database = await databaseProfile();
  const checkpoint = await loadCheckpoint(oracle.sha256, options.resume);
  if (checkpoint.groqQuotaStopped && !(checkpoint.quotaPauses?.length)) {
    checkpoint.quotaPauses = [{
      kind: "historical_unknown",
      observedAt: checkpoint.updatedAt ?? new Date().toISOString(),
      resetAt: null,
    }];
  }
  for (const result of checkpoint.results) {
    result.warnings = (result.warnings ?? []).map((warning) =>
      /stopped before this case to preserve the quota reserve/i.test(warning)
        ? "Groq lane paused before this case; resume from the checkpoint after the quota reset."
        : warning,
    );
  }
  let groqCallCapReached = false;
  let groqAttemptCount = checkpoint.results.filter((result) => result.lane === "groq" && result.groqCallAttempted).length;

  if (!options.reportOnly) {
    for (const [laneIndex, lane] of options.lanes.entries()) {
      const laneResult = await runLane({
        lane,
        port: options.basePort + laneIndex,
        cases,
        checkpoint,
      });
      groqCallCapReached ||= laneResult.callCapReached;
      groqAttemptCount = Math.max(groqAttemptCount, laneResult.groqAttemptCount);
    }
  } else {
    groqCallCapReached = Boolean(checkpoint.groqCallCapReached);
  }

  const selectedResults = checkpoint.results.filter((result) => options.lanes.includes(result.lane));
  for (const result of selectedResults) {
    if (
      result.lane === "groq"
      && result.warnings?.some((warning) => /quota reserve|cooling down between dashboard queries/i.test(warning))
    ) {
      result.groqCallAttempted = false;
    }
  }
  groqAttemptCount = checkpoint.results.filter(
    (result) => result.lane === "groq" && result.groqCallAttempted,
  ).length;
  const pairIssues = applyPairChecks(selectedResults);
  const afterHashes = await fileHashes();
  const followUps = followUpRows(selectedResults);
  const report = {
    audit: "quota-safe-groq-and-50-query-data-audit",
    version: 1,
    generatedAt: new Date().toISOString(),
    oracle,
    configuration: {
      lanes: options.lanes,
      groqCallCap: GROQ_CALL_CAP,
      groqMinimumIntervalMs: 30_000,
      groqRunnerIntervalMs: GROQ_INTERVAL_MS,
      groqCacheTtlMs: 86_400_000,
      concurrency: 1,
      liveRefreshDisabled: true,
      telegramDisabled: true,
      rateLimitStore: "memory",
      databaseAccess: "select_only",
    },
    groqAttemptCount,
    groqQuotaStopped: false,
    groqQuotaPauseCount: checkpoint.quotaPauses?.length ?? 0,
    groqCallCapReached,
    database,
    pairIssues,
    results: selectedResults,
    familyRates: familyRates(selectedResults),
    followUps,
    safety: {
      auditDatabaseStatements: "SELECT only",
      liveRefreshDisabled: true,
      telegramDisabled: true,
      activeScraperInteractedWith: false,
      dataFileHashesBefore: beforeHashes,
      dataFileHashesAfter: afterHashes,
      dataFilesUnchanged: JSON.stringify(beforeHashes) === JSON.stringify(afterHashes),
      officialVahanSourceCompared: false,
    },
  };
  await writeReports(report);
  checkpoint.results = checkpoint.results.map((result) => selectedResults.find(
    (selected) => selected.lane === result.lane && selected.caseId === result.caseId,
  ) ?? result);
  checkpoint.updatedAt = new Date().toISOString();
  checkpoint.groqAttemptCount = groqAttemptCount;
  checkpoint.groqQuotaStopped = false;
  checkpoint.groqCallCapReached = groqCallCapReached;
  await saveCheckpoint(checkpoint);

  console.log(JSON.stringify({
    oracle: oracle.path,
    reports: [`${REPORT_PREFIX}.csv`, `${REPORT_PREFIX}.json`, `${REPORT_PREFIX}.md`],
    classifications: countBy(selectedResults, (result) => `${result.lane}:${result.classification}`),
    groqAttemptCount,
    groqQuotaPauseCount: checkpoint.quotaPauses?.length ?? 0,
    groqCallCapReached,
    database: database.status,
    dataFilesUnchanged: report.safety.dataFilesUnchanged,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(error.stack ?? error.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}
