import crypto from "node:crypto";
import { hasDatabaseUrl, query } from "./db.mjs";

export const PUBLIC_DASHBOARD_SOURCE_URL =
  "https://analytics.parivahan.gov.in/analytics/publicdashboard/vahan?lang=en";

const CANONICAL_FILTER_FIELDS = [
  "from", "to", "state", "rto", "rtoSearch", "fuelFilters", "selectedFuelTypes",
  "vehicleCategories", "norms", "vehicleClasses", "selectedVehicleGroups",
  "selectedVehicleClasses", "selectedVehicleCategories", "selectedNorms",
  "excludedVehicleGroups", "excludedVehicleCategories", "excludedNorms", "excludedVehicleClasses",
];

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (!value || typeof value !== "object") return value ?? null;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function canonicalRefreshFilters(filters = {}) {
  const selected = Object.fromEntries(
    CANONICAL_FILTER_FIELDS
      .filter((field) => filters[field] !== undefined && filters[field] !== null && filters[field] !== "")
      .map((field) => [field, filters[field]]),
  );
  return stableValue(selected);
}

export function canonicalRefreshJson(filters = {}) {
  return JSON.stringify(canonicalRefreshFilters(filters));
}

export function canonicalRefreshKey(filters = {}, refreshGroups = []) {
  const payload = JSON.stringify({
    filters: canonicalRefreshFilters(filters),
    months: stableValue(refreshGroups.map((group) => ({
      year: Number(group.year),
      months: [...new Set(group.months ?? [])].map(Number).sort((a, b) => a - b),
    }))),
    sourceUrl: PUBLIC_DASHBOARD_SOURCE_URL,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function publicDashboardRefreshEligibility(filters = {}) {
  if (!filters.from || !filters.to) return { eligible: false, reason: "A complete month range is required." };
  if (filters.excludedVehicleGroups?.length || filters.excludedVehicleCategories?.length || filters.excludedNorms?.length || filters.excludedVehicleClasses?.length) {
    return { eligible: false, reason: "Excluded dashboard filters cannot be verified against the public monthly endpoint." };
  }
  if (filters.selectedVehicleGroups?.length) {
    return { eligible: false, reason: "Broad vehicle-group filters are not yet mapped to the public monthly endpoint." };
  }
  for (const field of ["vehicleCategories", "norms", "vehicleClasses"]) {
    if ((filters[field] ?? []).length > 1) {
      return { eligible: false, reason: `Multiple ${field} filters cannot be verified exactly by the public scraper.` };
    }
  }
  const fuels = filters.fuelFilters?.length ? filters.fuelFilters : filters.selectedFuelTypes ?? [];
  if (fuels.length !== 1) {
    return { eligible: false, reason: "Automatic public refresh currently requires one exact fuel type." };
  }
  return { eligible: true, reason: null };
}

export async function createQueryRefreshAudit({
  canonicalKey, filters, requestedMonths, coverage, refreshJobId = null, outcome,
  sourceUrl = PUBLIC_DASHBOARD_SOURCE_URL,
} = {}) {
  if (!hasDatabaseUrl()) return { skipped: true, id: null };
  const result = await query(
    `insert into query_refresh_audits (
      canonical_key, filters_json, requested_months_json, coverage_json,
      refresh_job_id, source_url, outcome
    ) values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7) returning id`,
    [canonicalKey, canonicalRefreshJson(filters), JSON.stringify(requestedMonths ?? []), JSON.stringify(coverage ?? {}), refreshJobId, sourceUrl, outcome],
  );
  return { skipped: false, id: Number(result.rows[0]?.id ?? 0) || null };
}

export async function updateQueryRefreshAudit(id, { outcome, refreshJobId, error = null, coverage } = {}) {
  if (!id || !hasDatabaseUrl()) return { skipped: true };
  await query(
    `update query_refresh_audits
     set outcome = coalesce($2, outcome), refresh_job_id = coalesce($3, refresh_job_id),
         error_message = $4, coverage_json = coalesce($5::jsonb, coverage_json), updated_at = now()
     where id = $1`,
    [id, outcome ?? null, refreshJobId ?? null, error, coverage === undefined ? null : JSON.stringify(coverage)],
  );
  return { skipped: false };
}
