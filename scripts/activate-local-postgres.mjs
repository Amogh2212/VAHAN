import { constants } from "node:fs";
import fs from "node:fs/promises";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

function envValue(text, key) {
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(text);
  if (!match) return null;
  const value = match[1].trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

async function main() {
  if (!process.argv.includes("--confirm-local-cutover")) {
    throw new Error("Refusing to switch .env without --confirm-local-cutover.");
  }
  const localEnv = await fs.readFile(".env.local-postgres", "utf8");
  const databaseUrl = envValue(localEnv, "DATABASE_URL");
  if (!databaseUrl) throw new Error(".env.local-postgres has no DATABASE_URL.");
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error(`Refusing cutover to non-local host ${url.hostname}.`);
  }

  const pool = new Pool({ connectionString: databaseUrl, ssl: false });
  try {
    const result = await pool.query("select count(*)::int as count from registrations");
    if (Number(result.rows[0].count) < 1) throw new Error("Local registrations table is empty; migration is not complete.");
  } finally {
    await pool.end();
  }

  await fs.copyFile(".env", ".env.cockroach.local", constants.COPYFILE_EXCL).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  await fs.copyFile(".env.local-postgres", ".env");
  console.log(JSON.stringify({ status: "activated", host: url.hostname, port: url.port, database: url.pathname.slice(1) }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
