import process from "node:process";
import pg from "pg";

const { Pool } = pg;

let pool = null;
let oemPool = null;

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!pool) {
    pool = new Pool({
      ...poolOptions(process.env.DATABASE_URL),
    });
  }
  return pool;
}

export async function query(text, params = []) {
  return queryWithRetry(text, params);
}

export async function transaction(callback) {
  return transactWithPool(getPool, callback);
}

async function transactWithPool(poolProvider, callback) {
  const maxRetries = Math.max(0, Math.floor(Number(process.env.DB_MAX_RETRIES ?? 3)));
  let attempt = 0;

  while (true) {
    let client = null;
    let transactionStarted = false;
    try {
      client = await poolProvider().connect();
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

export function hasOemDatabaseUrl() {
  return Boolean(process.env.OEM_DATABASE_URL) || hasDatabaseUrl();
}

export function getOemPool() {
  const url = process.env.OEM_DATABASE_URL;
  if (!url) return getPool();
  if (!oemPool) oemPool = new Pool(poolOptions(url));
  return oemPool;
}

export async function queryOem(text, params = []) {
  return queryWithRetry(text, params, getOemPool);
}

export async function transactionOem(callback) {
  return transactWithPool(getOemPool, callback);
}

export async function closePool() {
  const existing = [pool, oemPool].filter(Boolean);
  pool = null;
  oemPool = null;
  await Promise.all(existing.map((entry) => entry.end()));
}

function poolOptions(value) {
  const useSsl = process.env.PGSSL !== "false" && !value.includes("sslmode=disable");
  let connectionString = value;
  if (useSsl) {
    try {
      const url = new URL(value);
      url.searchParams.delete("sslmode");
      connectionString = url.toString();
    } catch { /* pg will validate the original URL */ }
  }
  return { connectionString, ssl: useSsl ? true : undefined };
}

async function queryWithRetry(text, params, poolProvider = getPool) {
  const maxRetries = Math.max(0, Math.floor(Number(process.env.DB_MAX_RETRIES ?? 3)));
  let attempt = 0;

  while (true) {
    try {
      return await poolProvider().query(text, params);
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
