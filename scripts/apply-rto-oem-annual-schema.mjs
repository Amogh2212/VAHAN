import fs from "node:fs/promises";
import { query, closePool } from "../lib/db.mjs";
const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !process.argv.includes("--production")) throw new Error("Remote annual schema application requires explicit --production.");
try {
  await query(await fs.readFile(new URL("../db/rto-oem-annual.sql", import.meta.url), "utf8"));
  console.log("Applied independent annual OEM schema.");
} finally { await closePool(); }
