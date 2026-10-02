import { createHash } from "node:crypto";
import { hasDatabaseUrl, query, transaction } from "./db.mjs";
import { resolvePublicRegistrationScope } from "./public-dashboard-scope.mjs";
import { publicChartQueryString, parsePublicCategoryDistribution } from "./public-dashboard-client.mjs";
import { RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS, snapshotDateKey } from "./rto-daily-snapshots.mjs";

export const ANNUAL_OEM_SOURCE = "https://analytics.parivahan.gov.in/analytics/publicdashboard/vahan?lang=en";
export const ANNUAL_OEM_CONTRACT = "public-registration-calendar-year-v1";
const origin = "https://analytics.parivahan.gov.in";
const aggregate = /^(?:others?|other\s*\/\s*untracked)$/i;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function validateAnnualRequest({ state, rto, date }) {
  if (!String(state ?? "").trim() || !String(rto ?? "").trim()) throw new Error("State and RTO are required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("A valid observation date (YYYY-MM-DD) is required.");
  return Number(date.slice(0, 4));
}

export function parseAnnualMakers(response) {
  const labels = response?.labels;
  const counts = response?.datasets?.[0]?.data;
  if (!Array.isArray(labels) || !Array.isArray(counts) || labels.length !== counts.length || labels.length > 5) throw new Error("Invalid annual maker response.");
  const seen = new Set();
  const rows = labels.map((value, index) => {
    const name = String(value ?? "").trim();
    const count = counts[index];
    if (!name || seen.has(name.toUpperCase()) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new Error("Invalid or duplicate annual maker value.");
    seen.add(name.toUpperCase());
    return { name, count, sourceRank: index + 1 };
  });
  const named = rows.filter((row) => !aggregate.test(row.name));
  if (named.some((row, index) => index && row.count > named[index - 1].count)) throw new Error("Annual named makers are not ranked by registration count.");
  return rows;
}

export async function fetchAnnualOemSegment({ state, rto, year, vehicleCategories, vehicleClasses = [], fuels, fetchImpl = fetch, beforeRequest = async () => {}, timeoutMs = 25000 }) {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new Error("Invalid calendar year.");
  const scope = await resolvePublicRegistrationScope({ state, rto, vehicleCategories, vehicleClasses, fuels, fetchImpl, beforeRequest, timeoutMs });
  const filters = { fromYear: String(year), toYear: String(year), stateCode: scope.stateCode, rtoCode: scope.rtoCode,
    vehicleClasses: scope.vehicleClasses, vehicleMakers: [], vehicleSubCategories: scope.vehicleCategories,
    vehicleEmissions: [], vehicleFuels: scope.fuels, timePeriod: "0", vehicleCategoryGroup: [], evType: [],
    vehicleStatus: [], vehicleOwnerType: [], fitnessCheck: "0", vehicleType: "",
    archiveTypeAC: "ACTIVE_COMPLIANT", archiveTypeANC: "ACTIVE_NON_COMPLIANT", archiveTypePA: "", archiveTypeTA: "", archiveTypeNA: "" };
  const responses = [];
  const read = async (path, extra = {}) => {
    await beforeRequest();
    const url = `${origin}${path}?${publicChartQueryString({ ...filters, ...extra })}`;
    const response = await fetchImpl(url, { headers: { accept: "application/json", "x-requested-with": "XMLHttpRequest" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Annual OEM source returned HTTP ${response.status}.`);
    const result = { url, body: await response.json() };
    responses.push(result);
    return result;
  };
  try {
    const makers = await read("/analytics/publicdashboard/vahandashboard/top5Makerchart");
    const categories = await read("/analytics/publicdashboard/vahandashboard/categoriesdonutchart");
    const headline = await read("/analytics/publicdashboard/vahan/registration/dashboardcount", { viewModes: "registration" });
    const rawText = String(headline.body?.totalTransactions ?? "");
    if (!/^\d[\d,]*$/.test(rawText)) throw new Error("Annual headline is not explicitly reported.");
    const total = Number(rawText.replaceAll(",", ""));
    const categoryRows = parsePublicCategoryDistribution(categories.body);
    const rows = parseAnnualMakers(makers.body);
    const makerTotal = rows.reduce((sum, row) => sum + row.count, 0);
    if (!Number.isSafeInteger(total) || categoryRows.some((row) => !scope.vehicleCategories.includes(row.category))
      || categoryRows.reduce((sum, row) => sum + row.count, 0) !== total || makerTotal > total
      || (total > 0 && !rows.length)) throw new Error("Annual headline, category, or maker evidence does not reconcile.");
    const observedAt = new Date().toISOString();
    return { status: "verified", year, total, explicitZero: total === 0, makers: rows, raw: { makers: makers.body, categories: categories.body, headline: headline.body },
      filters, mapping: scope.mapping, observedAt, contract: ANNUAL_OEM_CONTRACT,
      requests: [makers.url, categories.url, headline.url],
      requestHash: hash([makers.url, categories.url, headline.url]), responseHash: hash([makers.body, categories.body, headline.body]),
      otherUntracked: total - makerTotal };
  } catch (error) {
    error.annualEvidence = { filters, mapping: scope.mapping, sourceResponses: responses, observedAt: new Date().toISOString(), year };
    throw error;
  }
}

export function annualRankingPayload({ state, rto, date }, observations = [], reason = "No saved annual OEM evidence for this selection.") {
  const year = validateAnnualRequest({ state, rto, date });
  const segments = ["EV", "ICE"].flatMap((fuelGroup) => ["2W", "3W", "4W"].map((vehicleCategory) => {
    const row = observations.find((item) => item.fuel_group === fuelGroup && item.vehicle_category === vehicleCategory);
    const evidence = row?.evidence;
    const verified = row?.status === "verified" && evidence?.contract === ANNUAL_OEM_CONTRACT;
    const makers = verified ? (evidence.makers ?? []).filter((maker) => !aggregate.test(maker.name)).map((maker, index) => ({ ...maker, rank: index + 1 })) : [];
    return { fuelGroup, vehicleCategory, status: verified ? "verified" : "unavailable", reason: verified ? null : row?.error_reason ?? reason,
      year, observationDate: row?.observation_date ? String(row.observation_date).slice(0, 10) : null,
      observedAt: verified ? evidence.observedAt : null, total: verified ? evidence.total : null,
      explicitZero: verified && evidence.explicitZero === true, rankingComplete: verified && (makers.length === 5 || evidence.explicitZero === true), makers };
  }));
  return { state, rto, date, year, metricKind: "registration_calendar_year", source: ANNUAL_OEM_SOURCE, segments };
}

export async function getAnnualOemRankings(params, queryImpl = query) {
  const year = validateAnnualRequest(params);
  if (queryImpl === query && !hasDatabaseUrl()) return annualRankingPayload(params, [], "Saved annual OEM database is not configured.");
  try {
    const result = await queryImpl(`select distinct on (o.fuel_group, o.vehicle_category) o.*, o.observation_date::text as observation_date
      from rto_oem_annual_observations o
      where o.state=$1 and o.rto=$2 and o.calendar_year=$3 and o.observation_date <= $4::date
      order by o.fuel_group, o.vehicle_category, o.observation_date desc, o.observed_at desc, o.run_id desc`, [params.state, params.rto, year, params.date]);
    return annualRankingPayload(params, result.rows);
  } catch (error) {
    if (error.code !== "42P01") throw error;
    return annualRankingPayload(params, [], "Annual OEM storage migration has not been applied.");
  }
}

export async function saveAnnualOemObservation({ runId, state, rto, fuelGroup, vehicleCategory, date, evidence, failureEvidence = null, errorReason = null }, transact = transaction) {
  const year = validateAnnualRequest({ state, rto, date });
  if (!["EV", "ICE"].includes(fuelGroup) || !["2W", "3W", "4W"].includes(vehicleCategory)) throw new Error("Invalid annual OEM segment.");
  if (evidence && (evidence.contract !== ANNUAL_OEM_CONTRACT || evidence.year !== year || evidence.filters?.timePeriod !== "0"
    || evidence.filters.fromYear !== String(year) || evidence.filters.toYear !== String(year)
    || evidence.mapping?.state !== state || evidence.mapping?.rto !== rto || evidence.status !== "verified")) throw new Error("Annual evidence does not match its saved scope.");
  if (!evidence && !errorReason) throw new Error("Unavailable annual evidence requires a reason.");
  if (evidence) {
    if (!Number.isFinite(Date.parse(evidence.observedAt)) || snapshotDateKey(new Date(evidence.observedAt), "Asia/Kolkata") !== date) throw new Error("Annual evidence observation time does not match its IST date.");
    const equalList = (a, b) => Array.isArray(a) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    if (!equalList(evidence.filters.vehicleFuels, RTO_DAILY_FUEL_FILTERS[fuelGroup])
      || !equalList(evidence.filters.vehicleSubCategories, RTO_DAILY_CATEGORY_FILTERS[vehicleCategory].vehicleCategories)
      || !equalList(evidence.filters.vehicleClasses, RTO_DAILY_CATEGORY_FILTERS[vehicleCategory].vehicleClasses)) throw new Error("Annual filters do not match the fuel/category scope.");
    const rawMakers = parseAnnualMakers(evidence.raw?.makers);
    const categories = parsePublicCategoryDistribution(evidence.raw?.categories);
    const makerTotal = rawMakers.reduce((sum, maker) => sum + maker.count, 0);
    if (JSON.stringify(rawMakers) !== JSON.stringify(evidence.makers) || !Number.isSafeInteger(evidence.total) || evidence.total < 0
      || makerTotal > evidence.total || (evidence.total > 0 && !rawMakers.length)
      || categories.reduce((sum, category) => sum + category.count, 0) !== evidence.total
      || evidence.explicitZero !== (evidence.total === 0) || evidence.otherUntracked !== evidence.total - makerTotal
      || evidence.requestHash !== hash(evidence.requests) || evidence.responseHash !== hash([evidence.raw.makers,evidence.raw.categories,evidence.raw.headline])) throw new Error("Invalid annual evidence persistence payload.");
  }
  await transact(async (execute) => {
    const run = await execute("select calendar_year,observation_date::text as date,cohort from rto_oem_annual_collection_runs where id=$1 for share", [runId]);
    if (!run.rows[0] || run.rows[0].calendar_year !== year || run.rows[0].date !== date
      || !run.rows[0].cohort.some((member) => member.state === state && member.rto === rto)) throw new Error("Annual observation does not match its frozen collection run.");
    await execute(`insert into rto_oem_annual_observations
      (run_id,state,rto,fuel_group,vehicle_category,calendar_year,observation_date,observed_at,status,evidence,error_reason)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
      on conflict (run_id,state,rto,fuel_group,vehicle_category) do update set
      observed_at=excluded.observed_at,status=excluded.status,evidence=excluded.evidence,error_reason=excluded.error_reason`,
    [runId, state, rto, fuelGroup, vehicleCategory, year, date, evidence?.observedAt ?? new Date().toISOString(), evidence ? "verified" : "unavailable", JSON.stringify(evidence ?? failureEvidence ?? {}), errorReason]);
  });
}

export function annualOemCsvRows(ranking) {
  if (!ranking) return [];
  return [[], ["Calendar-year OEM registrations"], ["state","rto","calendar_year","observation_date","fuel","category","rank","maker","registrations","status","reason"],
    ...ranking.segments.flatMap((segment) => (segment.makers.length ? segment.makers : [{ name: "", rank: "", count: segment.explicitZero ? 0 : "" }]).map((maker) => [ranking.state, ranking.rto, ranking.year, segment.observationDate ?? "", segment.fuelGroup, segment.vehicleCategory, maker.rank, maker.name, maker.count, segment.status, segment.reason ?? (segment.rankingComplete ? "" : "Fewer than five named makers reported")]))];
}

export function annualOemHtml(ranking) {
  if (!ranking) return "";
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
  return `<section><h2>Calendar-year OEM registrations · ${escape(ranking.year)}</h2><p>Annual chart evidence, independent of this report's cadence. Source: VAHAN Public Dashboard.</p><table><thead><tr><th>Fuel / category</th><th>Observed</th><th>Rank / maker</th><th>Registrations</th><th>Availability</th></tr></thead><tbody>${ranking.segments.flatMap((s) => (s.makers.length ? s.makers : [{ name: s.explicitZero ? "Confirmed zero" : "Unavailable", count: s.explicitZero ? 0 : "", rank: "" }]).map((m) => `<tr><td>${escape(s.fuelGroup)} / ${escape(s.vehicleCategory)}</td><td>${escape(s.observationDate)}</td><td>${escape(m.rank)} ${escape(m.name)}</td><td>${escape(m.count)}</td><td>${escape(s.reason ?? (s.rankingComplete ? "Verified" : "Fewer than five named makers reported"))}</td></tr>`)).join("")}</tbody></table></section>`;
}
