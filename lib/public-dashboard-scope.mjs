import { createHash } from "node:crypto";

export const PUBLIC_SCOPE_CONTRACT = "public-stock-v2";
export const PUBLIC_ORIGIN = "https://analytics.parivahan.gov.in";
export const PUBLIC_PAGE_PATH = "/analytics/publicdashboard/vahan?lang=en";
const cache = new WeakMap();
const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const aliases = new Map([["OD", "OR"], ["TS", "TG"], ["UA", "UK"]]);
const canonicalCode = (value) => aliases.get(value) ?? value;
// Explicit cohort-name crosswalk observed in the live /analytics/json_rtos catalog
// on 2026-09-09. Both the exact source name and office code must still match.
// Never use fuzzy names or a numeric prefix alone to choose a dropdown value.
const officeNames = new Map([
  ["DL:3:SOUTH (LADO SARAI)", "SOUTH DELHI"],
  ["DL:9:SOUTH WEST (DWARKA)", "DWARKA"],
  ["DL:10:CENTRAL (RAJA GARDEN)", "RAJOURI GARDEN"],
  ["DL:4:WEST (HARI NAGAR)", "JANAKPURI"],
  ["DL:12:NORTH (BURARI)", "VASANT VIHAR"],
  ["DL:52:TAXI UNIT HQ", "BURARI TAXI UNIT"],
  ["DL:11:OUTER NORTH (ROHINI-I)", "ROHINI"],
  ["DL:5:NORTH EAST (LONI)", "LONI ROAD"],
  ["DL:8:CENTRAL NORTH (WAZIRPUR)", "WAZIRPUR"],
  ["DL:13:NORTH WEST (ROHINI-II)", "SURAJMAL VIHAR"],
  ["DL:6:SOUTH EAST (SARAI KALE KHAN)", "SARAI KALE KHAN"],
  ["MH:16:RTO AHILYANAGAR", "RTO AHEMEDNAGAR"],
]);

function decode(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export function publicSelectOptions(html, id) {
  const attribute = (text, name) => text.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2];
  const select = [...String(html).matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)]
    .find((match) => attribute(match[1], "id") === id);
  if (!select) throw new Error(`Public Dashboard catalog lacks ${id}.`);
  return [...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)]
    .map((match) => ({ value: decode(attribute(match[1], "value") ?? ""), label: decode(match[2].replace(/<[^>]*>/g, "").trim()) }));
}

export function resolvePublicState(options, state) {
  const label = normalize(state).replace(/^ORISSA$/, "ODISHA").replace(/^PONDICHERRY$/, "PUDUCHERRY").replace("JAMMU AND KASHMIR", "JAMMU & KASHMIR");
  const matches = options.filter((item) => item.value && normalize(item.label) === label);
  if (matches.length !== 1) throw new Error(`Public Dashboard state mapping is missing or ambiguous: ${state}.`);
  return matches[0];
}

export function resolvePublicRto(catalog, wanted, stateCode) {
  if (!Array.isArray(catalog) || !catalog.length) throw new Error("Public Dashboard RTO catalog is empty or invalid.");
  const identity = (text) => {
    const value = normalize(text).replace(/\s*\(\s*\d{1,2}-[A-Z]{3}-\d{4}\s*\)\s*$/, "");
    const code = value.match(/\b([A-Z]{2})\s*-?\s*0*(\d{1,3})\b/);
    if (!code) throw new Error(`Public Dashboard RTO identity is invalid: ${text}.`);
    return { code: canonicalCode(code[1]), number: String(Number(code[2])), name: value.slice(0, code.index).replace(/[\s-]+$/, "") };
  };
  const expected = identity(wanted);
  if (expected.code !== stateCode) throw new Error("Public Dashboard RTO/state mismatch.");
  const expectedName = officeNames.get(`${expected.code}:${expected.number}:${expected.name}`) ?? expected.name;
  const matches = catalog.filter((item) => {
    if (item.stateCode !== stateCode) throw new Error("Public Dashboard RTO catalog contains a different state.");
    const actual = identity(item.rtoName);
    return actual.code === expected.code && actual.number === expected.number && actual.name === expectedName;
  });
  if (matches.length !== 1 || !/^\d+$/.test(String(matches[0].rtoCode)) || Number(matches[0].rtoCode) <= 0) {
    throw new Error(`Public Dashboard exact RTO mapping is missing or ambiguous: ${wanted}.`);
  }
  return matches[0];
}

export function verifiedRtoSourceSql(alias = "r") {
  if (!/^[a-z]+$/.test(alias)) throw new Error("Invalid SQL alias.");
  const v = `${alias}.evidence->'validation'`;
  return `(${v}->>'contract' = '${PUBLIC_SCOPE_CONTRACT}'
    and ${v}->'mapping'->>'state' = ${alias}.state
    and ${v}->'mapping'->>'rto' = ${alias}.rto
    and ${v}->'mapping'->>'stateCode' = ${alias}.evidence->'filters'->>'stateCode'
    and ${v}->'mapping'->>'rtoCode' = ${alias}.evidence->'filters'->>'rtoCode'
    and ${v}->'headlineTotal' = to_jsonb(${alias}.report_total)
    and ${v}->'sourceRowCount' = to_jsonb(${alias}.source_row_count)
    and ${v}->>'requestHash' ~ '^[a-f0-9]{64}$'
    and ${v}->>'responseHash' ~ '^[a-f0-9]{64}$'
    and ${v}->'mapping'->>'catalogHash' ~ '^[a-f0-9]{64}$'
    and ${v}->>'timePeriod' = '2'
    and ${alias}.source = 'vahan-public-dashboard'
    and ${alias}.metric_kind = 'active_stock'
    and ${alias}.evidence->'filters'->>'archiveScope' = 'ACTIVE_ONLY'
    and ${alias}.fuel_group in ('EV', 'ICE')
    and ${alias}.vehicle_category in ('2W', '3W', '4W')
    and ${alias}.source_row_count between 0 and 5
    and ${alias}.evidence->'topMakerRows' = (
      select coalesce(jsonb_agg(jsonb_build_object('maker', s.oem, 'vehicle_count', s.vehicle_count, 'rank', s.source_rank) order by s.source_rank), '[]'::jsonb)
      from rto_daily_snapshots s
      where s.report_id = ${alias}.id and s.scrape_run_id = ${alias}.run_id
        and s.state = ${alias}.state and s.rto = ${alias}.rto
        and s.fuel_group = ${alias}.fuel_group and s.vehicle_category = ${alias}.vehicle_category
        and s.snapshot_date = ${alias}.snapshot_date and s.metric_kind = 'active_stock'
        and s.scrape_status in ('success', 'late_fill'))
    and (${alias}.report_total > 0 or ${v}->'zeroConfirmed' = 'true'::jsonb))`;
}

export function validatePublicStockEvidence(report) {
  const v = report.evidence?.validation;
  const filters = report.evidence?.filters;
  const categories = report.evidence?.categories;
  const makerTotal = report.rows?.reduce((sum, row) => sum + Number(row.vehicle_count ?? row.vehicleCount), 0);
  const hex = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (v?.contract !== PUBLIC_SCOPE_CONTRACT || v.mapping?.state !== report.state || v.mapping?.rto !== report.rto
    || !hex(v.mapping?.catalogHash) || !hex(v.requestHash) || !hex(v.responseHash)
    || !Number.isFinite(Date.parse(v.verifiedAt)) || v.headlineTotal !== report.reportTotal
    || v.sourceRowCount !== report.rows?.length
    || v.mapping.stateCode !== filters?.stateCode || v.mapping.rtoCode !== filters?.rtoCode
    || !filters?.vehicleCategories?.length || !filters?.fuels?.length || filters?.archiveScope !== "ACTIVE_ONLY"
    || v.timePeriod !== "2" || report.metricKind !== "active_stock" || report.source !== "vahan-public-dashboard"
    || !Array.isArray(categories) || categories.reduce((sum, row) => sum + row.count, 0) !== report.reportTotal
    || categories.some((row) => !filters.vehicleCategories.includes(row.category) || !Number.isSafeInteger(row.count) || row.count < 0)
    || v.topFiveTotal !== makerTotal || report.evidence.topFiveTotal !== makerTotal
    || JSON.stringify(report.evidence.topMakerRows) !== JSON.stringify(report.rows)
    || (report.reportTotal === 0 && v.zeroConfirmed !== true)) {
    throw new Error("Invalid VAHAN report: source scope evidence is unverified.");
  }
}

export async function resolvePublicStockScope({ state, rto, vehicleCategories, vehicleClasses, fuels, fetchImpl = fetch, beforeRequest = async () => {}, timeoutMs = 25000 }) {
  let entries = cache.get(fetchImpl);
  if (!entries) { entries = new Map(); cache.set(fetchImpl, entries); }
  const load = async (path, json) => {
    const key = path;
    const cached = entries.get(key);
    if (cached && Date.now() - cached.at < 3600000) return cached.promise;
    const promise = (async () => {
      await beforeRequest();
      const response = await fetchImpl(PUBLIC_ORIGIN + path, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: json ? "application/json" : "text/html", "x-requested-with": "XMLHttpRequest" } });
      if (!response.ok) throw new Error(`Public Dashboard catalog returned HTTP ${response.status}.`);
      return json ? response.json() : response.text();
    })();
    entries.set(key, { at: Date.now(), promise });
    try { return await promise; } catch (error) { entries.delete(key); throw error; }
  };
  const html = await load(PUBLIC_PAGE_PATH, false);
  const selectedState = resolvePublicState(publicSelectOptions(html, "stateCode"), state);
  const catalog = await load(`/analytics/json_rtos?stateCode=${encodeURIComponent(selectedState.value)}`, true);
  const selectedRto = resolvePublicRto(catalog, rto, selectedState.value);
  const values = (id, wanted) => {
    const options = publicSelectOptions(html, id);
    return wanted.map((value) => {
      const matches = options.filter((option) => normalize(option.value) === normalize(value) || normalize(option.label) === normalize(value));
      if (matches.length !== 1 || !matches[0].value) throw new Error(`Public Dashboard filter mapping is invalid: ${id}=${value}.`);
      return matches[0].value;
    });
  };
  if (!vehicleCategories?.length || !fuels?.length) throw new Error("RTO stock requests require explicit category and fuel filters.");
  return {
    stateCode: selectedState.value, rtoCode: String(selectedRto.rtoCode),
    vehicleCategories: values("vehicleSubCategory", vehicleCategories),
    vehicleClasses: values("vehicleClass", vehicleClasses ?? []), fuels: values("vehicleFuel", fuels),
    mapping: { state, rto, stateLabel: selectedState.label, rtoLabel: selectedRto.rtoName, stateCode: selectedState.value, rtoCode: String(selectedRto.rtoCode), catalogHash: createHash("sha256").update(JSON.stringify(catalog)).digest("hex"), verifiedAt: new Date().toISOString() },
  };
}
