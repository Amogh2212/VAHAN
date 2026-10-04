import { canonicalRtoLabel } from "./rto-resolver.mjs";

const CONTEXT_FIELDS = ["fuel_filter", "vehicle_category_filter", "norms_filter", "vehicle_class_filter"];
const isAggregate = (row) => String(row.fuel_type ?? "").trim().toUpperCase() === "ALL";

// ALL is the total for a scope, not an additional fuel. Apply this at the
// answer boundary too: database and completed-refresh rows bypass CSV filters.
export function selectRegistrationAnswerRows(rows = []) {
  const groups = new Map();
  for (const input of rows) {
    const row = { ...input, rto: canonicalRtoLabel(input.state, input.rto) };
    const key = JSON.stringify([
      row.year, row.month, row.state, row.rto,
      ...CONTEXT_FIELDS.map((field) => row[field] ?? "ALL"),
    ]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].flatMap((group) => {
    const aggregates = group.filter(isAggregate);
    const candidates = aggregates.length ? aggregates : group;
    const latest = new Map();
    for (const row of candidates) {
      const key = String(row.fuel_type ?? "").trim().toUpperCase();
      const previous = latest.get(key);
      if (!previous || String(row.scraped_at ?? "") > String(previous.scraped_at ?? "")) latest.set(key, row);
    }
    return [...latest.values()];
  });
}

export function registrationFuelBreakdown(rows = [], supplied = null) {
  const total = rows.reduce((sum, row) => sum + Number(row.vehicle_count ?? 0), 0);
  const validSupplied = Array.isArray(supplied) && supplied.length && supplied.every((item) =>
    String(item.fuelType ?? "").trim().toUpperCase() !== "ALL" &&
    item.fuelType && Number.isFinite(item.count) && item.count >= 0);
  if (validSupplied && supplied.reduce((sum, item) => sum + item.count, 0) === total) return supplied;
  // A partial fuel chart across a multi-month range looks like a complete
  // composition. Withhold it if any selected scope only has aggregate totals.
  if (!rows.length || rows.some(isAggregate)) return [];
  const byFuel = new Map();
  for (const row of rows) byFuel.set(row.fuel_type, (byFuel.get(row.fuel_type) ?? 0) + Number(row.vehicle_count ?? 0));
  return [...byFuel.entries()].sort((a, b) => b[1] - a[1]).map(([fuelType, count]) => ({ fuelType, count }));
}
