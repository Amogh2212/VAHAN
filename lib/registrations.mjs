import fs from "node:fs/promises";
import { hasDatabaseUrl, query } from "./db.mjs";

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
