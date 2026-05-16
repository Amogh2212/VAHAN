import process from "node:process";
import pg from "pg";

const { Pool } = pg;

let pool = null;

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: connectionStringForPg(),
      ssl: shouldUseSsl() ? true : undefined,
    });
  }
  return pool;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function closePool() {
  if (!pool) return;
  await pool.end();
  pool = null;
}

function shouldUseSsl() {
  if (process.env.PGSSL === "false") return false;
  if (process.env.DATABASE_URL?.includes("sslmode=disable")) return false;
  return true;
}

function connectionStringForPg() {
  const value = process.env.DATABASE_URL;
  if (!value || !shouldUseSsl()) return value;

  try {
    const url = new URL(value);
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return value;
  }
}
