// Copies only the fixed-baseline OEM tables. Never writes to the source.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import pg from "pg";

const scope = 'baseline_id, state COLLATE "C", rto COLLATE "C", fuel_group COLLATE "C", vehicle_category COLLATE "C"';
const tables = [
  ["baselines", "id", true],
  ["scopes", scope, false],
  ["makers", scope + ', maker_id COLLATE "C"', false],
  ["daily_runs", "id", true],
  ["observations", scope + ', maker_id COLLATE "C", observation_date', false],
  ["observation_history", "id", true],
  ["refresh_attempts", "id", true],
];
const schema = new URL("../db/rto-oem-tracking.sql", import.meta.url);

function parseDirectUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Both direct database URLs must be configured."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname.includes("-pooler.")) {
    throw new Error("Use direct PostgreSQL connections (not pooled).");
  }
  return url;
}

function makeClient(url) {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode"))) {
    throw new Error("Remote connections must require TLS.");
  }
  return new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 15000 });
}

async function scan(client, table, order, consume = async () => {}) {
  const hash = createHash("sha256");
  let count = 0;
  await client.query(`declare oem_copy_scan no scroll cursor for select to_jsonb(t)::text as row from public.${table} t order by ${order}`);
  try {
    while (true) {
      const { rows } = await client.query("fetch forward 250 from oem_copy_scan");
      if (!rows.length) break;
      const data = rows.map(({ row }) => row);
      for (const row of data) hash.update(row).update("\n");
      count += data.length;
      await consume(data);
    }
  } finally { await client.query("close oem_copy_scan").catch(() => {}); }
  return { count, sha256: hash.digest("hex") };
}

export async function copyOemTracking({ sourceUrl, targetUrl, expectedSourceHost, expectedTargetHost, log = () => {} }) {
  const src = parseDirectUrl(sourceUrl);
  const dst = parseDirectUrl(targetUrl);
  if (src.hostname === dst.hostname && src.port === dst.port && src.pathname === dst.pathname) {
    throw new Error("Refusing to copy into the source database.");
  }
  for (const [url, expected] of [[src, expectedSourceHost], [dst, expectedTargetHost]]) {
    if (!expected || url.hostname !== expected) throw new Error("A database hostname did not match its explicit guard.");
  }
  const source = makeClient(src);
  const target = makeClient(dst);
  let step = "connect to both databases";
  try {
    await Promise.all([source.connect(), target.connect()]);
    await source.query("begin isolation level repeatable read read only");
    await target.query("begin");
    for (const conn of [source, target]) {
      await conn.query("set local time zone 'UTC'; set local search_path to public, pg_catalog; set local statement_timeout = '120s'; set local lock_timeout = '10s'");
    }
    step = "check source and initialize empty target";
    const active = await source.query("select 1 from public.rto_oem_tracking_baselines where is_active");
    if (active.rowCount !== 1) throw new Error("Source does not have exactly one active OEM baseline.");
    await target.query(await fs.readFile(schema, "utf8"));
    await target.query(`lock table ${tables.map(([suffix]) => `public.rto_oem_tracking_${suffix}`).join(", ")} in access exclusive mode`);
    for (const [suffix] of tables) {
      const { rowCount } = await target.query(`select 1 from public.rto_oem_tracking_${suffix} limit 1`);
      if (rowCount) throw new Error("Target contains existing OEM rows.");
    }

    const manifest = {};
    for (const [suffix, order, serial] of tables) {
      const table = `rto_oem_tracking_${suffix}`;
      step = `copy and verify ${table}`;
      const original = await scan(source, table, order, async (rows) => {
        // Pass source JSON as strings so JS never rounds bigint values.
        await target.query(`insert into public.${table} select * from jsonb_populate_recordset(null::public.${table}, $1::jsonb)`, [`[${rows.join(",")}]`]);
      });
      assert.deepEqual(await scan(target, table, order), original, `Copy mismatch for ${table}`);
      if (serial) {
        const sequence = `public.${table}_id_seq`;
        const { rows: [seq] } = await source.query(`select last_value::text, is_called from ${sequence}`);
        const floor = (await target.query(`select coalesce(max(id),0)::text as max_id from public.${table}`)).rows[0].max_id;
        const [value, called] = BigInt(seq.last_value) > BigInt(floor)
          ? [seq.last_value, seq.is_called] : [BigInt(floor) > 0n ? floor : seq.last_value, BigInt(floor) > 0n || seq.is_called];
        // ALTER SEQUENCE is transactional (unlike setval).
        const next = BigInt(value) + (called ? 1n : 0n);
        await target.query(`alter sequence ${sequence} restart with ${next}`);
      }
      manifest[table] = original;
    }
    step = "commit verified copy";
    await target.query("commit");
    await source.query("rollback");
    for (const [name, { count }] of Object.entries(manifest)) log(`${name}: ${count} rows verified`);
    return manifest;
  } catch (error) {
    await Promise.allSettled([source.query("rollback"), target.query("rollback")]);
    // PostgreSQL may include source row values in details. Do not surface them.
    throw new Error(`OEM copy failed during ${step}${/^[A-Z0-9]{5}$/.test(error.code ?? "") ? ` (${error.code})` : ""}. No source rows were changed.`, { cause: error });
  } finally { await Promise.allSettled([source.end(), target.end()]); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== "--copy-to-empty") {
    console.error("Use --copy-to-empty after pausing OEM writes. Set OEM_COPY_SOURCE_URL, OEM_COPY_TARGET_URL and both OEM_COPY_*_HOST guards.");
    process.exitCode = 1;
  } else {
    await copyOemTracking({
      sourceUrl: process.env.OEM_COPY_SOURCE_URL,
      targetUrl: process.env.OEM_COPY_TARGET_URL,
      expectedSourceHost: process.env.OEM_COPY_SOURCE_HOST,
      expectedTargetHost: process.env.OEM_COPY_TARGET_HOST,
      log: console.log,
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
