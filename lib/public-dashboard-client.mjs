export const PUBLIC_DASHBOARD_SOURCE_URL =
  "https://analytics.parivahan.gov.in/analytics/publicdashboard/vahan?lang=en";

const PUBLIC_DASHBOARD_ORIGIN = "https://analytics.parivahan.gov.in";
const MONTHLY_TABLE_PATH = "/analytics/publicdashboard/vahandashboard/durationWiseRegistrationTable";
const FUEL_DISTRIBUTION_PATH = "/analytics/publicdashboard/vahandashboard/fueltypedonutchart";
const DEFAULT_TIMEOUT_MS = 25_000;
const ALL = "ALL";

// These are the values used by the Public Dashboard state control.  Keeping
// the stable codes here avoids loading a rendered page just to resolve them.
const STATE_CODES = new Map([
  ["andaman & nicobar island", "AN"], ["andhra pradesh", "AP"], ["arunachal pradesh", "AR"],
  ["assam", "AS"], ["bihar", "BR"], ["chandigarh", "CH"], ["chhattisgarh", "CG"],
  ["delhi", "DL"], ["goa", "GA"], ["gujarat", "GJ"], ["haryana", "HR"],
  ["himachal pradesh", "HP"], ["jammu and kashmir", "JK"], ["jammu & kashmir", "JK"],
  ["jharkhand", "JH"], ["karnataka", "KA"], ["kerala", "KL"], ["ladakh", "LA"],
  ["lakshadweep", "LD"], ["madhya pradesh", "MP"], ["maharashtra", "MH"],
  ["manipur", "MN"], ["meghalaya", "ML"], ["mizoram", "MZ"], ["nagaland", "NL"],
  ["odisha", "OR"], ["orissa", "OR"], ["puducherry", "PY"], ["pondicherry", "PY"],
  ["punjab", "PB"], ["rajasthan", "RJ"], ["sikkim", "SK"], ["tamil nadu", "TN"],
  ["telangana", "TG"], ["tripura", "TR"], ["ut of dnh and dd", "DD"],
  ["dadra and nagar haveli and daman and diu", "DD"], ["uttar pradesh", "UP"],
  ["uttarakhand", "UK"], ["west bengal", "WB"],
]);

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function lookup(value) {
  return compact(value).toLowerCase();
}

// The query interpreter stores classes in its canonical (mostly uppercase)
// vocabulary.  The Public Dashboard compares the submitted option value, not
// its display text, so translate that vocabulary to the values used by its
// select control before making an XHR request.
const PUBLIC_VEHICLE_CLASS_VALUES = new Map([
  ["MOTOR CAR", "Motor Car"],
  ["BUS", "Bus"],
  ["GOODS CARRIER", "Goods Carrier"],
  ["E-RICKSHAW(P)", "e-Rickshaw(P)"],
  ["M-CYCLE/SCOOTER", "M-Cycle/Scooter"],
  ["SCOOTER", "M-Cycle/Scooter"],
]);

export function publicVehicleClassValue(value) {
  const canonical = compact(value).toUpperCase();
  return PUBLIC_VEHICLE_CLASS_VALUES.get(canonical) ?? compact(value);
}

function numberOrNull(value) {
  const cleaned = String(value ?? "").replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function monthFromText(value) {
  const labels = new Map([
    ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6],
    ["july", 7], ["august", 8], ["september", 9], ["october", 10], ["november", 11], ["december", 12],
  ]);
  const match = String(value ?? "").match(/(\d{4})[-\s]+([A-Za-z]+)/);
  if (!match) return null;
  return { year: Number(match[1]), month: labels.get(match[2].toLowerCase()) ?? null };
}

function rtoParts(value) {
  const match = String(value ?? "").toUpperCase().match(/\b([A-Z]{2})\s*-?\s*0*(\d{1,3})\b/);
  return match ? { stateCode: match[1], rtoCode: String(Number(match[2])) } : null;
}

export function publicStateCode(state, rto = "") {
  const fromRto = rtoParts(rto)?.stateCode;
  if (fromRto) return fromRto;
  if (compact(state).toUpperCase() === "INDIA TOTAL") return "";
  const code = STATE_CODES.get(lookup(state));
  if (!code) throw new Error(`Public Dashboard state code is not known for "${state}".`);
  return code;
}

export function publicRtoCode(rto = "") {
  if (!compact(rto) || /all vahan4 running office/i.test(rto)) return "0";
  const code = rtoParts(rto)?.rtoCode;
  if (!code) throw new Error(`Public Dashboard RTO code is not available in "${rto}".`);
  return code;
}

export function publicMonthlyQueryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        // The Public Dashboard's table endpoint receives its multiselect
        // fields as PHP-style arrays (for example, `vehicleFuels[]=PURE EV`).
        // Match the browser request shape exactly so side filters are applied.
        if (item !== null && item !== undefined && String(item) !== "") query.append(`${key}[]`, String(item));
      }
    } else if (value !== null && value !== undefined) {
      query.append(key, String(value));
    }
  }
  return query.toString();
}

export function publicChartQueryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalized = Array.isArray(value) ? value.filter(Boolean).join(",") : value;
    if (normalized !== null && normalized !== undefined && String(normalized) !== "") query.append(key, String(normalized));
  }
  return query.toString();
}

function publicParams({ state, rto, year, vehicleCategories = [], vehicleClasses = [], norms = [], fuel = "" }) {
  return {
    stateCode: publicStateCode(state, rto),
    rtoCode: publicRtoCode(rto),
    fromYear: String(year),
    toYear: String(year),
    vehicleClasses: vehicleClasses.map(publicVehicleClassValue),
    vehicleMakers: [],
    vehicleSubCategories: vehicleCategories,
    vehicleEmissions: norms,
    vehicleFuels: fuel ? [fuel] : [],
    timePeriod: "0",
    // Monthly rows use the dashboard's duration table mode.
    calendarType: "3",
    vehicleCategoryGroup: [],
    evType: [],
    vehicleStatus: [],
    vehicleOwnerType: [],
    fitnessCheck: "0",
    vehicleType: "",
    archiveTypeAC: "ACTIVE_COMPLIANT",
    archiveTypeANC: "ACTIVE_NON_COMPLIANT",
    archiveTypePA: "",
    archiveTypeTA: "",
    archiveTypeNA: "",
  };
}

async function publicJson(path, query, description, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetchImpl(`${PUBLIC_DASHBOARD_ORIGIN}${path}?${query}`, {
      // The endpoint is an XHR used by the Public Dashboard. Supplying the
      // same request context prevents upstream from silently falling back to
      // an unfiltered aggregate response.
      headers: {
        accept: "*/*",
        "x-requested-with": "XMLHttpRequest",
        referer: PUBLIC_DASHBOARD_SOURCE_URL,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new Error(`Public Dashboard ${description} endpoint ${reason}: ${error.message}`);
  }
  if (!response.ok) throw new Error(`Public Dashboard ${description} endpoint returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error(`Public Dashboard ${description} endpoint did not return JSON.`);
  }
}

export function parsePublicMonthlyCounts(response, year) {
  if (!Array.isArray(response)) throw new Error("Public Dashboard returned an invalid monthly response.");
  const counts = new Map();
  for (const item of response) {
    const period = monthFromText(item?.yearAsString);
    const count = numberOrNull(item?.registeredVehicleCount);
    if (!period?.month || period.year !== Number(year) || count === null) continue;
    counts.set(period.month, count);
  }
  return counts;
}

export function parsePublicFuelDistribution(response) {
  const labels = Array.isArray(response?.labels) ? response.labels : [];
  const data = Array.isArray(response?.data) ? response.data : [];
  if (!labels.length || labels.length !== data.length) throw new Error("Public Dashboard returned an invalid fuel-distribution response.");
  const distribution = labels.map((label, index) => ({ fuelType: compact(label), count: numberOrNull(data[index]) }))
    .filter((item) => item.fuelType && item.count !== null);
  if (!distribution.length) throw new Error("Public Dashboard returned no fuel-distribution values.");
  return distribution;
}

function filterContext(values = []) {
  return values.length ? values.map((value) => compact(value).toUpperCase()).sort().join("|") : ALL;
}

function fuelSegment(fuel) {
  return /electric|ev|bov/i.test(fuel) ? "EV" : "NON_EV";
}

export async function fetchPublicDashboardRows({
  state, rto = "", year, months = [], fuels = [], vehicleCategories = [], vehicleClasses = [], norms = [],
  fetchImpl, timeoutMs,
} = {}) {
  const requestedMonths = new Set(months.map(Number));
  const normalizedFuels = fuels.length ? fuels : [ALL];
  const rows = [];

  for (const fuel of normalizedFuels) {
    const response = await publicJson(
      MONTHLY_TABLE_PATH,
      publicMonthlyQueryString(publicParams({ state, rto, year, vehicleCategories, vehicleClasses, norms, fuel: fuel === ALL ? "" : fuel })),
      "monthly",
      { fetchImpl, timeoutMs },
    );
    const counts = parsePublicMonthlyCounts(response, year);
    const monthsToStore = requestedMonths.size ? requestedMonths : new Set(counts.keys());
    if (!monthsToStore.size && fuel === ALL) {
      throw new Error(`Public Dashboard returned no monthly values for ${year}.`);
    }
    // Only persist an explicit value returned by the source.  A missing month
    // is not proof of zero: manufacturing a zero here made failed class
    // requests appear as a successful "Fresh scrape" in the dashboard.
    for (const month of monthsToStore) {
      if (!counts.has(month)) continue;
      const vehicle_count = counts.get(month);
      rows.push({
        year: Number(year), month, state: state || "INDIA TOTAL", rto: rto || "All Vahan4 Running Office",
        fuel_filter: filterContext(fuels), vehicle_category_filter: filterContext(vehicleCategories),
        norms_filter: filterContext(norms), vehicle_class_filter: filterContext(vehicleClasses),
        vehicle_count, scraped_at: new Date().toISOString(), source_url: PUBLIC_DASHBOARD_SOURCE_URL,
        fuel_segment: fuelSegment(fuel), fuel_type: fuel,
      });
    }
  }
  if (!rows.length) throw new Error("Public Dashboard returned no requested monthly values.");
  return rows;
}

export async function fetchPublicFuelDistribution({
  state, rto = "", year, vehicleCategories = [], vehicleClasses = [], norms = [], fetchImpl, timeoutMs,
} = {}) {
  const params = publicParams({ state, rto, year, vehicleCategories, vehicleClasses, norms });
  delete params.calendarType;
  const response = await publicJson(
    FUEL_DISTRIBUTION_PATH,
    publicChartQueryString(params),
    "fuel-distribution",
    { fetchImpl, timeoutMs },
  );
  return parsePublicFuelDistribution(response);
}
