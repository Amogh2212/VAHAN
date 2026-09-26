export const MAP_EV_FUELS = ["ELECTRIC(BOV)", "PURE EV"];
export const MAP_EV_FUEL_CONTEXT = MAP_EV_FUELS.join("|");
export const MAP_ALL_RTO = "All Vahan4 Running Office";

export function normalizeMapEvidenceState(state) {
  return ({
    "Andaman & Nicobar Island": "Andaman and Nicobar Islands",
    "UT of DNH and DD": "Dadra and Nagar Haveli",
    "Jammu and Kashmir": "Jammu & Kashmir",
  })[state] ?? state;
}

function monthKey(row) {
  return `${row.year}-${String(row.month).padStart(2, "0")}`;
}

export function requestedMapMonths(from, to) {
  if (!/^\d{4}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}$/.test(to ?? "") || from > to) return [];
  if ([from, to].some((value) => Number(value.slice(5)) < 1 || Number(value.slice(5)) > 12)) return [];
  const months = [];
  let [year, month] = from.split("-").map(Number);
  while (`${year}-${String(month).padStart(2, "0")}` <= to) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) { year += 1; month = 1; }
  }
  return months;
}

function matchesSideContext(row, context) {
  return ["vehicle_category_filter", "norms_filter", "vehicle_class_filter"]
    .every((key) => (row[key] ?? "ALL") === (context[key] ?? "ALL"));
}

function sumFuelRows(rows, context) {
  const matching = rows.filter((row) => (row.fuel_filter ?? "ALL") === context);
  const byFuel = new Map();
  for (const row of matching) {
    if (!MAP_EV_FUELS.includes(row.fuel_type)) continue;
    if (!byFuel.has(row.fuel_type)) byFuel.set(row.fuel_type, []);
    byFuel.get(row.fuel_type).push(row);
  }
  if (!MAP_EV_FUELS.every((fuel) => byFuel.has(fuel))) return null;
  return {
    total: MAP_EV_FUELS.reduce((sum, fuel) => sum + Number(byFuel.get(fuel)[0].vehicle_count), 0),
    rows: MAP_EV_FUELS.map((fuel) => byFuel.get(fuel)[0]),
    duplicated: MAP_EV_FUELS.some((fuel) => byFuel.get(fuel).length !== 1),
  };
}

export function auditMapStateEvidence(rows, { states = [], from, to, now = new Date(), context = {} } = {}) {
  const months = requestedMapMonths(from, to);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Calcutta", year: "numeric", month: "2-digit" }).formatToParts(now);
  const currentMonth = `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}`;
  const grouped = new Map();
  for (const row of rows) {
    if (row.rto !== MAP_ALL_RTO || !matchesSideContext(row, context)) continue;
    const key = `${normalizeMapEvidenceState(row.state)}\u0000${monthKey(row)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const stateNames = states.length ? states : [...new Set(rows.map((row) => normalizeMapEvidenceState(row.state)))].sort();
  return stateNames.map((state) => {
    const monthEvidence = months.map((month) => {
      const scopeRows = grouped.get(`${state}\u0000${month}`) ?? [];
      const totalRows = scopeRows.filter((row) => row.fuel_type === "ALL" && (row.fuel_filter ?? "ALL") === "ALL");
      const totalRow = totalRows[0];
      const total = totalRow ? Number(totalRow.vehicle_count) : null;
      const evEvidence = sumFuelRows(scopeRows, MAP_EV_FUEL_CONTEXT) ?? sumFuelRows(scopeRows, "ALL");
      const ev = evEvidence?.total ?? null;
      const issues = [];
      if (total === null) issues.push("missing_total");
      if (ev === null) issues.push("missing_ev_fuels");
      if (totalRows.length > 1) issues.push("duplicate_total_scope");
      if (evEvidence?.duplicated) issues.push("duplicate_ev_scope");
      if ((total !== null && (!Number.isSafeInteger(total) || total < 0)) ||
        (ev !== null && (!Number.isSafeInteger(ev) || ev < 0))) issues.push("invalid_count");
      if (total !== null && ev !== null && ev > total) issues.push("ev_exceeds_total");
      const evidenceDates = [totalRow, ...(evEvidence?.rows ?? [])].map((row) => Date.parse(row?.scraped_at));
      if (total !== null && ev !== null && evidenceDates.some((date) => !Number.isFinite(date))) issues.push("missing_capture_time");
      if (evidenceDates.every(Number.isFinite) && evidenceDates.length === 3 &&
        Math.max(...evidenceDates) - Math.min(...evidenceDates) > 30 * 60_000) issues.push("scope_timestamp_mismatch");
      if (month === currentMonth && evidenceDates.every(Number.isFinite) && evidenceDates.length === 3 &&
        now.getTime() - Math.min(...evidenceDates) > 24 * 60 * 60_000) issues.push("stale_current_month");
      return {
        month, total, ev, issues,
        totalCapturedAt: totalRow?.scraped_at ?? null,
        evCapturedAt: evEvidence?.rows.map((row) => row.scraped_at) ?? [],
        totalSource: totalRow?.source_url ?? null,
        evSources: evEvidence?.rows.map((row) => row.source_url) ?? [],
      };
    });
    const missingMonths = monthEvidence.filter((item) => item.issues.length);
    const complete = months.length > 0 && missingMonths.length === 0;
    const total = complete ? monthEvidence.reduce((sum, item) => sum + item.total, 0) : null;
    const evTotal = complete ? monthEvidence.reduce((sum, item) => sum + item.ev, 0) : null;
    return {
      state,
      status: complete ? "complete" : "incomplete",
      total,
      evTotal,
      evShare: total > 0 ? evTotal / total : null,
      months: monthEvidence,
      missingMonths,
    };
  });
}
