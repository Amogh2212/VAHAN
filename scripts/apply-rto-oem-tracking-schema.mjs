import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { query, closePool } from "../lib/db.mjs";

export function oemTrackingSchemaDatabaseUrl(env, production = false) {
  const value = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured.");
  let url;
  try { url = new URL(value); } catch { throw new Error("DATABASE_URL must be a PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !production) {
    throw new Error("Remote OEM tracking schema application requires explicit --production.");
  }
  // Prefer a direct connection for DDL instead of a transaction-pooled endpoint.
  if (url.hostname.endsWith(".neon.tech")) url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
  return url.toString();
}

async function main() {
  // db.mjs initializes its pool lazily on the first query.
  process.env.DATABASE_URL = oemTrackingSchemaDatabaseUrl(process.env, process.argv.includes("--production"));
  try {
    await query(await fs.readFile(new URL("../db/rto-oem-tracking.sql", import.meta.url), "utf8"));
    console.log("Applied fixed-baseline daily OEM tracking schema.");
  } finally { await closePool(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
