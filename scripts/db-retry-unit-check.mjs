import assert from "node:assert/strict";
import process from "node:process";
import { closePool, transaction } from "../lib/db.mjs";

process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:1/vahan_rto_action_test";
process.env.PGSSL = "false";
process.env.DB_MAX_RETRIES = "1";
process.env.DB_RETRY_BASE_MS = "25";

const startedAt = Date.now();
await assert.rejects(() => transaction(async () => {}), (error) => {
  assert.equal(error.code, "ECONNREFUSED");
  return true;
});
const elapsedMs = Date.now() - startedAt;
assert.ok(elapsedMs >= 20, `Expected a retry delay for connection refusal; received ${elapsedMs}ms.`);
await closePool();

console.log("Database retry unit check passed.");
