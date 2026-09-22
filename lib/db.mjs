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
  return queryWithRetry(text, params);
}

export async function transaction(callback) {
  const maxRetries = Math.max(0, Math.floor(Number(process.env.DB_MAX_RETRIES ?? 3)));
  let attempt = 0;

  while (true) {
    let client = null;
    let transactionStarted = false;
    try {
      client = await getPool().connect();
      await client.query("begin");
      transactionStarted = true;
      const result = await callback((text, params = []) => client.query(text, params));
      await client.query("commit");
      return result;
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("rollback").catch(() => {});
      }
      if (!isRetryableDatabaseError(error) || attempt >= maxRetries) {
        throw error;
      }
      attempt += 1;
      await sleep(retryDelayMs(attempt));
    } finally {
      client?.release();
    }
  }
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

async function queryWithRetry(text, params) {
  const maxRetries = Math.max(0, Math.floor(Number(process.env.DB_MAX_RETRIES ?? 3)));
  let attempt = 0;

  while (true) {
    try {
      return await getPool().query(text, params);
    } catch (error) {
      if (!isRetryableDatabaseError(error) || attempt >= maxRetries) {
        throw error;
      }
      attempt += 1;
      await sleep(retryDelayMs(attempt));
    }
  }
}

function isRetryableDatabaseError(error) {
  const retryableCodes = new Set([
    "40001", // serialization_failure
    "57P01", // admin_shutdown
    "ECONNRESET",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ETIMEDOUT",
  ]);
  return databaseErrorCodes(error).some((code) => retryableCodes.has(code));
}

function databaseErrorCodes(error) {
  const nested = Array.isArray(error?.errors) ? error.errors : [];
  return [error?.code, ...nested.map((item) => item?.code)].filter(Boolean);
}

function retryDelayMs(attempt) {
  const baseMs = Math.max(10, Math.floor(Number(process.env.DB_RETRY_BASE_MS ?? 100)));
  const capped = Math.min(2000, baseMs * 2 ** Math.max(0, attempt - 1));
  return capped + Math.floor(Math.random() * baseMs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
