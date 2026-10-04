import { createHash } from "node:crypto";
import { fetchAnnualOemSegment, parseAnnualMakers } from "./rto-oem-annual.mjs";
import { resolvePublicRegistrationScope, PUBLIC_ORIGIN } from "./public-dashboard-scope.mjs";
import { publicChartQueryString, parsePublicCategoryDistribution } from "./public-dashboard-client.mjs";
import { RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS, snapshotDateKey } from "./rto-daily-snapshots.mjs";

export const OEM_TRACKING_BASELINE_CONTRACT = "public-oem-tracking-baseline-v1";
export const OEM_TRACKING_DAILY_CONTRACT = "public-oem-tracking-ytd-v1";
const makerPath = "/analytics/publicdashboard/lazy/vehicle-makers";
const chartPath = "/analytics/publicdashboard/vahandashboard/top5Makerchart";
const countPath = "/analytics/publicdashboard/vahan/registration/dashboardcount";
const aggregate = /^(?:others?|other\s*\/\s*untracked)$/i;
const normalize = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const catalogs = new WeakMap();

async function readJson(path, options) {
  await options.beforeRequest();
  const url = `${PUBLIC_ORIGIN}${path}`;
  const response = await options.fetchImpl(url, { headers: { accept: "application/json", "x-requested-with": "XMLHttpRequest" }, signal: AbortSignal.timeout(options.timeoutMs) });
  if (!response.ok) throw new Error(`OEM tracking source returned HTTP ${response.status}: ${new URL(url).pathname}.`);
  return { url, body: await response.json() };
}

export async function resolveOemTrackingMaker(name, { fetchImpl = fetch, beforeRequest = async () => {}, timeoutMs = 25000 } = {}) {
  if (!normalize(name) || aggregate.test(name)) throw new Error("A named source OEM is required.");
  let entries = catalogs.get(fetchImpl);
  if (!entries) { entries = new Map(); catalogs.set(fetchImpl, entries); }
  const cached = entries.get(normalize(name));
  if (cached && Date.now() - cached.at < 3600000) return cached.value;
  const options = { fetchImpl, beforeRequest, timeoutMs };
  const candidates = [];
  const requests = [];
  const responses = [];
  // The official lazy catalog returns strings; each string is both the visible
  // label and the vehicleMakers filter value. Do not invent numeric identifiers.
  for (let page = 0; page < 40; page++) {
    const item = await readJson(`${makerPath}?${new URLSearchParams({ page: String(page), size: "25", search: name })}`, options);
    if (!Array.isArray(item.body) || item.body.some((v) => typeof v !== "string" || !v.trim())) throw new Error("Invalid official OEM catalog response.");
    requests.push(item.url); responses.push(item.body); candidates.push(...item.body);
    if (item.body.length < 25) break;
    if (page === 39) throw new Error("OEM catalog search did not finish; mapping is unverified.");
  }
  const matches = [...new Set(candidates)].filter((v) => normalize(v) === normalize(name));
  if (matches.length !== 1) throw new Error(`Official OEM mapping is missing or ambiguous: ${name}.`);
  const value = { id: matches[0], name: matches[0], requests, responses, catalogHash: hash(responses) };
  entries.set(normalize(name), { at: Date.now(), value });
  return value;
}

export async function fetchOemTrackingBaselineSegment(options) {
  const evidence = await fetchAnnualOemSegment(options);
  const makerMappings = [];
  const makers = [];
  for (const row of evidence.makers.filter((v) => !aggregate.test(v.name))) {
    const mapping = await resolveOemTrackingMaker(row.name, options);
    makerMappings.push(mapping);
    makers.push({ id: mapping.id, name: row.name, rank: makers.length + 1, count: row.count });
  }
  return { ...evidence, contract: OEM_TRACKING_BASELINE_CONTRACT, selectionYear: options.year,
    makers, makerMappings, rankingComplete: makers.length === 5 || evidence.explicitZero };
}

function filtersForScope(scope, year, makerIds) {
  return { fromYear: String(year), toYear: String(year), stateCode: scope.stateCode, rtoCode: scope.rtoCode,
    vehicleClasses: scope.vehicleClasses, vehicleMakers: makerIds, vehicleSubCategories: scope.vehicleCategories,
    vehicleEmissions: [], vehicleFuels: scope.fuels, timePeriod: "0", vehicleCategoryGroup: [], evType: [],
    vehicleStatus: [], vehicleOwnerType: [], fitnessCheck: "0", vehicleType: "",
    archiveTypeAC: "ACTIVE_COMPLIANT", archiveTypeANC: "ACTIVE_NON_COMPLIANT", archiveTypePA: "", archiveTypeTA: "", archiveTypeNA: "" };
}

export function oemTrackingFilterIdentity(filters, makerId) {
  const result = Object.fromEntries(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value]));
  result.vehicleMakers = [makerId];
  return hash(result);
}

function explicitCount(body) {
  const value = body?.totalTransactions;
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d[\d,]*$/.test(String(value))) throw new Error("OEM registration headline is not explicitly reported.");
  const count = Number(String(value).replaceAll(",", ""));
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid OEM registration headline.");
  return count;
}

export async function fetchTrackedOemSegment({ state, rto, year, makers, vehicleCategories, vehicleClasses = [], fuels, fetchImpl = fetch, beforeRequest = async () => {}, timeoutMs = 25000, maxRequestAttempts = 1 }) {
  if (!Number.isInteger(year) || year < 1900 || year > 9999 || !Array.isArray(makers) || makers.length > 5) throw new Error("Invalid tracked OEM request.");
  if (new Set(makers.map((m) => m.id)).size !== makers.length || makers.some((m) => !m.id || !m.name || aggregate.test(m.name))) throw new Error("Invalid tracked OEM identities.");
  if (!makers.length) return { makers: [], observedAt: new Date().toISOString() };
  const options = { fetchImpl, beforeRequest, timeoutMs, maxRequestAttempts };
  const scope = await resolvePublicRegistrationScope({ state, rto, vehicleCategories, vehicleClasses, fuels, ...options });
  const filters = filtersForScope(scope, year, makers.map((m) => m.id));
  const get = (path, selectedFilters) => readJson(`${path}?${publicChartQueryString({ ...selectedFilters, ...(path === countPath ? { viewModes: "registration" } : {}) })}`, options);
  const available = new Map();
  let batchError;
  const buildEvidence = (maker, count, selectedFilters, items, mode) => ({ contract: OEM_TRACKING_DAILY_CONTRACT, year, count, makerId: maker.id, makerName: maker.name,
    filters: selectedFilters, mapping: scope.mapping, observedAt: new Date().toISOString(), sourceReportedAt: null,
    filterIdentity: oemTrackingFilterIdentity(selectedFilters, maker.id), requests: items.map((v) => v.url),
    requestHash: hash(items.map((v) => v.url)), responseHash: hash(items.map((v) => v.body)),
    raw: mode === "batch" ? { chart: items[0].body, headline: items[1].body } : { headline: items[0].body }, mode });
  const rethrowCollectionStop = (error) => {
    if (error?.code !== "OEM_COLLECTION_STOPPED" && error?.constructor?.name !== "CollectionStopped") return;
    const fuelGroup = Object.keys(RTO_DAILY_FUEL_FILTERS).find((key) => sameList(fuels, RTO_DAILY_FUEL_FILTERS[key]));
    const vehicleCategory = Object.keys(RTO_DAILY_CATEGORY_FILTERS).find((key) => sameList(vehicleCategories, RTO_DAILY_CATEGORY_FILTERS[key].vehicleCategories)
      && sameList(vehicleClasses, RTO_DAILY_CATEGORY_FILTERS[key].vehicleClasses));
    error.trackingResults = [...available.values()].filter((result) => {
      if (result.status !== "verified") return false;
      try {
        return validateOemDailyEvidence(result.evidence, { state, rto, year, fuelGroup, vehicleCategory, makerId: result.id, makerName: result.name });
      } catch { return false; }
    });
    throw error;
  };
  try {
    const chart = await get(chartPath, filters);
    const headline = await get(countPath, filters);
    const total = explicitCount(headline.body);
    const rows = parseAnnualMakers(chart.body);
    const names = new Map(makers.map((m) => [normalize(m.name), m]));
    if (rows.some((row) => !aggregate.test(row.name) && !names.has(normalize(row.name)))) throw new Error("Source returned an OEM outside the saved maker filter.");
    if (rows.reduce((sum, row) => sum + row.count, 0) !== total) throw new Error("Filtered OEM chart and registration headline do not reconcile.");
    for (const row of rows.filter((row) => !aggregate.test(row.name))) {
      const maker = names.get(normalize(row.name));
      available.set(maker.id, { ...maker, status: "verified", count: row.count, reason: null, evidence: buildEvidence(maker, row.count, filters, [chart, headline], "batch") });
    }
    // An explicit zero for the entire filtered subset proves each member's
    // cumulative zero; an empty/missing chart alone never does.
    if (total === 0) for (const maker of makers) available.set(maker.id, { ...maker, status: "verified", count: 0, reason: null, evidence: buildEvidence(maker, 0, filters, [chart, headline], "batch") });
  } catch (error) {
    rethrowCollectionStop(error);
    batchError = error.message;
  }
  for (const maker of makers.filter((m) => !available.has(m.id))) {
    try {
      const selected = filtersForScope(scope, year, [maker.id]);
      const headline = await get(countPath, selected);
      const count = explicitCount(headline.body);
      available.set(maker.id, { ...maker, status: "verified", count, reason: null, evidence: buildEvidence(maker, count, selected, [headline], "individual") });
    } catch (error) {
      rethrowCollectionStop(error);
      available.set(maker.id, { ...maker, status: "unavailable", count: null, evidence: null, reason: `${error.message}${batchError ? ` Batch request: ${batchError}` : ""}` });
    }
  }
  return { makers: makers.map((m) => available.get(m.id)), observedAt: new Date().toISOString() };
}

function validateCommon(evidence, expected, contract) {
  const year = expected.selectionYear ?? expected.year;
  if (!evidence || evidence.contract !== contract || evidence.year !== year || evidence.filters?.fromYear !== String(year) || evidence.filters?.toYear !== String(year)
    || evidence.mapping?.state !== expected.state || evidence.mapping?.rto !== expected.rto || evidence.mapping?.stateCode !== evidence.filters.stateCode
    || String(evidence.mapping?.rtoCode) !== String(evidence.filters.rtoCode) || evidence.filters.timePeriod !== "0"
    || evidence.filters.archiveTypeAC !== "ACTIVE_COMPLIANT" || evidence.filters.archiveTypeANC !== "ACTIVE_NON_COMPLIANT"
    || evidence.filters.archiveTypePA || evidence.filters.archiveTypeTA || evidence.filters.archiveTypeNA
    || !Number.isFinite(Date.parse(evidence.observedAt)) || !/^[a-f0-9]{64}$/.test(evidence.requestHash ?? "") || !/^[a-f0-9]{64}$/.test(evidence.responseHash ?? "")) throw new Error("OEM tracking evidence does not match its source contract or saved scope.");
  if (!sameList(evidence.filters.vehicleFuels, RTO_DAILY_FUEL_FILTERS[expected.fuelGroup])
    || !sameList(evidence.filters.vehicleSubCategories, RTO_DAILY_CATEGORY_FILTERS[expected.vehicleCategory]?.vehicleCategories)
    || !sameList(evidence.filters.vehicleClasses, RTO_DAILY_CATEGORY_FILTERS[expected.vehicleCategory]?.vehicleClasses)) throw new Error("OEM tracking filters do not match the fuel/category scope.");
  if (!Array.isArray(evidence.requests) || !evidence.requests.length || evidence.requestHash !== hash(evidence.requests)) throw new Error("Invalid OEM tracking request evidence.");
  for (const url of evidence.requests) {
    const u = new URL(url);
    if (u.origin !== PUBLIC_ORIGIN || ![chartPath, countPath, "/analytics/publicdashboard/vahandashboard/categoriesdonutchart"].includes(u.pathname)
      || u.searchParams.get("fromYear") !== String(year) || u.searchParams.get("toYear") !== String(year)
      || u.searchParams.get("stateCode") !== evidence.filters.stateCode || u.searchParams.get("rtoCode") !== String(evidence.filters.rtoCode)
      || u.searchParams.get("timePeriod") !== "0") throw new Error("Invalid OEM tracking request scope.");
    for (const key of ["vehicleMakers", "vehicleFuels", "vehicleSubCategories", "vehicleClasses"]) {
      if ((u.searchParams.get(key) ?? "") !== (evidence.filters[key] ?? []).join(",")) throw new Error("OEM tracking request filters differ from evidence.");
    }
    if (u.searchParams.get("archiveTypeAC") !== "ACTIVE_COMPLIANT" || u.searchParams.get("archiveTypeANC") !== "ACTIVE_NON_COMPLIANT"
      || u.searchParams.get("archiveTypePA") || u.searchParams.get("archiveTypeTA") || u.searchParams.get("archiveTypeNA")) throw new Error("Invalid OEM tracking archive scope.");
  }
}

export function validateOemBaselineEvidence(evidence, expected, { allowCompacted = false } = {}) {
  validateCommon(evidence, expected, OEM_TRACKING_BASELINE_CONTRACT);
  if (evidence.selectionYear !== expected.selectionYear || evidence.filters.vehicleMakers.length || !Array.isArray(evidence.makers) || evidence.makers.length > 5
    || !Number.isSafeInteger(evidence.total) || evidence.total < 0 || evidence.explicitZero !== (evidence.total === 0)
    || evidence.rankingComplete !== (evidence.makers.length === 5 || evidence.explicitZero)
    || new Set(evidence.makers.map((m) => normalize(m.name))).size !== evidence.makers.length || new Set(evidence.makers.map((m) => m.id)).size !== evidence.makers.length
    || evidence.makers.some((m, i) => !m.id || !m.name || aggregate.test(m.name) || m.rank !== i + 1 || !Number.isSafeInteger(m.count) || m.count < 0
      || (i > 0 && m.count > evidence.makers[i - 1].count)
      || !evidence.makerMappings?.some((v) => v.id === m.id && normalize(v.name) === normalize(m.name) && /^[a-f0-9]{64}$/.test(v.catalogHash)))
    || evidence.makers.reduce((sum, m) => sum + m.count, 0) > evidence.total || (evidence.total > 0 && evidence.makers.length === 0)) throw new Error("Invalid saved OEM baseline ranking.");
  if (!evidence.raw) {
    if (!allowCompacted || evidence.rawRetained !== false) throw new Error("Raw baseline source evidence is required.");
    return true;
  }
  const rows = parseAnnualMakers(evidence.raw.makers);
  const named = rows.filter((m) => !aggregate.test(m.name));
  if (named.length !== evidence.makers.length || named.some((m, i) => m.name !== evidence.makers[i].name || m.count !== evidence.makers[i].count)
    || explicitCount(evidence.raw.headline) !== evidence.total || parsePublicCategoryDistribution(evidence.raw.categories).some((row) => !evidence.filters.vehicleSubCategories.includes(row.category))
    || parsePublicCategoryDistribution(evidence.raw.categories).reduce((sum, row) => sum + row.count, 0) !== evidence.total
    || rows.reduce((sum, row) => sum + row.count, 0) > evidence.total || evidence.responseHash !== hash([evidence.raw.makers, evidence.raw.categories, evidence.raw.headline])) throw new Error("Baseline values do not reconcile with raw source evidence.");
  for (const mapping of evidence.makerMappings) {
    if (!Array.isArray(mapping.responses) || hash(mapping.responses) !== mapping.catalogHash || !mapping.responses.flat().includes(mapping.id)) throw new Error("OEM identifier is not verified by its official catalog.");
  }
  return true;
}

export function validateOemDailyEvidence(evidence, expected, { allowCompacted = false } = {}) {
  validateCommon(evidence, expected, OEM_TRACKING_DAILY_CONTRACT);
  if (evidence.makerId !== expected.makerId || normalize(evidence.makerName) !== normalize(expected.makerName)
    || !evidence.filters.vehicleMakers.includes(expected.makerId) || !Number.isSafeInteger(evidence.count) || evidence.count < 0
    || evidence.filterIdentity !== oemTrackingFilterIdentity(evidence.filters, expected.makerId)
    || (expected.date && snapshotDateKey(new Date(evidence.observedAt), "Asia/Kolkata") !== expected.date)
    || (evidence.sourceReportedAt !== null && evidence.sourceReportedAt !== undefined && (!Number.isFinite(Date.parse(evidence.sourceReportedAt)) || Date.parse(evidence.sourceReportedAt) > Date.parse(evidence.observedAt)))
    || !["batch", "individual"].includes(evidence.mode) || (evidence.mode === "individual" && evidence.filters.vehicleMakers.length !== 1)) throw new Error("Invalid tracked OEM observation.");
  if (!evidence.raw) {
    if (!allowCompacted || evidence.rawRetained !== false) throw new Error("Raw OEM observation evidence is required.");
    return true;
  }
  if (evidence.mode === "individual") {
    if (evidence.requests.length !== 1 || new URL(evidence.requests[0]).pathname !== countPath || explicitCount(evidence.raw.headline) !== evidence.count
      || evidence.responseHash !== hash([evidence.raw.headline])) throw new Error("Individual OEM count does not match source evidence.");
  } else {
    const rows = parseAnnualMakers(evidence.raw.chart);
    const total = explicitCount(evidence.raw.headline);
    const row = rows.find((v) => normalize(v.name) === normalize(expected.makerName));
    if (evidence.requests.length !== 2 || new URL(evidence.requests[0]).pathname !== chartPath || new URL(evidence.requests[1]).pathname !== countPath
      || (row ? row.count !== evidence.count : !(total === 0 && evidence.count === 0))
      || rows.some((v) => !aggregate.test(v.name) && !evidence.filters.vehicleMakers.some((id) => normalize(id) === normalize(v.name)))
      || rows.reduce((sum, v) => sum + v.count, 0) !== total || evidence.responseHash !== hash([evidence.raw.chart, evidence.raw.headline])) throw new Error("Batch OEM count does not match source evidence.");
  }
  return true;
}
