import fs from "node:fs/promises";
import { hasDatabaseUrl, query } from "./db.mjs";

const ALL_RTO = "All Vahan4 Running Office";
const ALL_FILTER = "ALL";

export const MAKER_REGISTRATION_HEADERS = [
  "year",
  "month",
  "state",
  "rto",
  "maker",
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

export async function readMakerRegistrationsCsv(filePath) {
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  const [headerLine, ...lines] = content.trim().split(/\r?\n/).filter(Boolean);
  if (!headerLine) return [];

  const headers = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    return normalizeMakerRegistrationRow(row);
  });
}

export async function readLegacyMakerFuelCsv(filePath) {
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  const [headerLine, ...lines] = content.trim().split(/\r?\n/).filter(Boolean);
  if (!headerLine) return [];

  const headers = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    return normalizeMakerRegistrationRow({
      year: row.year,
      month: row.month,
      state: row.state,
      rto: row.rto || ALL_RTO,
      maker: row.maker,
      fuel_filter: row.fuel_filter || row.fuel_type || ALL_FILTER,
      vehicle_category_filter: row.vehicle_category_filter || ALL_FILTER,
      norms_filter: row.norms_filter || ALL_FILTER,
      vehicle_class_filter: row.vehicle_class_filter || ALL_FILTER,
      vehicle_count: row.vehicle_count,
      scraped_at: row.scraped_at || row.collected_at,
      source_url: row.source_url,
    });
  });
}

export async function readTdcMakerRegistrationsCsv(filePath) {
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  const [headerLine, ...lines] = content.trim().split(/\r?\n/).filter(Boolean);
  if (!headerLine) return [];

  const headers = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const date = parseTdcDate(row.date);
    return normalizeMakerRegistrationRow({
      year: date.year,
      month: date.month,
      state: row.state_name,
      rto: row.office_name || ALL_RTO,
      maker: row.maker_company,
      vehicle_count: row.registrations,
      scraped_at: row.collected_at || row.scraped_at,
      source_url: row.source_url,
    });
  });
}

export function normalizeMakerRegistrationRow(row) {
  return {
    year: Number(row.year),
    month: Number(row.month),
    state: String(row.state ?? "").trim(),
    rto: String(row.rto ?? ALL_RTO).trim() || ALL_RTO,
    maker: String(row.maker ?? row.maker_company ?? "").trim(),
    fuel_filter: String(row.fuel_filter ?? ALL_FILTER).trim() || ALL_FILTER,
    vehicle_category_filter: String(row.vehicle_category_filter ?? ALL_FILTER).trim() || ALL_FILTER,
    norms_filter: String(row.norms_filter ?? ALL_FILTER).trim() || ALL_FILTER,
    vehicle_class_filter: String(row.vehicle_class_filter ?? ALL_FILTER).trim() || ALL_FILTER,
    vehicle_count: Number(row.vehicle_count ?? row.registrations ?? 0),
    scraped_at: row.scraped_at ? new Date(row.scraped_at).toISOString() : new Date().toISOString(),
    source_url: String(row.source_url ?? "").trim(),
  };
}

export async function queryMakerRegistrationRows(filters = {}) {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is not configured");
  }

  const { whereSql, values } = buildMakerRegistrationWhere(filters);
  const result = await query(
    `
      select
        year,
        month,
        state,
        rto,
        maker,
        coalesce(fuel_filter, 'ALL') as fuel_filter,
        coalesce(vehicle_category_filter, 'ALL') as vehicle_category_filter,
        coalesce(norms_filter, 'ALL') as norms_filter,
        coalesce(vehicle_class_filter, 'ALL') as vehicle_class_filter,
        vehicle_count,
        scraped_at,
        source_url
      from maker_registrations
      ${whereSql}
      order by year, month, state, rto, fuel_filter, vehicle_category_filter, norms_filter, vehicle_class_filter, maker
    `,
    values,
  );
  return result.rows.map(normalizeMakerRegistrationRow);
}

export async function upsertMakerRegistrationRows(rows, { batchSize = 500 } = {}) {
  if (!hasDatabaseUrl()) {
    return { skipped: true, count: 0 };
  }

  const normalizedRows = rows.map(normalizeMakerRegistrationRow).filter(isValidMakerRegistrationRow);
  let count = 0;
  for (let index = 0; index < normalizedRows.length; index += batchSize) {
    const batch = normalizedRows.slice(index, index + batchSize);
    await upsertMakerBatch(batch);
    count += batch.length;
  }
  return { skipped: false, count };
}

export async function replaceMakerRegistrationRows(rows, { batchSize = 500 } = {}) {
  if (!hasDatabaseUrl()) {
    return { skipped: true, count: 0 };
  }

  const normalizedRows = rows.map(normalizeMakerRegistrationRow).filter(isValidMakerRegistrationRow);
  await deleteMakerRegistrationContexts(normalizedRows);

  let count = 0;
  for (let index = 0; index < normalizedRows.length; index += batchSize) {
    const batch = normalizedRows.slice(index, index + batchSize);
    await upsertMakerBatch(batch);
    count += batch.length;
  }
  return { skipped: false, count };
}

function buildMakerRegistrationWhere(filters) {
  const values = [];
  const clauses = [];
  const add = (sql, value) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };

  if (filters.from) add(`(year * 100 + month) >= ?`, monthKeyNumber(filters.from));
  if (filters.to) add(`(year * 100 + month) <= ?`, monthKeyNumber(filters.to));
  if (filters.month) {
    const [year, month] = String(filters.month).split("-").map(Number);
    add(`year = ?`, year);
    add(`month = ?`, month);
  }
  if (filters.state) add(`state = ?`, filters.state);
  if (filters.rto) add(`rto = ?`, filters.rto);
  if (filters.maker) add(`lower(maker) like ?`, `%${String(filters.maker).toLowerCase()}%`);
  for (const key of ["fuel_filter", "vehicle_category_filter", "norms_filter", "vehicle_class_filter"]) {
    if (filters[key]) add(`${key} = ?`, filters[key]);
  }

  return {
    whereSql: clauses.length ? `where ${clauses.join(" and ")}` : "",
    values,
  };
}

async function deleteMakerRegistrationContexts(rows) {
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

  await query(`delete from maker_registrations where ${clauses.join(" or ")}`, values);
}

async function upsertMakerBatch(rows) {
  if (!rows.length) return;

  const columns = MAKER_REGISTRATION_HEADERS;
  const values = [];
  const placeholders = rows.map((row, rowIndex) => {
    const offset = rowIndex * columns.length;
    values.push(...columns.map((column) => row[column]));
    return `(${columns.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
  });

  await query(
    `
      insert into maker_registrations (
        year,
        month,
        state,
        rto,
        maker,
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
        maker,
        fuel_filter,
        vehicle_category_filter,
        norms_filter,
        vehicle_class_filter
      )
      do update set
        vehicle_count = excluded.vehicle_count,
        scraped_at = excluded.scraped_at,
        source_url = excluded.source_url,
        updated_at = now()
    `,
    values,
  );
}

function monthKeyNumber(value) {
  const [year, month] = String(value).split("-").map(Number);
  return year * 100 + month;
}

function parseTdcDate(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return { year: undefined, month: undefined };
  return { year: Number(match[1]), month: Number(match[2]) };
}

function isValidMakerRegistrationRow(row) {
  return (
    Number.isInteger(row.year) &&
    row.year >= 2000 &&
    row.year <= 2100 &&
    Number.isInteger(row.month) &&
    row.month >= 1 &&
    row.month <= 12 &&
    Boolean(row.state) &&
    Boolean(row.rto) &&
    Boolean(row.maker)
  );
}
