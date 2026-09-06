import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { closePool, hasDatabaseUrl, query as dbQuery } from "../lib/db.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const CORPUS_PATH = path.join(ROOT, "data", "query-tests", "dashboard-query-contract-v1.json");
const LEGACY_ORACLE_PATH = path.join(
  ROOT,
  "data",
  "query-audits",
  "random-filter-oracle-2026-07-30.csv",
);
const LEGACY_ORACLE_SHA256 = "0f3b1865d0579a70dabce11b919b618fd5225034ba06a7af32813292e5fa1d5c";
const LEGACY_BASELINE_PASS_IDS = [
  "Q001", "Q002", "Q003", "Q004", "Q005", "Q006", "Q007", "Q008", "Q010", "Q011",
  "Q012", "Q013", "Q014", "Q015", "Q016", "Q017", "Q018", "Q019", "Q020", "Q021",
  "Q023", "Q024", "Q025", "Q029", "Q032", "Q033", "Q034", "Q035", "Q036", "Q037",
  "Q038", "Q039", "Q041", "Q042", "Q043", "Q045", "Q046", "Q048",
];
const LEGACY_BASELINE_MISMATCH_IDS = [
  "Q009", "Q022", "Q026", "Q027", "Q028", "Q030",
  "Q031", "Q040", "Q044", "Q047", "Q049", "Q050",
];

const CANONICAL_FILTER_FIELDS = [
  "state",
  "rtoContains",
  "from",
  "to",
  "metric",
  "fuelSegment",
  "fuelType",
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

const ARRAY_FILTER_FIELDS = CANONICAL_FILTER_FIELDS.filter((field) => (
  field.endsWith("s") || field === "fuelFilters"
)).filter((field) => !["state", "rtoContains"].includes(field));

const AXES = ["G", "D", "F", "V", "N", "X"];
const REQUIRED_ATOMIC_MODES = [
  "G:state",
  "G:rto",
  "D:month",
  "D:range",
  "F:exact",
  "F:family",
  "V:group",
  "V:category",
  "V:class",
  "N:norm",
  "X:fuel",
  "X:category",
  "X:class",
  "X:norm",
];
const ROUTING_POLICIES = new Set(["local_required", "local_reject", "groq_allowed"]);

const TWO_WHEELER = ["TWO WHEELER(NT)", "TWO WHEELER(T)"];
const THREE_WHEELER = ["THREE WHEELER(NT)", "THREE WHEELER(T)"];
const FOUR_WHEELER = ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"];
const BATTERY_EV = ["ELECTRIC(BOV)", "PURE EV"];
const LPG_FAMILY = ["LPG ONLY", "PETROL/LPG", "PETROL(E20)/LPG"];
const HYBRID_FAMILY = [
  "DIESEL/HYBRID",
  "PETROL(E20)/HYBRID",
  "PETROL(E20)/HYBRID/CNG",
  "PETROL/HYBRID",
  "PETROL/HYBRID/CNG",
  "PLUG-IN HYBRID EV",
  "STRONG HYBRID EV",
];

const DATA_FILES = [
  path.join(ROOT, "data", "vahan", "vahan_fuel_monthly.csv"),
  path.join(ROOT, "data", "vahan", "vahan_fuel_monthly_errors.jsonl"),
  path.join(ROOT, "data", "vahan", "vahan_fuel_monthly_summary.json"),
  path.join(ROOT, "data", "vahan", "rto_catalog.json"),
];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeRto(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function unique(values) {
  return [...new Set((values ?? []).filter((value) => value !== null && value !== undefined))];
}

function canonicalFilters(overrides = {}) {
  const result = {
    state: null,
    rtoContains: null,
    from: null,
    to: null,
    metric: "registrations",
    fuelSegment: null,
    fuelType: null,
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
    ...overrides,
  };
  for (const field of ARRAY_FILTER_FIELDS) result[field] = unique(result[field]);
  return result;
}

function mergeFilters(...patches) {
  const result = canonicalFilters();
  for (const patch of patches) {
    for (const [field, value] of Object.entries(patch ?? {})) {
      result[field] = ARRAY_FILTER_FIELDS.includes(field)
        ? unique([...(result[field] ?? []), ...(value ?? [])])
        : value;
    }
  }
  return canonicalFilters(result);
}

function routing(policy) {
  return {
    policy,
    groqPolicy: policy === "groq_allowed" ? "allowed" : "forbidden",
    maxGroqCalls: policy === "groq_allowed" ? 1 : 0,
  };
}

function successCase({
  id,
  query,
  filters = {},
  axes = [],
  modes = [],
  combination,
  surface = ["canonical"],
  policy = "local_required",
  activationPhase = 1,
  phase1Gate = false,
  equivalenceSetId = null,
  source = "phase-1-authored",
  notes = null,
  legacy = null,
}) {
  return {
    caseId: id,
    classification: "supported",
    query: compact(query),
    coverage: {
      axes: unique(axes),
      modes: unique(modes),
      combination,
      surface: unique(surface),
      equivalenceSetId,
    },
    routing: routing(policy),
    activationPhase,
    phase1Gate,
    expected: {
      httpStatus: 200,
      error: null,
      canonicalFilters: canonicalFilters(filters),
      data: {
        allowZeroRows: true,
        assertRowsObeyFilters: true,
        recomputeAggregations: true,
      },
    },
    provenance: {
      source,
      rationale: source === "legacy-oracle"
        ? "Expected filters were frozen independently before Phase 1."
        : "Expected filters were authored from the Phase 1 contract, not the parser under test.",
    },
    notes,
    legacy,
  };
}

function errorCase({
  id,
  query,
  filters = {},
  axes = [],
  modes = [],
  combination,
  surface = ["canonical"],
  activationPhase,
  phase1Gate = false,
  httpStatus,
  code = null,
  intent = null,
  messageIncludes,
  notes = null,
}) {
  return {
    caseId: id,
    classification: "rejected",
    query: compact(query),
    coverage: {
      axes: unique(axes),
      modes: unique(modes),
      combination,
      surface: unique(surface),
      equivalenceSetId: null,
    },
    routing: routing("local_reject"),
    activationPhase,
    phase1Gate,
    expected: {
      httpStatus,
      error: {
        code,
        intent,
        messageIncludes,
      },
      canonicalFilters: canonicalFilters(filters),
      data: {
        allowZeroRows: true,
        assertRowsObeyFilters: false,
        recomputeAggregations: false,
      },
    },
    provenance: {
      source: "phase-1-authored",
      rationale: "The rejection rule and recognized filters were authored from the Phase 1 contract.",
    },
    notes,
    legacy: null,
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  const [headers, ...dataRows] = rows.filter((candidate) => candidate.some((value) => value !== ""));
  return dataRows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function listCell(value) {
  return compact(value) ? String(value).split("|").map(compact).filter(Boolean) : [];
}

function legacyAxes(families) {
  const axes = [];
  const familySet = new Set(families);
  if (familySet.has("geography") || familySet.has("rto")) axes.push("G");
  if (familySet.has("date")) axes.push("D");
  if (familySet.has("fuel")) axes.push("F");
  if (familySet.has("group") || familySet.has("category") || familySet.has("class")) axes.push("V");
  if (familySet.has("norm")) axes.push("N");
  if (familySet.has("exclusion")) axes.push("X");
  return axes;
}

function legacyModes(row, families) {
  const modes = [];
  if (families.includes("rto")) modes.push("G:rto");
  else if (families.includes("geography")) modes.push("G:state");
  if (families.includes("date")) modes.push(row.expected_from === row.expected_to ? "D:month" : "D:range");
  if (families.includes("fuel")) {
    modes.push(listCell(row.expected_selected_fuel_types).length > 1 ? "F:family" : "F:exact");
  }
  if (families.includes("group")) modes.push("V:group");
  else if (families.includes("category")) modes.push("V:category");
  else if (families.includes("class")) modes.push("V:class");
  if (families.includes("norm")) modes.push("N:norm");
  if (families.includes("exclusion")) modes.push("X:fuel");
  return modes;
}

function legacyFilters(row) {
  return canonicalFilters({
    state: compact(row.expected_state) || null,
    rtoContains: compact(row.expected_rto_contains) || null,
    from: compact(row.expected_from) || null,
    to: compact(row.expected_to) || null,
    fuelSegment: compact(row.expected_fuel_segment) || null,
    fuelType: compact(row.expected_fuel_type) || null,
    fuelFilters: listCell(row.expected_fuel_filters),
    selectedFuelTypes: listCell(row.expected_selected_fuel_types),
    vehicleCategories: listCell(row.expected_vehicle_categories),
    selectedVehicleCategories: listCell(row.expected_selected_vehicle_categories),
    selectedVehicleGroups: listCell(row.expected_selected_vehicle_groups),
    vehicleClasses: listCell(row.expected_vehicle_classes),
    selectedVehicleClasses: listCell(row.expected_selected_vehicle_classes),
    norms: listCell(row.expected_norms),
    selectedNorms: listCell(row.expected_selected_norms),
    excludedFuelTypes: listCell(row.expected_excluded_fuel_types),
    excludedVehicleGroups: listCell(row.expected_excluded_vehicle_groups),
    excludedVehicleClasses: listCell(row.expected_excluded_vehicle_classes),
    excludedVehicleCategories: listCell(row.expected_excluded_vehicle_categories),
    excludedNorms: listCell(row.expected_excluded_norms),
  });
}

function legacyRoutingPolicy(row) {
  const id = row.case_id;
  if (["Q031", "Q032", "Q034", "Q035", "Q040"].includes(id)) return "groq_allowed";
  return "local_required";
}

function legacyActivationPhase(row) {
  if (LEGACY_BASELINE_PASS_IDS.includes(row.case_id)) return 1;
  if (row.case_group === "spelling_shorthand") return 4;
  return 3;
}

function legacyCases(rows) {
  return rows.map((row) => {
    const families = listCell(row.families);
    const baselineCanonicalResult = LEGACY_BASELINE_PASS_IDS.includes(row.case_id)
      ? "pass"
      : "filter_mismatch";
    return successCase({
      id: `LEGACY-${row.case_id}`,
      query: row.query,
      filters: legacyFilters(row),
      axes: legacyAxes(families),
      modes: legacyModes(row, families),
      combination: "legacy_50",
      surface: unique(["legacy", row.case_group, ...families]),
      policy: legacyRoutingPolicy(row),
      activationPhase: legacyActivationPhase(row),
      equivalenceSetId: compact(row.pair_id) || null,
      source: "legacy-oracle",
      notes: compact(row.notes) || null,
      legacy: {
        originalCaseId: row.case_id,
        originalPairId: compact(row.pair_id) || null,
        originalGroup: row.case_group,
        baselineCanonicalResult,
      },
    });
  });
}

const MODE_DEFINITIONS = {
  "G:state": {
    phrase: "in Maharashtra",
    filters: { state: "Maharashtra" },
  },
  "G:rto": {
    phrase: "at MH-12 RTO",
    filters: { state: "Maharashtra", rtoContains: "MH-12" },
  },
  "D:month": {
    phrase: "during January 2025",
    filters: { from: "2025-01", to: "2025-01" },
  },
  "D:range": {
    phrase: "from January 2025 to March 2025",
    filters: { from: "2025-01", to: "2025-03" },
  },
  "F:exact": {
    phrase: "diesel",
    filters: {
      fuelSegment: "NON_EV",
      fuelType: "DIESEL",
      selectedFuelTypes: ["DIESEL"],
    },
  },
  "F:family": {
    phrase: "EV",
    filters: {
      fuelSegment: "EV",
      selectedFuelTypes: BATTERY_EV,
    },
  },
  "V:group": {
    phrase: "two-wheeler",
    filters: {
      vehicleCategories: TWO_WHEELER,
      selectedVehicleCategories: TWO_WHEELER,
    },
  },
  "V:category": {
    phrase: "LMV",
    filters: {
      vehicleCategories: ["LIGHT MOTOR VEHICLE"],
      selectedVehicleCategories: ["LIGHT MOTOR VEHICLE"],
    },
  },
  "V:class": {
    phrase: "motor car",
    filters: {
      vehicleClasses: ["MOTOR CAR"],
      selectedVehicleClasses: ["MOTOR CAR"],
    },
  },
  "N:norm": {
    phrase: "BS VI",
    filters: {
      norms: ["BHARAT STAGE VI"],
      selectedNorms: ["BHARAT STAGE VI"],
    },
  },
  "X:fuel": {
    phrase: "excluding hybrid fuels",
    filters: { excludedFuelTypes: HYBRID_FAMILY },
  },
  "X:category": {
    phrase: "excluding heavy motor vehicles",
    filters: { excludedVehicleCategories: ["HEAVY MOTOR VEHICLE"] },
  },
  "X:class": {
    phrase: "excluding buses",
    filters: { excludedVehicleClasses: ["BUS"] },
  },
  "X:norm": {
    phrase: "excluding BS IV",
    filters: { excludedNorms: ["BHARAT STAGE IV"] },
  },
};

const DEFAULT_MODE_FOR_AXIS = {
  G: "G:state",
  D: "D:month",
  F: "F:exact",
  V: "V:class",
  N: "N:norm",
  X: "X:fuel",
};

function combinations(values, size, start = 0, prefix = [], output = []) {
  if (prefix.length === size) {
    output.push(prefix);
    return output;
  }
  for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
    combinations(values, size, index + 1, [...prefix, values[index]], output);
  }
  return output;
}

function queryForModes(modes) {
  const definitions = modes.map((mode) => MODE_DEFINITIONS[mode]);
  const positive = modes
    .filter((mode) => ["F", "V", "N"].includes(mode[0]))
    .map((mode) => MODE_DEFINITIONS[mode].phrase);
  const exclusion = modes.find((mode) => mode.startsWith("X:"));
  const geography = modes.find((mode) => mode.startsWith("G:"));
  const date = modes.find((mode) => mode.startsWith("D:"));
  return [
    "Show",
    positive.length ? positive.join(" ") : "vehicle",
    "registrations",
    exclusion ? MODE_DEFINITIONS[exclusion].phrase : null,
    geography ? MODE_DEFINITIONS[geography].phrase : null,
    date ? MODE_DEFINITIONS[date].phrase : null,
  ].filter(Boolean).join(" ") + ".";
}

function filtersForModes(modes) {
  return mergeFilters(...modes.map((mode) => MODE_DEFINITIONS[mode].filters));
}

function atomicCases() {
  return REQUIRED_ATOMIC_MODES.map((mode, index) => successCase({
    id: `ATOMIC-${String(index + 1).padStart(2, "0")}-${mode.replace(":", "-")}`,
    query: queryForModes([mode]),
    filters: filtersForModes([mode]),
    axes: [mode[0]],
    modes: [mode],
    combination: "atomic",
    activationPhase: ["V:group", "X:category", "X:class", "X:norm"].includes(mode) ? 3 : 2,
  }));
}

function combinationCases(size) {
  return combinations(AXES, size).map((axes) => {
    const modes = axes.map((axis) => DEFAULT_MODE_FOR_AXIS[axis]);
    return successCase({
      id: `${size === 2 ? "PAIR" : "TRIPLE"}-${axes.join("")}`,
      query: queryForModes(modes),
      filters: filtersForModes(modes),
      axes,
      modes,
      combination: size === 2 ? "pair" : "triple",
      activationPhase: 3,
    });
  });
}

function fullCases() {
  const definitions = [
    {
      id: "FULL-001",
      query: "Return BS VI diesel motor car registrations in Delhi during November 2025.",
      modes: ["G:state", "D:month", "F:exact", "V:class", "N:norm"],
      filters: mergeFilters(
        MODE_DEFINITIONS["D:month"].filters,
        MODE_DEFINITIONS["F:exact"].filters,
        MODE_DEFINITIONS["V:class"].filters,
        MODE_DEFINITIONS["N:norm"].filters,
        { state: "Delhi", from: "2025-11", to: "2025-11" },
      ),
    },
    {
      id: "FULL-002",
      query: "Show EV two-wheeler BS VI registrations excluding hybrids at KA-01 RTO from January 2025 to March 2025.",
      modes: ["G:rto", "D:range", "F:family", "V:group", "N:norm", "X:fuel"],
      filters: mergeFilters(
        MODE_DEFINITIONS["F:family"].filters,
        MODE_DEFINITIONS["V:group"].filters,
        MODE_DEFINITIONS["N:norm"].filters,
        MODE_DEFINITIONS["X:fuel"].filters,
        { state: "Karnataka", rtoContains: "KA-01", from: "2025-01", to: "2025-03" },
      ),
    },
    {
      id: "FULL-003",
      query: "Show diesel LMV BS VI registrations excluding heavy motor vehicles in Maharashtra from January 2025 to March 2025.",
      modes: ["G:state", "D:range", "F:exact", "V:category", "N:norm", "X:category"],
      filters: filtersForModes(["G:state", "D:range", "F:exact", "V:category", "N:norm", "X:category"]),
    },
    {
      id: "FULL-004",
      query: "Show EV motor car BS VI registrations excluding buses at MH-12 RTO during January 2025.",
      modes: ["G:rto", "D:month", "F:family", "V:class", "N:norm", "X:class"],
      filters: filtersForModes(["G:rto", "D:month", "F:family", "V:class", "N:norm", "X:class"]),
    },
    {
      id: "FULL-005",
      query: "Show diesel two-wheeler BS VI registrations excluding BS IV in Maharashtra during January 2025.",
      modes: ["G:state", "D:month", "F:exact", "V:group", "N:norm", "X:norm"],
      filters: filtersForModes(["G:state", "D:month", "F:exact", "V:group", "N:norm", "X:norm"]),
    },
    {
      id: "FULL-006",
      query: "Show EV LMV BS VI registrations in Maharashtra from January 2025 to March 2025.",
      modes: ["G:state", "D:range", "F:family", "V:category", "N:norm"],
      filters: filtersForModes(["G:state", "D:range", "F:family", "V:category", "N:norm"]),
    },
  ];
  return definitions.map((definition) => successCase({
    id: definition.id,
    query: definition.query,
    filters: definition.filters,
    axes: unique(definition.modes.map((mode) => mode[0])),
    modes: definition.modes,
    combination: "full",
    activationPhase: 3,
  }));
}

function wordOrderCases() {
  const sets = [
    {
      id: "WO-FULL",
      axes: ["G", "D", "F", "V", "N"],
      modes: ["G:state", "D:month", "F:exact", "V:class", "N:norm"],
      filters: mergeFilters(
        MODE_DEFINITIONS["F:exact"].filters,
        MODE_DEFINITIONS["V:class"].filters,
        MODE_DEFINITIONS["N:norm"].filters,
        { state: "Delhi", from: "2025-11", to: "2025-11" },
      ),
      queries: [
        "BS VI diesel motor cars in Delhi during November 2025.",
        "Delhi November 2025 BS VI motor car diesel registrations.",
        "Give me diesel BS VI motor car registrations for Delhi in Nov 2025.",
        "For November 2025 in Delhi, show motor car registrations using diesel under BS VI.",
        "How many Delhi diesel motor cars were registered in Nov 2025 with BS VI norm?",
      ],
    },
    {
      id: "WO-EV-2W",
      axes: ["G", "D", "F", "V"],
      modes: ["G:state", "D:range", "F:family", "V:group"],
      filters: mergeFilters(
        MODE_DEFINITIONS["F:family"].filters,
        MODE_DEFINITIONS["V:group"].filters,
        { state: "Karnataka", from: "2025-01", to: "2025-03" },
      ),
      queries: [
        "EV two-wheeler registrations in Karnataka from January to March 2025.",
        "Karnataka Jan to Mar 2025 electric 2W registrations.",
        "For Q1 2025, show Karnataka battery-electric two-wheelers.",
        "Give the Jan-Mar 2025 registration total for Karnataka EV two wheelers.",
        "Two-wheeler EV registrations, Karnataka, January through March 2025.",
      ],
    },
    {
      id: "WO-LPG-LMV",
      axes: ["G", "D", "F", "V", "N"],
      modes: ["G:state", "D:month", "F:family", "V:category", "N:norm"],
      filters: mergeFilters(
        { state: "Rajasthan", from: "2024-07", to: "2024-07" },
        { fuelSegment: "NON_EV", selectedFuelTypes: LPG_FAMILY },
        MODE_DEFINITIONS["V:category"].filters,
        { norms: ["BHARAT STAGE IV"], selectedNorms: ["BHARAT STAGE IV"] },
      ),
      queries: [
        "Show BS IV LPG LMV registrations in Rajasthan during July 2024.",
        "Rajasthan July 2024 LPG light motor vehicle BS IV registrations.",
        "How many BS4 LMV registrations used LPG in Rajasthan in Jul 2024?",
        "For Jul 2024 in Rajasthan, return LPG-family BS IV light motor vehicle registrations.",
        "LPG LMV, Bharat Stage IV, Rajasthan, July 2024 registrations.",
      ],
    },
  ];
  return sets.flatMap((set) => set.queries.map((query, index) => successCase({
    id: `${set.id}-${index + 1}`,
    query,
    filters: set.filters,
    axes: set.axes,
    modes: set.modes,
    combination: "word_order",
    surface: ["word_order"],
    activationPhase: 3,
    equivalenceSetId: set.id,
  })));
}

function preservationCases() {
  return [
    successCase({
      id: "PRESERVE-CAR",
      query: "Show car registrations in Maharashtra in January 2024.",
      filters: mergeFilters(
        { state: "Maharashtra", from: "2024-01", to: "2024-01" },
        MODE_DEFINITIONS["V:class"].filters,
      ),
      axes: ["G", "D", "V"],
      modes: ["G:state", "D:month", "V:class"],
      combination: "preserved_behavior",
      surface: ["legacy_semantics", "car"],
      phase1Gate: true,
    }),
    successCase({
      id: "PRESERVE-LMV",
      query: "Show LMV registrations in Maharashtra in January 2024.",
      filters: mergeFilters(
        { state: "Maharashtra", from: "2024-01", to: "2024-01" },
        MODE_DEFINITIONS["V:category"].filters,
      ),
      axes: ["G", "D", "V"],
      modes: ["G:state", "D:month", "V:category"],
      combination: "preserved_behavior",
      surface: ["legacy_semantics", "LMV"],
      phase1Gate: true,
    }),
    successCase({
      id: "PRESERVE-PASSENGER-CAR",
      query: "Show passenger car registrations in Maharashtra in January 2024.",
      filters: mergeFilters(
        { state: "Maharashtra", from: "2024-01", to: "2024-01" },
        MODE_DEFINITIONS["V:category"].filters,
        MODE_DEFINITIONS["V:class"].filters,
      ),
      axes: ["G", "D", "V"],
      modes: ["G:state", "D:month", "V:category", "V:class"],
      combination: "preserved_behavior",
      surface: ["legacy_semantics", "passenger_car"],
      phase1Gate: true,
    }),
    successCase({
      id: "PRESERVE-4W",
      query: "Show 4W registrations in Delhi in January 2025.",
      filters: mergeFilters(
        { state: "Delhi", from: "2025-01", to: "2025-01" },
        { vehicleCategories: FOUR_WHEELER, selectedVehicleCategories: FOUR_WHEELER },
      ),
      axes: ["G", "D", "V"],
      modes: ["G:state", "D:month", "V:group"],
      combination: "preserved_behavior",
      surface: ["legacy_semantics", "4W"],
      phase1Gate: true,
    }),
    successCase({
      id: "PRESERVE-EV",
      query: "Show EV registrations in Maharashtra in January 2024.",
      filters: mergeFilters(
        { state: "Maharashtra", from: "2024-01", to: "2024-01" },
        MODE_DEFINITIONS["F:family"].filters,
      ),
      axes: ["G", "D", "F"],
      modes: ["G:state", "D:month", "F:family"],
      combination: "preserved_behavior",
      surface: ["legacy_semantics", "EV"],
      phase1Gate: true,
    }),
    successCase({
      id: "PRESERVE-LPG",
      query: "Show LPG registrations in Rajasthan in July 2024.",
      filters: {
        state: "Rajasthan",
        from: "2024-07",
        to: "2024-07",
        fuelSegment: "NON_EV",
        selectedFuelTypes: LPG_FAMILY,
      },
      axes: ["G", "D", "F"],
      modes: ["G:state", "D:month", "F:family"],
      combination: "preserved_behavior",
      surface: ["legacy_semantics", "LPG"],
      phase1Gate: true,
    }),
    successCase({
      id: "PRESERVE-NON-EV",
      query: "Show non-EV registrations in Maharashtra in January 2024.",
      filters: {
        state: "Maharashtra",
        from: "2024-01",
        to: "2024-01",
        fuelSegment: "NON_EV",
        excludedFuelTypes: BATTERY_EV,
      },
      axes: ["G", "D", "F", "X"],
      modes: ["G:state", "D:month", "F:family", "X:fuel"],
      combination: "preserved_behavior",
      surface: ["legacy_semantics", "non_EV"],
      phase1Gate: true,
    }),
    successCase({
      id: "PRESERVE-EXCLUSION",
      query: "Show vehicle registrations excluding diesel in Maharashtra in January 2024.",
      filters: {
        state: "Maharashtra",
        from: "2024-01",
        to: "2024-01",
        excludedFuelTypes: ["DIESEL"],
      },
      axes: ["G", "D", "X"],
      modes: ["G:state", "D:month", "X:fuel"],
      combination: "preserved_behavior",
      surface: ["legacy_semantics", "exclusion"],
      phase1Gate: true,
    }),
    successCase({
      id: "PRESERVE-RTO",
      query: "Show motor car registrations at MH-12 RTO in January 2025.",
      filters: mergeFilters(
        { state: "Maharashtra", rtoContains: "MH-12", from: "2025-01", to: "2025-01" },
        MODE_DEFINITIONS["V:class"].filters,
      ),
      axes: ["G", "D", "V"],
      modes: ["G:rto", "D:month", "V:class"],
      combination: "preserved_behavior",
      surface: ["legacy_semantics", "RTO"],
      phase1Gate: true,
    }),
    successCase({
      id: "PRESERVE-DATE-RANGE",
      query: "Show vehicle registrations in Maharashtra from January to March 2024.",
      filters: { state: "Maharashtra", from: "2024-01", to: "2024-03" },
      axes: ["G", "D"],
      modes: ["G:state", "D:range"],
      combination: "preserved_behavior",
      surface: ["legacy_semantics", "date_range"],
      phase1Gate: true,
    }),
  ];
}

function aliasCases() {
  const definitions = [
    ["ALIAS-EV", "EV registrations in Maharashtra in Jan 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01", fuelSegment: "EV", selectedFuelTypes: BATTERY_EV }, ["G:state", "D:month", "F:family"]],
    ["ALIAS-BOV", "BOV registrations in Maharashtra in Jan 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01", fuelSegment: "EV", selectedFuelTypes: BATTERY_EV }, ["G:state", "D:month", "F:family"]],
    ["ALIAS-PHEV", "PHEV registrations in Maharashtra in Jan 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01", fuelType: "PLUG-IN HYBRID EV", selectedFuelTypes: ["PLUG-IN HYBRID EV"] }, ["G:state", "D:month", "F:exact"]],
    ["ALIAS-LPG", "LPG registrations in Rajasthan in Jul 2024.", { state: "Rajasthan", from: "2024-07", to: "2024-07", fuelSegment: "NON_EV", selectedFuelTypes: LPG_FAMILY }, ["G:state", "D:month", "F:family"]],
    ["ALIAS-2W", "2W registrations in Delhi in Jan 2025.", { state: "Delhi", from: "2025-01", to: "2025-01", vehicleCategories: TWO_WHEELER, selectedVehicleCategories: TWO_WHEELER }, ["G:state", "D:month", "V:group"]],
    ["ALIAS-3W", "3W registrations in Delhi in Jan 2025.", { state: "Delhi", from: "2025-01", to: "2025-01", vehicleCategories: THREE_WHEELER, selectedVehicleCategories: THREE_WHEELER }, ["G:state", "D:month", "V:group"]],
    ["ALIAS-4W", "4W registrations in Delhi in Jan 2025.", { state: "Delhi", from: "2025-01", to: "2025-01", vehicleCategories: FOUR_WHEELER, selectedVehicleCategories: FOUR_WHEELER }, ["G:state", "D:month", "V:group"]],
    ["ALIAS-LMV", "LMV registrations in Delhi in Jan 2025.", { state: "Delhi", from: "2025-01", to: "2025-01", vehicleCategories: ["LIGHT MOTOR VEHICLE"], selectedVehicleCategories: ["LIGHT MOTOR VEHICLE"] }, ["G:state", "D:month", "V:category"]],
    ["ALIAS-HMV", "HMV registrations in Delhi in Jan 2025.", { state: "Delhi", from: "2025-01", to: "2025-01", vehicleCategories: ["HEAVY MOTOR VEHICLE"], selectedVehicleCategories: ["HEAVY MOTOR VEHICLE"] }, ["G:state", "D:month", "V:category"]],
    ["ALIAS-BS6", "BS6 vehicle registrations in Delhi in Jan 2025.", { state: "Delhi", from: "2025-01", to: "2025-01", norms: ["BHARAT STAGE VI"], selectedNorms: ["BHARAT STAGE VI"] }, ["G:state", "D:month", "N:norm"]],
    ["ALIAS-CAR", "Cars registered in Delhi in Jan 2025.", { state: "Delhi", from: "2025-01", to: "2025-01", vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] }, ["G:state", "D:month", "V:class"]],
    ["ALIAS-PASSENGER-CAR", "Passenger cars registered in Delhi in Jan 2025.", { state: "Delhi", from: "2025-01", to: "2025-01", vehicleCategories: ["LIGHT MOTOR VEHICLE"], selectedVehicleCategories: ["LIGHT MOTOR VEHICLE"], vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] }, ["G:state", "D:month", "V:category", "V:class"]],
    ["ALIAS-RTO-DASH", "Vehicle registrations at MH-12 in Jan 2025.", { state: "Maharashtra", rtoContains: "MH-12", from: "2025-01", to: "2025-01" }, ["G:rto", "D:month"]],
    ["ALIAS-RTO-SPACE", "Vehicle registrations at MH 12 in Jan 2025.", { state: "Maharashtra", rtoContains: "MH-12", from: "2025-01", to: "2025-01" }, ["G:rto", "D:month"]],
    ["ALIAS-RTO-COMPACT", "Vehicle registrations at MH12 in Jan 2025.", { state: "Maharashtra", rtoContains: "MH-12", from: "2025-01", to: "2025-01" }, ["G:rto", "D:month"]],
    ["ALIAS-MONTH-SHORT", "Vehicle registrations in Delhi in Jan 2025.", { state: "Delhi", from: "2025-01", to: "2025-01" }, ["G:state", "D:month"]],
    ["ALIAS-MONTH-LONG", "Vehicle registrations in Delhi in January 2025.", { state: "Delhi", from: "2025-01", to: "2025-01" }, ["G:state", "D:month"]],
    ["ALIAS-MONTH-NUMERIC", "Vehicle registrations in Delhi in 2025-01.", { state: "Delhi", from: "2025-01", to: "2025-01" }, ["G:state", "D:month"]],
  ];
  return definitions.map(([id, query, filters, modes]) => successCase({
    id,
    query,
    filters,
    axes: unique(modes.map((mode) => mode[0])),
    modes,
    combination: "alias",
    surface: ["alias", id.replace(/^ALIAS-/, "")],
    activationPhase: 2,
  }));
}

function normalizationCases() {
  const definitions = [
    [
      "NORMALIZE-PUNCTUATION-SPACES",
      "  BS VI,   DIESEL; MOTOR CAR registrations in DELHI!!! during January 2025.  ",
      {
        state: "Delhi",
        from: "2025-01",
        to: "2025-01",
        fuelSegment: "NON_EV",
        fuelType: "DIESEL",
        selectedFuelTypes: ["DIESEL"],
        vehicleClasses: ["MOTOR CAR"],
        selectedVehicleClasses: ["MOTOR CAR"],
        norms: ["BHARAT STAGE VI"],
        selectedNorms: ["BHARAT STAGE VI"],
      },
      ["case", "punctuation", "repeated_spaces"],
    ],
    [
      "NORMALIZE-POSSESSIVE-METRIC",
      "Delhi\u2019s EV registration count in Jan 2025.",
      { state: "Delhi", from: "2025-01", to: "2025-01", fuelSegment: "EV", selectedFuelTypes: BATTERY_EV },
      ["apostrophe", "metric_phrase"],
    ],
    [
      "NORMALIZE-ELECTRIC-VEHICLES",
      "Electric vehicles registered in Delhi in January 2025.",
      { state: "Delhi", from: "2025-01", to: "2025-01", fuelSegment: "EV", selectedFuelTypes: BATTERY_EV },
      ["equivalent_phrase", "singular_plural", "metric_phrase"],
    ],
    [
      "NORMALIZE-TWO-WHEELER-HYPHEN",
      "Two-wheelers registered in Delhi in January 2025.",
      { state: "Delhi", from: "2025-01", to: "2025-01", vehicleCategories: TWO_WHEELER, selectedVehicleCategories: TWO_WHEELER },
      ["hyphen", "singular_plural"],
    ],
    [
      "NORMALIZE-PASSENGER-CAR-HYPHEN",
      "Passenger-car registrations in Delhi in January 2025.",
      { state: "Delhi", from: "2025-01", to: "2025-01", vehicleCategories: ["LIGHT MOTOR VEHICLE"], selectedVehicleCategories: ["LIGHT MOTOR VEHICLE"], vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] },
      ["hyphen", "equivalent_phrase"],
    ],
    [
      "NORMALIZE-BS6-HYPHEN",
      "BS-6 vehicle registrations in Delhi in January 2025.",
      { state: "Delhi", from: "2025-01", to: "2025-01", norms: ["BHARAT STAGE VI"], selectedNorms: ["BHARAT STAGE VI"] },
      ["hyphen", "abbreviation", "BS6"],
    ],
    [
      "NORMALIZE-RTO-UNICODE-DASH",
      "Vehicle registrations at MH\u201312 in January 2025.",
      { state: "Maharashtra", rtoContains: "MH-12", from: "2025-01", to: "2025-01" },
      ["unicode_dash", "RTO"],
    ],
    [
      "NORMALIZE-BOV-DOTTED",
      "B.O.V. registrations in Maharashtra in January 2025.",
      { state: "Maharashtra", from: "2025-01", to: "2025-01", fuelSegment: "EV", selectedFuelTypes: BATTERY_EV },
      ["punctuation", "abbreviation", "BOV"],
    ],
    [
      "NORMALIZE-MONTH-HYPHEN",
      "Vehicle registrations in Delhi in Jan-2025.",
      { state: "Delhi", from: "2025-01", to: "2025-01" },
      ["hyphen", "month"],
    ],
    [
      "NORMALIZE-HMV-PLURAL",
      "Heavy motor vehicles registered in Delhi in January 2025.",
      { state: "Delhi", from: "2025-01", to: "2025-01", vehicleCategories: ["HEAVY MOTOR VEHICLE"], selectedVehicleCategories: ["HEAVY MOTOR VEHICLE"] },
      ["singular_plural", "equivalent_phrase"],
    ],
  ];

  return definitions.map(([id, query, filters, surface]) => successCase({
    id,
    query,
    filters,
    axes: unique([
      filters.state || filters.rtoContains ? "G" : null,
      filters.from || filters.to ? "D" : null,
      filters.fuelSegment || filters.fuelType || filters.selectedFuelTypes ? "F" : null,
      filters.vehicleCategories || filters.vehicleClasses ? "V" : null,
      filters.norms ? "N" : null,
    ].filter(Boolean)),
    modes: [],
    combination: "normalization",
    surface: ["normalization", ...surface],
    activationPhase: 2,
    source: "phase-2-authored",
  }));
}

function compositionCases() {
  return [
    successCase({
      id: "COMPOSE-PARTIAL-FUEL-EXCLUSION",
      query: "Show EV registrations excluding PURE EV in Maharashtra in January 2025.",
      filters: {
        state: "Maharashtra",
        from: "2025-01",
        to: "2025-01",
        fuelSegment: "EV",
        selectedFuelTypes: ["ELECTRIC(BOV)"],
        excludedFuelTypes: ["PURE EV"],
      },
      axes: ["G", "D", "F", "X"],
      modes: ["G:state", "D:month", "F:family", "X:fuel"],
      combination: "compositional_precedence",
      surface: ["partial_exclusion", "fuel_family"],
      activationPhase: 3,
    }),
    successCase({
      id: "COMPOSE-REFINED-GROUP-EXCLUSION",
      query: "Show vehicle registrations excluding two-wheeler transport in Maharashtra in January 2025.",
      filters: {
        state: "Maharashtra",
        from: "2025-01",
        to: "2025-01",
        excludedVehicleCategories: ["TWO WHEELER(T)"],
      },
      axes: ["G", "D", "X"],
      modes: ["G:state", "D:month", "X:category"],
      combination: "compositional_precedence",
      surface: ["refined_group", "category_exclusion"],
      activationPhase: 3,
    }),
    errorCase({
      id: "CONFLICT-NAMED-RTOS",
      query: "Show vehicle registrations in Pune and Mumbai during January 2025.",
      filters: { state: "Maharashtra", from: "2025-01", to: "2025-01" },
      axes: ["G", "D"],
      modes: ["G:rto", "D:month"],
      combination: "contradictory",
      surface: ["contradiction", "multiple_named_rtos"],
      activationPhase: 3,
      httpStatus: 422,
      messageIncludes: "multiple RTO locations",
    }),
  ];
}

function typoCases() {
  const definitions = [
    ["TYPO-PETORL", "Show petorl registrations in Maharashtra in January 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01", fuelSegment: "NON_EV", fuelType: "PETROL", selectedFuelTypes: ["PETROL"] }],
    ["TYPO-ELECTIRC", "Show electirc vehicle registrations in Maharashtra in January 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01", fuelSegment: "EV", selectedFuelTypes: BATTERY_EV }],
    ["TYPO-VEHICALS", "Show vehicals registrations in Maharashtra in January 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01" }],
    ["TYPO-MOTAR-CAR", "Show motar car registrations in Maharashtra in January 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01", vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] }],
    ["TYPO-LMV", "Show light motor vehicl registrations in Maharashtra in January 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01", vehicleCategories: ["LIGHT MOTOR VEHICLE"], selectedVehicleCategories: ["LIGHT MOTOR VEHICLE"] }],
    ["TYPO-MAHARASTRA", "Show vehicle registrations in Maharastra in January 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01" }],
    ["TYPO-KARNATAK", "Show vehicle registrations in Karnatak in January 2025.", { state: "Karnataka", from: "2025-01", to: "2025-01" }],
    ["TYPO-GUJRAT", "Show vehicle registrations in Gujrat in January 2025.", { state: "Gujarat", from: "2025-01", to: "2025-01" }],
    ["TYPO-RAJSTHAN", "Show vehicle registrations in Rajsthan in January 2025.", { state: "Rajasthan", from: "2025-01", to: "2025-01" }],
    ["TYPO-ERICKSHAW", "Show passenger erickshaw registrations in Delhi in January 2025.", { state: "Delhi", from: "2025-01", to: "2025-01", vehicleClasses: ["E-RICKSHAW(P)"], selectedVehicleClasses: ["E-RICKSHAW(P)"] }],
    ["TYPO-MULTI-1", "Show petorl motar car registrations in Maharastra in January 2025.", { state: "Maharashtra", from: "2025-01", to: "2025-01", fuelSegment: "NON_EV", fuelType: "PETROL", selectedFuelTypes: ["PETROL"], vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] }],
    ["TYPO-MULTI-2", "Show electirc two wheelr vehicals in Karnatak in January 2025.", { state: "Karnataka", from: "2025-01", to: "2025-01", fuelSegment: "EV", selectedFuelTypes: BATTERY_EV, vehicleCategories: TWO_WHEELER, selectedVehicleCategories: TWO_WHEELER }],
  ];
  return definitions.map(([id, query, filters]) => successCase({
    id,
    query,
    filters,
    axes: ["G", "D"],
    modes: ["G:state", "D:month"],
    combination: "approved_typo",
    surface: ["approved_typo", id.startsWith("TYPO-MULTI") ? "multiple_typos" : "single_typo"],
    policy: "local_required",
    activationPhase: 4,
  }));
}

function unsupportedCases() {
  const base = { from: "2025-01", to: "2025-01" };
  const definitions = [
    ["UNSUPPORTED-COMPARISON", "Compare vehicle registrations in Maharashtra in January 2025 versus February 2025.", "comparison", "Comparisons"],
    ["UNSUPPORTED-RANKING", "Show the top states by vehicle registrations in January 2025.", "ranking", "Rankings"],
    ["UNSUPPORTED-BREAKDOWN", "Show state-wise vehicle registrations in January 2025.", "unsupported_breakdown", "breakdown"],
    ["UNSUPPORTED-MANUFACTURER", "Show Tata Motors registrations in Maharashtra in January 2025.", "unsupported_subject", "subject"],
    ["UNSUPPORTED-MODEL", "Show registrations by vehicle model in Maharashtra in January 2025.", "unsupported_subject", "subject"],
    ["UNSUPPORTED-GRANULARITY", "Show daily vehicle registrations in Maharashtra in January 2025.", "unsupported_granularity", "monthly rows"],
    ["UNSUPPORTED-SHARE", "What percentage of Maharashtra registrations were EV in January 2025?", "unsupported_metric", "metric"],
    ["UNSUPPORTED-FORECAST", "Forecast vehicle registrations in Maharashtra for January 2025.", "unsupported_metric", "metric"],
    ["UNSUPPORTED-CAUSAL", "Why were EV registrations high in Maharashtra in January 2025?", "causal_question", "Causal"],
    ["UNSUPPORTED-EXACT-DAY", "Show vehicle registrations in Maharashtra on 15 January 2025.", "exact_day", "Daily dates"],
    ["UNSUPPORTED-UNRELATED", "What was the weather in Maharashtra in January 2025?", "unsupported_subject", "subject"],
    ["UNSUPPORTED-MISSING-SUBJECT", "What happened in Maharashtra in January 2025?", "missing_registration_subject", "registration subject"],
  ];
  return definitions.map(([id, query, intent, messageIncludes]) => errorCase({
    id,
    query,
    filters: {
      state: id === "UNSUPPORTED-RANKING" ? null : "Maharashtra",
      ...base,
      ...(id === "UNSUPPORTED-COMPARISON" ? { from: "2025-01", to: "2025-02" } : {}),
    },
    axes: ["G", "D"],
    modes: ["G:state", "D:month"],
    combination: "unsupported",
    surface: ["unsupported_intent", intent],
    activationPhase: 1,
    phase1Gate: true,
    httpStatus: 422,
    code: "unsupported_dashboard_query",
    intent,
    messageIncludes,
  }));
}

function contradictionCases() {
  return [
    errorCase({
      id: "CONFLICT-TWO-STATES",
      query: "Show vehicle registrations in Maharashtra and Delhi in January 2025.",
      filters: { from: "2025-01", to: "2025-01" },
      axes: ["G", "D"],
      modes: ["G:state", "D:month"],
      combination: "contradictory",
      surface: ["contradiction", "multiple_states"],
      activationPhase: 1,
      phase1Gate: true,
      httpStatus: 422,
      messageIncludes: "multiple locations",
    }),
    errorCase({
      id: "CONFLICT-CITY-STATE",
      query: "Show vehicle registrations in Mumbai, Karnataka in January 2025.",
      filters: { from: "2025-01", to: "2025-01" },
      axes: ["G", "D"],
      modes: ["G:rto", "G:state", "D:month"],
      combination: "contradictory",
      surface: ["contradiction", "city_state"],
      activationPhase: 1,
      phase1Gate: true,
      httpStatus: 422,
      messageIncludes: "multiple locations",
    }),
    errorCase({
      id: "CONFLICT-TWO-RTOS",
      query: "Show vehicle registrations at MH-12 and DL-01 RTOs in January 2025.",
      filters: { from: "2025-01", to: "2025-01" },
      axes: ["G", "D"],
      modes: ["G:rto", "D:month"],
      combination: "contradictory",
      surface: ["contradiction", "multiple_rtos"],
      activationPhase: 1,
      phase1Gate: true,
      httpStatus: 422,
      messageIncludes: "multiple RTO codes",
    }),
    errorCase({
      id: "CONFLICT-RTO-STATE",
      query: "Show vehicle registrations at MH-12 RTO in Karnataka in January 2025.",
      filters: { state: "Karnataka", rtoContains: "MH-12", from: "2025-01", to: "2025-01" },
      axes: ["G", "D"],
      modes: ["G:rto", "G:state", "D:month"],
      combination: "contradictory",
      surface: ["contradiction", "rto_state"],
      activationPhase: 3,
      httpStatus: 422,
      messageIncludes: "not Karnataka",
    }),
    errorCase({
      id: "CONFLICT-REVERSED-MONTHS",
      query: "Show vehicle registrations in Maharashtra from March 2025 to January 2025.",
      filters: { state: "Maharashtra" },
      axes: ["G", "D"],
      modes: ["G:state", "D:range"],
      combination: "contradictory",
      surface: ["contradiction", "reversed_month_range"],
      activationPhase: 1,
      phase1Gate: true,
      httpStatus: 400,
      messageIncludes: "reversed",
    }),
    errorCase({
      id: "CONFLICT-REVERSED-YEARS",
      query: "Show vehicle registrations in Maharashtra from 2025 to 2024.",
      filters: { state: "Maharashtra" },
      axes: ["G", "D"],
      modes: ["G:state", "D:range"],
      combination: "contradictory",
      surface: ["contradiction", "reversed_year_range"],
      activationPhase: 1,
      phase1Gate: true,
      httpStatus: 400,
      messageIncludes: "reversed",
    }),
    errorCase({
      id: "CONFLICT-FUTURE-ONLY",
      query: "Show vehicle registrations in Maharashtra in January 2099.",
      filters: { state: "Maharashtra", from: "2099-01", to: "2099-01" },
      axes: ["G", "D"],
      modes: ["G:state", "D:month"],
      combination: "contradictory",
      surface: ["contradiction", "future_only"],
      activationPhase: 1,
      phase1Gate: true,
      httpStatus: 400,
      messageIncludes: "future",
    }),
    errorCase({
      id: "CONFLICT-FUELS",
      query: "Show EV diesel registrations in Maharashtra in January 2025.",
      filters: { state: "Maharashtra", from: "2025-01", to: "2025-01", selectedFuelTypes: [...BATTERY_EV, "DIESEL"] },
      axes: ["G", "D", "F"],
      modes: ["G:state", "D:month", "F:family", "F:exact"],
      combination: "contradictory",
      surface: ["contradiction", "conflicting_fuels"],
      activationPhase: 3,
      httpStatus: 422,
      messageIncludes: "conflicting fuel",
    }),
    errorCase({
      id: "CONFLICT-VEHICLES",
      query: "Show car and bus registrations in Maharashtra in January 2025.",
      filters: { state: "Maharashtra", from: "2025-01", to: "2025-01", vehicleClasses: ["MOTOR CAR", "BUS"], selectedVehicleClasses: ["MOTOR CAR", "BUS"] },
      axes: ["G", "D", "V"],
      modes: ["G:state", "D:month", "V:class"],
      combination: "contradictory",
      surface: ["contradiction", "conflicting_vehicle_meanings"],
      activationPhase: 3,
      httpStatus: 422,
      messageIncludes: "conflicting vehicle",
    }),
    errorCase({
      id: "CONFLICT-INCLUDE-EXCLUDE",
      query: "Show petrol registrations excluding petrol in Maharashtra in January 2025.",
      filters: { state: "Maharashtra", from: "2025-01", to: "2025-01", fuelSegment: "NON_EV", fuelType: "PETROL", selectedFuelTypes: ["PETROL"], excludedFuelTypes: ["PETROL"] },
      axes: ["G", "D", "F", "X"],
      modes: ["G:state", "D:month", "F:exact", "X:fuel"],
      combination: "contradictory",
      surface: ["contradiction", "include_exclude_same_label"],
      activationPhase: 3,
      httpStatus: 422,
      messageIncludes: "both included and excluded",
    }),
    errorCase({
      id: "CONFLICT-BROAD-GROUP-EXCLUSION",
      query: "Show vehicle registrations excluding two-wheelers in Maharashtra in January 2025.",
      filters: { state: "Maharashtra", from: "2025-01", to: "2025-01", excludedVehicleGroups: ["TWO WHEELER"] },
      axes: ["G", "D", "X"],
      modes: ["G:state", "D:month", "X:group"],
      combination: "contradictory",
      surface: ["contradiction", "broad_group_exclusion"],
      activationPhase: 3,
      httpStatus: 400,
      messageIncludes: "Broad vehicle-group exclusions",
    }),
    errorCase({
      id: "CONFLICT-MULTIPLE-SIDE-EXCLUSIONS",
      query: "Show vehicle registrations excluding buses and BS IV vehicles in Maharashtra in January 2025.",
      filters: { state: "Maharashtra", from: "2025-01", to: "2025-01", excludedVehicleClasses: ["BUS"], excludedNorms: ["BHARAT STAGE IV"] },
      axes: ["G", "D", "X"],
      modes: ["G:state", "D:month", "X:class", "X:norm"],
      combination: "contradictory",
      surface: ["contradiction", "multiple_side_exclusions"],
      activationPhase: 3,
      httpStatus: 400,
      messageIncludes: "only one excluded",
    }),
  ];
}

function groqAllowedCases() {
  const definitions = [
    {
      id: "GROQ-ALLOWED-001",
      query: "Show battery-only road registrations around the garden city in January 2025.",
      filters: { state: "Karnataka", rtoContains: "KA-01", from: "2025-01", to: "2025-01", fuelSegment: "EV", selectedFuelTypes: BATTERY_EV },
      modes: ["G:rto", "D:month", "F:family"],
    },
    {
      id: "GROQ-ALLOWED-002",
      query: "Show clean-drive passenger registrations for the Pune office in the first month of 2025.",
      filters: { state: "Maharashtra", rtoContains: "MH-12", from: "2025-01", to: "2025-01", fuelSegment: "EV", selectedFuelTypes: BATTERY_EV, vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] },
      modes: ["G:rto", "D:month", "F:family", "V:class"],
    },
    {
      id: "GROQ-ALLOWED-003",
      query: "Give the plug car count for Karnataka at the close of Q1 2025.",
      filters: { state: "Karnataka", from: "2025-03", to: "2025-03", fuelType: "PLUG-IN HYBRID EV", selectedFuelTypes: ["PLUG-IN HYBRID EV"], vehicleClasses: ["MOTOR CAR"], selectedVehicleClasses: ["MOTOR CAR"] },
      modes: ["G:state", "D:month", "F:exact", "V:class"],
    },
  ];
  return definitions.map((definition) => successCase({
    id: definition.id,
    query: definition.query,
    filters: definition.filters,
    axes: unique(definition.modes.map((mode) => mode[0])),
    modes: definition.modes,
    combination: "unusual_supported_wording",
    surface: ["unusual_wording"],
    policy: "groq_allowed",
    activationPhase: 5,
    notes: "With AI unavailable, this case must produce a safe rephrase/clarification response.",
  }));
}

function corpusDocument(legacyRows) {
  const cases = [
    ...legacyCases(legacyRows),
    ...atomicCases(),
    ...combinationCases(2),
    ...combinationCases(3),
    ...fullCases(),
    ...wordOrderCases(),
    ...preservationCases(),
    ...aliasCases(),
    ...normalizationCases(),
    ...compositionCases(),
    ...typoCases(),
    ...unsupportedCases(),
    ...contradictionCases(),
    ...groqAllowedCases(),
  ];
  return {
    schemaVersion: 1,
    contractVersion: "dashboard-query-v1",
    title: "Phase 1 deterministic dashboard query contract corpus",
    description: "Independent canonical targets for the current dashboard query surface. Runtime enforcement is staged by activationPhase.",
    canonicalFilterFields: CANONICAL_FILTER_FIELDS,
    routingPolicies: {
      local_required: "Deterministic success; Groq forbidden.",
      local_reject: "Local rejection or clarification; Groq forbidden.",
      groq_allowed: "At most one repair call; provider failure must return safe clarification.",
    },
    dimensionModel: {
      axes: {
        G: "geography (state or RTO)",
        D: "date (month or range)",
        F: "fuel (exact or family)",
        V: "vehicle selector (group, category, or class)",
        N: "emission norm",
        X: "supported exclusion (fuel, category, class, or norm)",
      },
      requiredAtomicModes: REQUIRED_ATOMIC_MODES,
      requiredPairSignatures: combinations(AXES, 2).map((axes) => axes.join("")),
      requiredTripleSignatures: combinations(AXES, 3).map((axes) => axes.join("")),
    },
    legacyOracle: {
      path: "data/query-audits/random-filter-oracle-2026-07-30.csv",
      sha256: LEGACY_ORACLE_SHA256,
      caseCount: 50,
      baseline: {
        rulesCanonicalPassCount: 38,
        rulesCanonicalMismatchCount: 12,
        passIds: LEGACY_BASELINE_PASS_IDS,
        mismatchIds: LEGACY_BASELINE_MISMATCH_IDS,
        acceptance: "No previously passing case may regress. Known target mismatches remain visible until their activation phase.",
      },
    },
    cases,
  };
}

function signature(caseItem) {
  return [...caseItem.coverage.axes].sort((left, right) => AXES.indexOf(left) - AXES.indexOf(right)).join("");
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function validateCorpus(corpus, legacyRows) {
  assertCondition(corpus.schemaVersion === 1, "Corpus schemaVersion must be 1.");
  assertCondition(corpus.contractVersion === "dashboard-query-v1", "Unexpected contractVersion.");
  assertCondition(Array.isArray(corpus.cases) && corpus.cases.length >= 150, `Expected at least 150 cases; found ${corpus.cases?.length ?? 0}.`);

  const ids = new Set();
  const queries = new Set();
  for (const item of corpus.cases) {
    assertCondition(compact(item.caseId), "Every case requires caseId.");
    assertCondition(!ids.has(item.caseId), `Duplicate caseId: ${item.caseId}`);
    ids.add(item.caseId);
    const queryKey = compact(item.query).toLowerCase();
    assertCondition(queryKey, `Case ${item.caseId} requires a query.`);
    assertCondition(!queries.has(queryKey), `Duplicate normalized query: ${item.caseId}`);
    queries.add(queryKey);
    assertCondition(ROUTING_POLICIES.has(item.routing?.policy), `Invalid routing policy for ${item.caseId}.`);
    assertCondition(item.routing.maxGroqCalls === (item.routing.policy === "groq_allowed" ? 1 : 0), `Invalid Groq cap for ${item.caseId}.`);
    assertCondition(item.routing.groqPolicy === (item.routing.policy === "groq_allowed" ? "allowed" : "forbidden"), `Invalid Groq policy for ${item.caseId}.`);
    assertCondition(Number.isInteger(item.activationPhase) && item.activationPhase >= 1 && item.activationPhase <= 7, `Invalid activationPhase for ${item.caseId}.`);
    assertCondition(item.expected?.canonicalFilters && typeof item.expected.canonicalFilters === "object", `Missing canonical filters for ${item.caseId}.`);
    assertCondition(
      JSON.stringify(Object.keys(item.expected.canonicalFilters)) === JSON.stringify(CANONICAL_FILTER_FIELDS),
      `Canonical filter shape/order mismatch for ${item.caseId}.`,
    );
    for (const field of ARRAY_FILTER_FIELDS) {
      const values = item.expected.canonicalFilters[field];
      assertCondition(Array.isArray(values), `${item.caseId}.${field} must be an array.`);
      assertCondition(values.length === new Set(values).size, `${item.caseId}.${field} contains duplicates.`);
      assertCondition(values.every((value) => compact(value)), `${item.caseId}.${field} contains an empty label.`);
    }
    if (item.phase1Gate) assertCondition(item.activationPhase === 1, `${item.caseId} is a Phase 1 gate but activates later.`);
    if (item.classification === "rejected") {
      assertCondition(item.routing.policy === "local_reject", `${item.caseId} rejected cases must be local_reject.`);
      assertCondition([400, 422].includes(item.expected.httpStatus), `${item.caseId} has invalid rejection status.`);
      assertCondition(compact(item.expected.error?.messageIncludes), `${item.caseId} requires messageIncludes.`);
    } else {
      assertCondition(item.classification === "supported", `${item.caseId} has invalid classification.`);
      assertCondition(item.expected.httpStatus === 200, `${item.caseId} supported cases must expect HTTP 200.`);
    }
  }

  const legacy = corpus.cases.filter((item) => item.coverage.combination === "legacy_50");
  assertCondition(legacy.length === 50, `Expanded corpus must retain 50 legacy cases; found ${legacy.length}.`);
  assertCondition(legacyRows.length === 50, `Legacy CSV must contain 50 rows; found ${legacyRows.length}.`);
  const legacyGroups = legacyRows.reduce((counts, row) => {
    counts[row.case_group] = (counts[row.case_group] ?? 0) + 1;
    return counts;
  }, {});
  assertCondition(
    legacyGroups.coverage === 30 && legacyGroups.spelling_shorthand === 10 && legacyGroups.paraphrase === 10,
    `Legacy oracle mix changed: ${JSON.stringify(legacyGroups)}.`,
  );

  const atomicModes = new Set(
    corpus.cases
      .filter((item) => item.coverage.combination === "atomic")
      .flatMap((item) => item.coverage.modes),
  );
  for (const mode of REQUIRED_ATOMIC_MODES) {
    assertCondition(atomicModes.has(mode), `Missing atomic coverage mode ${mode}.`);
  }

  const pairSignatures = new Set(
    corpus.cases.filter((item) => item.coverage.combination === "pair").map(signature),
  );
  const tripleSignatures = new Set(
    corpus.cases.filter((item) => item.coverage.combination === "triple").map(signature),
  );
  for (const axes of combinations(AXES, 2)) assertCondition(pairSignatures.has(axes.join("")), `Missing pair ${axes.join("")}.`);
  for (const axes of combinations(AXES, 3)) assertCondition(tripleSignatures.has(axes.join("")), `Missing triple ${axes.join("")}.`);
  assertCondition(pairSignatures.size === 15, `Expected 15 pair signatures; found ${pairSignatures.size}.`);
  assertCondition(tripleSignatures.size === 20, `Expected 20 triple signatures; found ${tripleSignatures.size}.`);

  const full = corpus.cases.filter((item) => item.coverage.combination === "full");
  assertCondition(full.length >= 6, `Expected at least six full combinations; found ${full.length}.`);
  const fullModes = new Set(full.flatMap((item) => item.coverage.modes));
  for (const mode of ["G:state", "G:rto", "D:month", "D:range", "F:exact", "F:family", "V:group", "V:category", "V:class", "X:fuel", "X:category", "X:class", "X:norm"]) {
    assertCondition(fullModes.has(mode), `Full combinations do not cover ${mode}.`);
  }

  const wordOrderGroups = new Map();
  for (const item of corpus.cases.filter((candidate) => candidate.coverage.combination === "word_order")) {
    const group = item.coverage.equivalenceSetId;
    wordOrderGroups.set(group, (wordOrderGroups.get(group) ?? 0) + 1);
  }
  assertCondition(wordOrderGroups.size >= 3, `Expected at least three word-order equivalence sets; found ${wordOrderGroups.size}.`);
  for (const [group, count] of wordOrderGroups) assertCondition(count >= 5, `${group} requires at least five word orders.`);

  assertCondition(corpus.cases.filter((item) => item.coverage.combination === "alias").length >= 15, "Alias coverage is incomplete.");
  assertCondition(corpus.cases.filter((item) => item.coverage.combination === "approved_typo").length >= 10, "Approved typo coverage is incomplete.");
  assertCondition(corpus.cases.filter((item) => item.coverage.combination === "unsupported").length >= 12, "Unsupported coverage is incomplete.");
  assertCondition(corpus.cases.filter((item) => item.coverage.combination === "contradictory").length >= 12, "Contradiction coverage is incomplete.");
  assertCondition(corpus.cases.some((item) => item.routing.policy === "groq_allowed"), "At least one Groq-allowed case is required.");

  return {
    caseCount: corpus.cases.length,
    legacyCaseCount: legacy.length,
    atomicModeCount: atomicModes.size,
    pairCount: pairSignatures.size,
    tripleCount: tripleSignatures.size,
    fullCount: full.length,
    wordOrderSetCount: wordOrderGroups.size,
    phase1GateCount: corpus.cases.filter((item) => item.phase1Gate).length,
    routingCounts: corpus.cases.reduce((counts, item) => {
      counts[item.routing.policy] = (counts[item.routing.policy] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

function parseArguments(argv) {
  const options = {
    write: false,
    execute: false,
    activationPhase: 1,
    port: 33_700 + (process.pid % 500),
    reportPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") options.write = true;
    else if (argument === "--execute") options.execute = true;
    else if (argument === "--activation-phase") {
      options.activationPhase = Number(argv[index += 1]);
      assertCondition(
        Number.isInteger(options.activationPhase) && options.activationPhase >= 1 && options.activationPhase <= 7,
        "--activation-phase must be an integer from 1 to 7.",
      );
    } else if (argument === "--port") {
      options.port = Number(argv[index += 1]);
      assertCondition(Number.isInteger(options.port) && options.port >= 1024 && options.port <= 65000, "--port must be 1024-65000.");
    } else if (argument === "--report") {
      options.reportPath = path.resolve(ROOT, String(argv[index += 1] ?? ""));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.reportPath && !options.execute) throw new Error("--report requires --execute.");
  return options;
}

async function fileHashes() {
  const hashes = {};
  for (const file of DATA_FILES) {
    const relative = path.relative(ROOT, file).replaceAll("\\", "/");
    const content = await fs.readFile(file).catch(() => null);
    hashes[relative] = content ? sha256(content) : null;
  }
  return hashes;
}

async function databaseEvidence() {
  if (!hasDatabaseUrl()) {
    return {
      status: "unverified",
      mode: "select_only",
      reason: "DATABASE_URL is not configured; API execution used the CSV path.",
    };
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
    const fullCombo = await dbQuery(`
      select count(*)::integer as row_count,
             coalesce(sum(vehicle_count), 0)::bigint as total
        from registrations
       where year = $1 and month = $2 and state = $3 and rto = $4
         and fuel_type = $5 and fuel_filter = $6
         and vehicle_category_filter = $6
         and norms_filter = $7 and vehicle_class_filter = $8
    `, [
      2025,
      11,
      "Delhi",
      "All Vahan4 Running Office",
      "DIESEL",
      "ALL",
      "BHARAT STAGE VI",
      "MOTOR CAR",
    ]);
    const excludingDiesel = await dbQuery(`
      select count(*)::integer as row_count,
             coalesce(sum(vehicle_count), 0)::bigint as total
        from registrations
       where year = $1 and month = $2 and state = $3 and rto = $4
         and fuel_type <> $5 and fuel_filter = $6
         and vehicle_category_filter = $6
         and norms_filter = $6 and vehicle_class_filter = $6
    `, [
      2024,
      1,
      "Maharashtra",
      "All Vahan4 Running Office",
      "DIESEL",
      "ALL",
    ]);
    const row = profile.rows[0] ?? {};
    return {
      status: "verified",
      mode: "select_only",
      profile: {
        rowCount: Number(row.row_count ?? 0),
        negativeCount: Number(row.negative_count ?? 0),
        missingRequiredCount: Number(row.missing_required_count ?? 0),
        duplicateGroupCount: Number(duplicates.rows[0]?.duplicate_group_count ?? 0),
        earliestMonth: row.earliest_month ?? null,
        latestMonth: row.latest_month ?? null,
      },
      reconciliations: {
        fullCombo: {
          queryCaseId: "LEGACY-Q022",
          rowCount: Number(fullCombo.rows[0]?.row_count ?? 0),
          total: Number(fullCombo.rows[0]?.total ?? 0),
        },
        excludingDiesel: {
          queryCaseId: "PRESERVE-EXCLUSION",
          rowCount: Number(excludingDiesel.rows[0]?.row_count ?? 0),
          total: Number(excludingDiesel.rows[0]?.total ?? 0),
        },
      },
    };
  } catch (error) {
    return {
      status: "unverified",
      mode: "select_only",
      reason: error.message,
    };
  } finally {
    await closePool().catch(() => {});
  }
}

function assertLocalDatabase() {
  const databaseUrl = compact(process.env.DATABASE_URL);
  if (!databaseUrl) return;
  const parsed = new URL(databaseUrl);
  assertCondition(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Query-contract execution refuses non-local DATABASE_URL targets.",
  );
}

function safeServerEnvironment(port) {
  return {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "test",
    TEST_CURRENT_MONTH: "2026-07",
    AI_QUERY_PROVIDER: "none",
    GEMINI_API_KEY: "",
    GROQ_API_KEY: "",
    PUBLIC_DASHBOARD_DISABLE_LIVE_REFRESH: "1",
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_ALLOWED_CHAT_IDS: "",
    TELEGRAM_ENABLE_POLLING: "0",
    TELEGRAM_SUMMARY_FETCH_MISSING: "0",
    FACTOR_AGENT_ENABLED: "0",
    FACTOR_AGENT_PROVIDER: "none",
    RATE_LIMIT_STORE: "memory",
    ALLOW_IN_MEMORY_RATE_LIMIT: "1",
    EXPENSIVE_RATE_LIMIT_MAX: "10000",
    EXPENSIVE_RATE_LIMIT_GLOBAL_MAX: "10000",
    MAX_EXPENSIVE_CONCURRENCY: "1",
  };
}

async function waitForServer(port, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Validation server exited with code ${child.exitCode}.\n${output.join("\n")}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Startup races are expected.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for validation server on port ${port}.`);
}

async function startServer(port) {
  const output = [];
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: safeServerEnvironment(port),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  for (const [stream, label] of [[child.stdout, "stdout"], [child.stderr, "stderr"]]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output.push(...String(chunk).split(/\r?\n/).filter(Boolean).map((line) => `[${label}] ${line}`));
      if (output.length > 100) output.splice(0, output.length - 100);
    });
  }
  await waitForServer(port, child, output);
  return { child, output };
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
  const started = Date.now();
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
      body = { error: `Non-JSON response (${text.length} bytes)` };
    }
    return {
      httpStatus: response.status,
      body,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      httpStatus: null,
      body: { error: error.message },
      durationMs: Date.now() - started,
    };
  }
}

function actualFilterSnapshot(filters = {}) {
  const explicitRtoSearch = filters.locationSource === "explicit_rto_code" && /^[A-Z]{2}-\d{2}$/i.test(compact(filters.rtoSearch))
    ? compact(filters.rtoSearch)
    : null;
  return canonicalFilters({
    state: compact(filters.state) || null,
    rtoContains: compact(filters.rto) || explicitRtoSearch,
    from: compact(filters.from) || null,
    to: compact(filters.to) || null,
    metric: compact(filters.metric) || "registrations",
    fuelSegment: compact(filters.fuelSegment) || null,
    fuelType: compact(filters.fuelType) || null,
    fuelFilters: filters.fuelFilters ?? [],
    selectedFuelTypes: filters.selectedFuelTypes ?? [],
    vehicleCategories: filters.vehicleCategories ?? [],
    selectedVehicleCategories: filters.selectedVehicleCategories ?? [],
    selectedVehicleGroups: filters.selectedVehicleGroups ?? [],
    vehicleClasses: filters.vehicleClasses ?? [],
    selectedVehicleClasses: filters.selectedVehicleClasses ?? [],
    norms: filters.norms ?? [],
    selectedNorms: filters.selectedNorms ?? [],
    excludedFuelTypes: filters.excludedFuelTypes ?? [],
    excludedVehicleGroups: filters.excludedVehicleGroups ?? [],
    excludedVehicleClasses: filters.excludedVehicleClasses ?? [],
    excludedVehicleCategories: filters.excludedVehicleCategories ?? [],
    excludedNorms: filters.excludedNorms ?? [],
  });
}

function canonicalArray(values) {
  return (values ?? []).map(compact).sort((left, right) => left.localeCompare(right));
}

function compareFilters(expected, actual) {
  const mismatches = [];
  for (const field of CANONICAL_FILTER_FIELDS) {
    if (field === "rtoContains") continue;
    if (ARRAY_FILTER_FIELDS.includes(field)) {
      if (JSON.stringify(canonicalArray(expected[field])) !== JSON.stringify(canonicalArray(actual[field]))) {
        mismatches.push({ field, expected: expected[field], actual: actual[field] });
      }
    } else if (compact(expected[field]) !== compact(actual[field])) {
      mismatches.push({ field, expected: expected[field], actual: actual[field] });
    }
  }
  if (expected.rtoContains) {
    if (!normalizeRto(actual.rtoContains).includes(normalizeRto(expected.rtoContains))) {
      mismatches.push({ field: "rto", expected: `contains ${expected.rtoContains}`, actual: actual.rtoContains });
    }
  } else if (actual.rtoContains) {
    mismatches.push({ field: "rto", expected: null, actual: actual.rtoContains });
  }
  return mismatches;
}

function verifyAggregations(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const issues = [];
  const byMonth = new Map();
  const byFuel = new Map();
  const keys = new Set();
  let total = 0;
  for (const [index, row] of rows.entries()) {
    const count = Number(row.vehicle_count);
    if (!Number.isFinite(count) || count < 0) {
      issues.push(`row_${index}_invalid_vehicle_count`);
      continue;
    }
    total += count;
    const month = `${Number(row.year)}-${String(Number(row.month)).padStart(2, "0")}`;
    byMonth.set(month, (byMonth.get(month) ?? 0) + count);
    byFuel.set(String(row.fuel_type), (byFuel.get(String(row.fuel_type)) ?? 0) + count);
    const key = [
      row.year,
      row.month,
      normalize(row.state),
      normalize(row.rto),
      normalize(row.fuel_type),
      normalize(row.fuel_filter),
      normalize(row.vehicle_category_filter),
      normalize(row.norms_filter),
      normalize(row.vehicle_class_filter),
    ].join("\u0000");
    if (keys.has(key)) issues.push(`duplicate_registration_grain:${index}`);
    keys.add(key);
  }
  const trend = [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, count]) => ({ month, count }));
  const actualTrend = (payload?.trend ?? []).map((entry) => ({ month: entry.month, count: Number(entry.count) }));
  const fuelBreakdown = Object.fromEntries([...byFuel.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const actualFuelBreakdown = Object.fromEntries(
    (payload?.fuelBreakdown ?? [])
      .map((entry) => [String(entry.fuelType), Number(entry.count)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const peak = trend.reduce((best, item) => item.count > (best?.count ?? -1) ? item : best, null);
  if (Number(payload?.summary?.total) !== total) issues.push("summary_total_mismatch");
  if (JSON.stringify(actualTrend) !== JSON.stringify(trend)) issues.push("trend_mismatch");
  if (JSON.stringify(actualFuelBreakdown) !== JSON.stringify(fuelBreakdown)) issues.push("fuel_breakdown_mismatch");
  if ((payload?.summary?.peakMonth ?? null) !== (peak?.month ?? null)) issues.push("peak_month_mismatch");
  if (Number(payload?.summary?.peakMonthCount ?? 0) !== Number(peak?.count ?? 0)) issues.push("peak_month_count_mismatch");
  if (payload?.liveRefresh !== null && payload?.liveRefresh !== undefined) issues.push("live_refresh_started");
  if (payload?.filters?.aiProvider || payload?.filters?.correctedByAi) issues.push("ai_provider_used");
  return {
    issues: unique(issues),
    rowCount: rows.length,
    recomputed: {
      total,
      trend,
      fuelBreakdown,
      peakMonth: peak?.month ?? null,
      peakMonthCount: peak?.count ?? 0,
    },
  };
}

function checkExpectedError(item, apiResult) {
  const issues = [];
  if (apiResult.httpStatus !== item.expected.httpStatus) {
    issues.push(`http_status:${item.expected.httpStatus}=>${apiResult.httpStatus}`);
  }
  const expectedError = item.expected.error;
  const actualCode = apiResult.body?.details?.code ?? apiResult.body?.code ?? null;
  const actualIntent = apiResult.body?.details?.unsupportedIntent ?? apiResult.body?.unsupportedIntent ?? null;
  if (expectedError.code && actualCode !== expectedError.code) {
    issues.push(`error_code:${expectedError.code}=>${actualCode}`);
  }
  if (expectedError.intent && actualIntent !== expectedError.intent) {
    issues.push(`error_intent:${expectedError.intent}=>${actualIntent}`);
  }
  if (!String(apiResult.body?.error ?? "").toLowerCase().includes(String(expectedError.messageIncludes).toLowerCase())) {
    issues.push(`error_message_missing:${expectedError.messageIncludes}`);
  }
  return issues;
}

async function executeCorpus(corpus, port, activationPhase = 1) {
  assertLocalDatabase();
  const beforeHashes = await fileHashes();
  const server = await startServer(port);
  const results = [];
  try {
    const selected = corpus.cases.filter((item) => (
      item.coverage.combination === "legacy_50" || item.activationPhase <= activationPhase
    ));
    for (const [index, item] of selected.entries()) {
      console.log(`[query-contract] ${index + 1}/${selected.length} ${item.caseId}`);
      const api = await postQuery(port, item.query);
      const expectsOfflineClarification = item.activationPhase === 5 && item.routing.policy === "groq_allowed";
      if (expectsOfflineClarification) {
        const actualCode = api.body?.details?.code ?? api.body?.code ?? null;
        const issues = [
          api.httpStatus === 422 ? null : `http_status:422=>${api.httpStatus}`,
          actualCode === "dashboard_query_clarification_required"
            ? null
            : `error_code:dashboard_query_clarification_required=>${actualCode}`,
        ].filter(Boolean);
        results.push({
          caseId: item.caseId,
          activationPhase: item.activationPhase,
          legacyCaseId: item.legacy?.originalCaseId ?? null,
          classification: issues.length ? "gate_failure" : "pass",
          query: item.query,
          expectedHttpStatus: 422,
          actualHttpStatus: api.httpStatus,
          durationMs: api.durationMs,
          routingPolicy: item.routing.policy,
          filterMismatches: [],
          dataIssues: [],
          errorIssues: issues,
          actualFilters: null,
          rowCount: null,
          summaryTotal: null,
          recomputed: null,
          warnings: [],
          actualError: {
            message: api.body?.error ?? null,
            code: actualCode,
            intent: api.body?.details?.routingReason ?? null,
          },
        });
        continue;
      }
      if (item.classification === "rejected") {
        const issues = checkExpectedError(item, api);
        results.push({
          caseId: item.caseId,
          activationPhase: item.activationPhase,
          legacyCaseId: item.legacy?.originalCaseId ?? null,
          classification: issues.length ? "gate_failure" : "pass",
          query: item.query,
          expectedHttpStatus: item.expected.httpStatus,
          actualHttpStatus: api.httpStatus,
          durationMs: api.durationMs,
          routingPolicy: item.routing.policy,
          filterMismatches: [],
          dataIssues: [],
          errorIssues: issues,
          actualFilters: null,
          rowCount: null,
          summaryTotal: null,
          recomputed: null,
          warnings: api.body?.warnings ?? [],
          actualError: {
            message: api.body?.error ?? null,
            code: api.body?.details?.code ?? api.body?.code ?? null,
            intent: api.body?.details?.unsupportedIntent ?? api.body?.unsupportedIntent ?? null,
          },
        });
        continue;
      }
      const actualFilters = actualFilterSnapshot(api.body?.filters);
      const filterMismatches = api.httpStatus === 200
        ? compareFilters(item.expected.canonicalFilters, actualFilters)
        : [{ field: "httpStatus", expected: 200, actual: api.httpStatus }];
      const aggregation = api.httpStatus === 200
        ? verifyAggregations(api.body)
        : { issues: [], rowCount: null, recomputed: null };
      const canonicalPass = !filterMismatches.length;
      const dataPass = !aggregation.issues.length;
      results.push({
        caseId: item.caseId,
        activationPhase: item.activationPhase,
        legacyCaseId: item.legacy?.originalCaseId ?? null,
        legacyBaselineCanonicalResult: item.legacy?.baselineCanonicalResult ?? null,
        classification: canonicalPass && dataPass ? "pass" : filterMismatches.length ? "filter_mismatch" : "data_inconsistency",
        query: item.query,
        expectedHttpStatus: 200,
        actualHttpStatus: api.httpStatus,
        durationMs: api.durationMs,
        routingPolicy: item.routing.policy,
        filterMismatches,
        dataIssues: aggregation.issues,
        errorIssues: [],
        expectedFilters: item.expected.canonicalFilters,
        actualFilters,
        rowCount: aggregation.rowCount,
        summaryTotal: api.body?.summary?.total ?? null,
        recomputed: aggregation.recomputed,
        sampleRows: (api.body?.rows ?? []).slice(0, 3).map((row) => ({
          year: row.year,
          month: row.month,
          state: row.state,
          rto: row.rto,
          fuel_type: row.fuel_type,
          fuel_filter: row.fuel_filter,
          vehicle_category_filter: row.vehicle_category_filter,
          norms_filter: row.norms_filter,
          vehicle_class_filter: row.vehicle_class_filter,
          vehicle_count: row.vehicle_count,
        })),
        dataStatus: api.body?.dataStatus ?? null,
        warnings: api.body?.warnings ?? [],
      });
    }
  } finally {
    await stopServer(server);
  }
  const afterHashes = await fileHashes();
  const database = await databaseEvidence();

  const legacyResults = results.filter((item) => item.legacyCaseId);
  const legacyPassIds = legacyResults
    .filter((item) => item.classification === "pass")
    .map((item) => item.legacyCaseId);
  const legacyRegressionIds = LEGACY_BASELINE_PASS_IDS.filter((id) => !legacyPassIds.includes(id));
  const legacyImprovementIds = LEGACY_BASELINE_MISMATCH_IDS.filter((id) => legacyPassIds.includes(id));
  const phaseResults = results.filter((item) => !item.legacyCaseId);
  const phaseFailures = phaseResults.filter((item) => item.classification !== "pass");
  const requestedPhaseResults = phaseResults.filter((item) => item.activationPhase === activationPhase);
  const requestedPhaseFailures = requestedPhaseResults.filter((item) => item.classification !== "pass");
  const phase1Results = phaseResults.filter((item) => item.activationPhase === 1);
  const phase1Failures = phase1Results.filter((item) => item.classification !== "pass");
  const dataFilesUnchanged = JSON.stringify(beforeHashes) === JSON.stringify(afterHashes);
  const apiFullCombo = results.find((item) => item.caseId === "LEGACY-Q022");
  const apiExcludingDiesel = results.find((item) => item.caseId === "PRESERVE-EXCLUSION");
  const databaseProfilePassed = database.status !== "verified" || (
    database.profile.negativeCount === 0
    && database.profile.missingRequiredCount === 0
    && database.profile.duplicateGroupCount === 0
  );
  const databaseReconciliation = database.status === "verified"
    ? {
        fullCombo: {
          apiTotal: Number(apiFullCombo?.recomputed?.total ?? 0),
          databaseTotal: database.reconciliations.fullCombo.total,
          matched: Number(apiFullCombo?.recomputed?.total ?? 0) === database.reconciliations.fullCombo.total,
        },
        excludingDiesel: {
          apiTotal: Number(apiExcludingDiesel?.recomputed?.total ?? 0),
          databaseTotal: database.reconciliations.excludingDiesel.total,
          matched: Number(apiExcludingDiesel?.recomputed?.total ?? 0) === database.reconciliations.excludingDiesel.total,
        },
      }
    : null;
  const databaseReconciliationPassed = !databaseReconciliation || Object.values(databaseReconciliation).every((item) => item.matched);
  const passed = legacyResults.length === 50
    && legacyRegressionIds.length === 0
    && phaseFailures.length === 0
    && dataFilesUnchanged
    && databaseProfilePassed
    && databaseReconciliationPassed;

  return {
    generatedAt: new Date().toISOString(),
    configuration: {
      port,
      activationPhase,
      aiQueryProvider: "none",
      liveRefreshDisabled: true,
      telegramDisabled: true,
      factorAgentDisabled: true,
      rateLimitStore: "memory",
      databaseAccess: compact(process.env.DATABASE_URL) ? "local_read_only_query_path" : "csv_read_only",
    },
    summary: {
      passed,
      executedCaseCount: results.length,
      legacyCaseCount: legacyResults.length,
      legacyCanonicalPassCount: legacyPassIds.length,
      legacyCanonicalMismatchCount: legacyResults.length - legacyPassIds.length,
      legacyBaselineRegressionCount: legacyRegressionIds.length,
      legacyImprovementCount: legacyImprovementIds.length,
      phaseGateCount: phaseResults.length,
      phaseGateFailureCount: phaseFailures.length,
      requestedPhaseGateCount: requestedPhaseResults.length,
      requestedPhaseGateFailureCount: requestedPhaseFailures.length,
      phase1GateCount: phase1Results.length,
      phase1GateFailureCount: phase1Failures.length,
      dataFilesUnchanged,
      databaseStatus: database.status,
      databaseProfilePassed,
      databaseReconciliationPassed,
    },
    legacy: {
      baselinePassCount: LEGACY_BASELINE_PASS_IDS.length,
      baselineMismatchCount: LEGACY_BASELINE_MISMATCH_IDS.length,
      regressionIds: legacyRegressionIds,
      improvementIds: legacyImprovementIds,
      currentPassIds: legacyPassIds,
    },
    safety: {
      sourceHashesBefore: beforeHashes,
      sourceHashesAfter: afterHashes,
      dataFilesUnchanged,
      groqCallsAllowed: 0,
      liveRefreshAllowed: false,
      scraperStarted: false,
    },
    database,
    databaseReconciliation,
    results,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const legacyText = await fs.readFile(LEGACY_ORACLE_PATH, "utf8");
  const legacyHash = sha256(legacyText);
  assertCondition(
    legacyHash === LEGACY_ORACLE_SHA256,
    `Legacy oracle hash changed: expected ${LEGACY_ORACLE_SHA256}, found ${legacyHash}.`,
  );
  const legacyRows = parseCsv(legacyText);
  const corpus = corpusDocument(legacyRows);
  const serialized = `${JSON.stringify(corpus, null, 2)}\n`;
  const structural = validateCorpus(corpus, legacyRows);

  if (options.write) {
    await fs.mkdir(path.dirname(CORPUS_PATH), { recursive: true });
    await fs.writeFile(CORPUS_PATH, serialized, "utf8");
  } else {
    const existing = await fs.readFile(CORPUS_PATH, "utf8").catch(() => null);
    assertCondition(existing !== null, `Corpus is missing. Run with --write: ${CORPUS_PATH}`);
    assertCondition(existing === serialized, `Frozen corpus differs from the generator: ${CORPUS_PATH}`);
  }

  let execution = null;
  if (options.execute) {
    execution = await executeCorpus(corpus, options.port, options.activationPhase);
    if (options.reportPath) {
      await fs.mkdir(path.dirname(options.reportPath), { recursive: true });
      await fs.writeFile(options.reportPath, `${JSON.stringify(execution, null, 2)}\n`, "utf8");
    }
  }

  console.log(JSON.stringify({
    corpus: path.relative(ROOT, CORPUS_PATH).replaceAll("\\", "/"),
    corpusSha256: sha256(serialized),
    legacyOracleSha256: legacyHash,
    structural,
    execution: execution?.summary ?? null,
    report: options.reportPath ? path.relative(ROOT, options.reportPath).replaceAll("\\", "/") : null,
  }, null, 2));

  if (execution && !execution.summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
