import fs from "node:fs/promises";
import { hasDatabaseUrl, query } from "./db.mjs";

const ALL_RTO = "All Vahan4 Running Office";
const ALL_FILTER = "ALL";
const FILTER_CONTEXT_FIELDS = [
  ["fuel_filter", "fuelFilters"],
  ["vehicle_category_filter", "vehicleCategories"],
  ["norms_filter", "norms"],
  ["vehicle_class_filter", "vehicleClasses"],
];

export const REGISTRATION_HEADERS = [
  "year",
  "month",
  "state",
  "rto",
  "fuel_segment",
  "fuel_type",
  "fuel_filter",
  "vehicle_category_filter",
  "norms_filter",
  "vehicle_class_filter",
  "vehicle_count",
  "scraped_at",
  "source_url",
];

export function parseCsvLine(line) {
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

export async function readRegistrationsCsv(filePath) {
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  const [headerLine, ...lines] = content.trim().split(/\r?\n/).filter(Boolean);
  if (!headerLine) return [];

  const headers = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    return normalizeRegistrationRow(row);
  });
}

export function normalizeRegistrationRow(row) {
  return {
    year: Number(row.year),
    month: Number(row.month),
    state: String(row.state ?? "").trim(),
    rto: String(row.rto ?? "").trim(),
    fuel_segment: String(row.fuel_segment ?? "").trim(),
    fuel_type: String(row.fuel_type ?? "").trim(),
    fuel_filter: String(row.fuel_filter ?? "ALL").trim() || "ALL",
    vehicle_category_filter: String(row.vehicle_category_filter ?? "ALL").trim() || "ALL",
    norms_filter: String(row.norms_filter ?? "ALL").trim() || "ALL",
    vehicle_class_filter: String(row.vehicle_class_filter ?? "ALL").trim() || "ALL",
    vehicle_count: Number(row.vehicle_count || 0),
    scraped_at: row.scraped_at ? new Date(row.scraped_at).toISOString() : new Date().toISOString(),
    source_url: String(row.source_url ?? "").trim(),
  };
}

export async function loadRegistrationRowsFromDb() {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is not configured");
  }
  const result = await query(
    `
      select
        year,
        month,
        state,
        rto,
        fuel_segment,
        fuel_type,
        coalesce(fuel_filter, 'ALL') as fuel_filter,
        coalesce(vehicle_category_filter, 'ALL') as vehicle_category_filter,
        coalesce(norms_filter, 'ALL') as norms_filter,
        coalesce(vehicle_class_filter, 'ALL') as vehicle_class_filter,
        vehicle_count,
        scraped_at,
        source_url
      from registrations
      order by year, month, state, rto, fuel_filter, vehicle_category_filter, norms_filter, vehicle_class_filter, fuel_type
    `,
  );
  return result.rows.map(normalizeRegistrationRow);
}

export async function queryRegistrationRows(filters = {}, options = {}) {
  const { whereSql, values } = buildRegistrationWhere(filters, {
    includeDate: true,
    includeFuel: true,
    stateRtoMode: options.stateRtoMode ?? "aggregate",
  });
  const result = await query(
    `
      select
        year,
        month,
        state,
        rto,
        fuel_segment,
        fuel_type,
        coalesce(fuel_filter, 'ALL') as fuel_filter,
        coalesce(vehicle_category_filter, 'ALL') as vehicle_category_filter,
        coalesce(norms_filter, 'ALL') as norms_filter,
        coalesce(vehicle_class_filter, 'ALL') as vehicle_class_filter,
        vehicle_count,
        scraped_at,
        source_url
      from registrations
      ${whereSql}
      order by year, month, state, rto, fuel_filter, vehicle_category_filter, norms_filter, vehicle_class_filter, fuel_type
    `,
    values,
  );
  return result.rows.map(normalizeRegistrationRow);
}

export async function queryAvailableMonths(filters = {}) {
  const { whereSql, values } = buildRegistrationWhere(filters, { includeDate: true, includeFuel: false });
  const result = await query(
    `
      select distinct year, month
      from registrations
      ${whereSql}
      order by year, month
    `,
    values,
  );
  return result.rows.map((row) => ({ year: Number(row.year), month: Number(row.month) }));
}

export async function queryAvailableMonthFuelTypes(filters = {}) {
  const { whereSql, values } = buildRegistrationWhere(filters, { includeDate: true, includeFuel: true });
  const result = await query(
    `
      select distinct year, month, fuel_type
      from registrations
      ${whereSql}
      order by year, month, fuel_type
    `,
    values,
  );
  return result.rows.map((row) => ({
    year: Number(row.year),
    month: Number(row.month),
    fuelType: row.fuel_type,
  }));
}

export async function queryRtos(state = null) {
  const values = [];
  const clauses = [];
  if (state) {
    values.push(state);
    clauses.push(`state = $${values.length}`);
  }
  const result = await query(
    `
      select distinct state, rto
      from registrations
      ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
      order by state, rto
    `,
    values,
  );
  return result.rows.map((row) => ({ state: row.state, rto: row.rto }));
}

export async function queryRegistrationFreshness() {
  const result = await query(
    `
      select
        count(*)::int as row_count,
        max((year::text || '-' || lpad(month::text, 2, '0'))) as latest_month
      from registrations
    `,
  );
  return {
    rowCount: Number(result.rows[0]?.row_count ?? 0),
    latestMonth: result.rows[0]?.latest_month ?? null,
  };
}

export async function upsertRegistrationRows(rows, { batchSize = 500 } = {}) {
  if (!hasDatabaseUrl()) {
    return { skipped: true, count: 0 };
  }

  const normalizedRows = rows.map(normalizeRegistrationRow);
  let count = 0;
  for (let index = 0; index < normalizedRows.length; index += batchSize) {
    const batch = normalizedRows.slice(index, index + batchSize);
    await upsertBatch(batch);
    count += batch.length;
  }
  return { skipped: false, count };
}

export async function replaceRegistrationRows(rows, { batchSize = 500 } = {}) {
  if (!hasDatabaseUrl()) {
    return { skipped: true, count: 0 };
  }

  const normalizedRows = rows.map(normalizeRegistrationRow);
  await deleteRegistrationContexts(normalizedRows);

  let count = 0;
  for (let index = 0; index < normalizedRows.length; index += batchSize) {
    const batch = normalizedRows.slice(index, index + batchSize);
    await upsertBatch(batch);
    count += batch.length;
  }
  return { skipped: false, count };
}

async function deleteRegistrationContexts(rows) {
  const keys = new Map();
  for (const row of rows) {
    const key = [
      row.year,
      row.month,
      row.state,
      row.rto,
      row.fuel_filter,
      row.vehicle_category_filter,
      row.norms_filter,
      row.vehicle_class_filter,
    ].join("||");
    if (!keys.has(key)) {
      keys.set(key, [
        row.year,
        row.month,
        row.state,
        row.rto,
        row.fuel_filter,
        row.vehicle_category_filter,
        row.norms_filter,
        row.vehicle_class_filter,
      ]);
    }
  }
  const contexts = [...keys.values()];
  if (!contexts.length) return;

  const values = [];
  const clauses = contexts.map((context) => {
    const offset = values.length;
    values.push(...context);
    return `(
      year = $${offset + 1}
      and month = $${offset + 2}
      and state = $${offset + 3}
      and rto = $${offset + 4}
      and fuel_filter = $${offset + 5}
      and vehicle_category_filter = $${offset + 6}
      and norms_filter = $${offset + 7}
      and vehicle_class_filter = $${offset + 8}
    )`;
  });

  await query(`delete from registrations where ${clauses.join(" or ")}`, values);
}

async function upsertBatch(rows) {
  if (!rows.length) return;

  const columns = REGISTRATION_HEADERS;
  const values = [];
  const placeholders = rows.map((row, rowIndex) => {
    const offset = rowIndex * columns.length;
    values.push(...columns.map((column) => row[column]));
    return `(${columns.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
  });

  await query(
    `
      insert into registrations (
        year,
        month,
        state,
        rto,
        fuel_segment,
        fuel_type,
        fuel_filter,
        vehicle_category_filter,
        norms_filter,
        vehicle_class_filter,
        vehicle_count,
        scraped_at,
        source_url
      )
      values ${placeholders.join(", ")}
      on conflict (
        year,
        month,
        state,
        rto,
        fuel_type,
        fuel_filter,
        vehicle_category_filter,
        norms_filter,
        vehicle_class_filter
      )
      do update set
        fuel_segment = excluded.fuel_segment,
        vehicle_count = excluded.vehicle_count,
        scraped_at = excluded.scraped_at,
        source_url = excluded.source_url,
        updated_at = now()
    `,
    values,
  );
}

function buildRegistrationWhere(filters, { includeDate, includeFuel, stateRtoMode = "aggregate" }) {
  const values = [];
  const clauses = [];
  const add = (sql, value) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };
  const addIn = (column, list) => {
    const labels = uniqueLabels(list);
    if (!labels.length) return;
    const placeholders = labels.map((label) => {
      values.push(label.toLowerCase());
      return `$${values.length}`;
    });
    clauses.push(`lower(${column}) in (${placeholders.join(", ")})`);
  };
  const addNotIn = (column, list) => {
    const labels = uniqueLabels(list);
    if (!labels.length) return;
    const placeholders = labels.map((label) => {
      values.push(label.toLowerCase());
      return `$${values.length}`;
    });
    clauses.push(`lower(${column}) not in (${placeholders.join(", ")})`);
  };

  if (includeDate && filters.from) add(`(year * 100 + month) >= ?`, monthKeyNumber(filters.from));
  if (includeDate && filters.to) add(`(year * 100 + month) <= ?`, monthKeyNumber(filters.to));
  if (filters.state) add(`state = ?`, filters.state);
  if (filters.rto) {
    add(`rto = ?`, filters.rto);
  } else if (filters.rtoSearch) {
    add(`lower(rto) like ?`, `%${String(filters.rtoSearch).toLowerCase()}%`);
  } else if (filters.state && stateRtoMode === "aggregate") {
    add(`rto = ?`, ALL_RTO);
  }
  if (includeFuel) addIn("fuel_type", filters.selectedFuelTypes);
  if (includeFuel) addNotIn("fuel_type", filters.excludedFuelTypes);
  if (includeFuel && filters.fuelSegment) add(`fuel_segment = ?`, filters.fuelSegment);
  if (includeFuel && filters.fuelType) add(`lower(fuel_type) like ?`, `%${String(filters.fuelType).toLowerCase()}%`);

  const contextFilters = {
    ...filters,
    // Semantic queries keep exact fuel selections in selectedFuelTypes,
    // while persisted rows store the equivalent fuel_filter context.
    fuelFilters: filters.fuelFilters?.length
      ? filters.fuelFilters
      : filters.selectedFuelTypes ?? [],
  };
  for (const [column, key] of FILTER_CONTEXT_FIELDS) {
    add(`coalesce(${column}, 'ALL') = ?`, contextValue(contextFilters[key]));
  }

  return {
    whereSql: clauses.length ? `where ${clauses.join(" and ")}` : "",
    values,
  };
}

function uniqueLabels(values) {
  return [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function contextValue(values) {
  const items = Array.isArray(values) ? values : [];
  return items.length
    ? items.map((value) => String(value ?? "").trim()).filter(Boolean).sort().join("|")
    : ALL_FILTER;
}

function monthKeyNumber(value) {
  const [year, month] = String(value).split("-").map(Number);
  return year * 100 + month;
}
