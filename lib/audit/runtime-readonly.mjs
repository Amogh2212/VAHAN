import crypto from "node:crypto";
import process from "node:process";
import { writeJsonExclusive } from "./artifacts.mjs";
import { REQUIRED_TABLES } from "./policy.mjs";

const SAFE_STATS = Object.freeze([
  ["registrations", "select count(*)::text as row_count, max(make_date(year, month, 1))::text as latest_period, max(scraped_at)::text as latest_observed_at from registrations"],
  ["maker_registrations", "select count(*)::text as row_count, max(make_date(year, month, 1))::text as latest_period, max(scraped_at)::text as latest_observed_at from maker_registrations"],
  ["rto_daily_collection_runs", "select count(*)::text as row_count, max(snapshot_date)::text as latest_snapshot_date, max(completed_at)::text as latest_completed_at from rto_daily_collection_runs"],
  ["rto_daily_jobs", "select count(*)::text as row_count, max(snapshot_date)::text as latest_snapshot_date from rto_daily_jobs"],
  ["rto_daily_scrape_reports", "select count(*)::text as row_count, max(snapshot_date)::text as latest_snapshot_date, max(scraped_at)::text as latest_observed_at from rto_daily_scrape_reports"],
  ["rto_daily_report_totals", "select count(*)::text as row_count, max(snapshot_date)::text as latest_snapshot_date, max(scraped_at)::text as latest_observed_at from rto_daily_report_totals"],
  ["rto_daily_oem_totals", "select count(*)::text as row_count, max(snapshot_date)::text as latest_snapshot_date, max(scraped_at)::text as latest_observed_at from rto_daily_oem_totals"],
  ["rto_reports", "select count(*)::text as row_count, max(generated_at)::text as latest_generated_at from rto_reports"],
  ["rto_factor_sources", "select count(*)::text as row_count, max(created_at)::text as latest_created_at from rto_factor_sources"],
  ["rto_factor_validations", "select count(*)::text as row_count, max(created_at)::text as latest_created_at from rto_factor_validations"],
]);

const CORE_DATA_TABLES = Object.freeze(["registrations", "maker_registrations"]);

export async function runReadonlyRuntime({ repoRoot, runDirectory, redactor, connectionString = process.env.DATABASE_URL }) {
  const startedAt = new Date();
  const startedNs = process.hrtime.bigint();
  if (!connectionString) return runtimeResult({ startedAt, startedNs, status: "skipped", reason: "DATABASE_URL is not configured; runtime state was not verified." });

  let Client;
  try {
    ({ Client } = (await import("pg")).default);
  } catch {
    return runtimeResult({ startedAt, startedNs, status: "skipped", reason: "The pg dependency is unavailable; runtime state was not verified." });
  }

  const target = describeTarget(connectionString);
  let client = null;
  let began = false;
  let payload = null;
  let status = "failed";
  let reason = null;
  try {
    client = new Client({
      connectionString: connectionStringForPg(connectionString),
      ssl: shouldUseSsl(connectionString) ? true : undefined,
      connectionTimeoutMillis: 10_000,
      application_name: "vahan-ey-readonly-audit",
    });
    await client.connect();
    await client.query("BEGIN READ ONLY");
    began = true;
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '20s'");
    const readOnly = await client.query("SHOW transaction_read_only");
    if (readOnly.rows[0]?.transaction_read_only !== "on") {
      throw new ReadOnlyGuaranteeError("Database did not confirm transaction_read_only=on; no inventory SELECTs were executed.");
    }

    const identity = await client.query("select current_database() as database_name, current_user as database_user, current_setting('server_version') as server_version");
    const tableResult = await client.query(
      "select tablename from pg_catalog.pg_tables where schemaname = 'public' and tablename = any($1::text[]) order by tablename",
      [REQUIRED_TABLES],
    );
    const presentTables = new Set(tableResult.rows.map((row) => row.tablename));
    const stats = {};
    for (const [table, sql] of SAFE_STATS) {
      if (!presentTables.has(table)) continue;
      stats[table] = (await client.query(sql)).rows[0] ?? {};
    }
    if (presentTables.has("rto_daily_jobs")) {
      stats.rto_daily_jobs.by_status = (await client.query(
        "select status, count(*)::text as job_count from rto_daily_jobs group by status order by status",
      )).rows;
    }

    const missingTables = REQUIRED_TABLES.filter((table) => !presentTables.has(table));
    const missingCoreData = CORE_DATA_TABLES.filter((table) => !hasPositiveRowCount(stats[table]?.row_count));

    payload = {
      transactionReadOnly: true,
      target,
      identity: {
        databaseFingerprint: fingerprint(identity.rows[0]?.database_name),
        userFingerprint: fingerprint(identity.rows[0]?.database_user),
        serverVersion: identity.rows[0]?.server_version ?? null,
      },
      schema: {
        requiredTableCount: REQUIRED_TABLES.length,
        presentTableCount: presentTables.size,
        missingTables,
      },
      dataSanity: {
        coreTables: CORE_DATA_TABLES,
        missingOrEmptyCoreTables: missingCoreData,
      },
      stats,
      configurationPresence: configurationPresence(),
      verifiedAt: new Date().toISOString(),
    };
    if (missingTables.length || missingCoreData.length) {
      status = "failed";
      reason = "Required runtime schema or core dashboard data is missing.";
    } else {
      status = "passed";
    }
  } catch (error) {
    if (error instanceof ReadOnlyGuaranteeError) {
      reason = error.message;
    } else {
      status = began ? "failed" : "skipped";
      reason = began
        ? "Read-only runtime verification failed after the transaction began; the transaction was rolled back."
        : "Read-only runtime access was unavailable; inspect the sanitized runtime log for the error class.";
      payload = { target, error: safeDatabaseError(error) };
    }
  } finally {
    if (began) await client?.query("ROLLBACK").catch(() => {});
    await client?.end().catch(() => {});
  }

  const log = "logs/runtime-readonly.json";
  await writeJsonExclusive(runDirectory, log, { status, reason, payload }, redactor);
  return runtimeResult({ startedAt, startedNs, status, reason, log, payload: status === "passed" ? payload : undefined });
}

function runtimeResult({ startedAt, startedNs, status, reason = null, log = null, payload }) {
  return {
    id: "runtime-readonly",
    domain: "runtime_readonly",
    command: "BEGIN READ ONLY; fixed allowlisted SELECT inventory; ROLLBACK",
    deterministic: false,
    gate: false,
    status,
    exitCode: null,
    signal: null,
    startedAt: startedAt.toISOString(),
    durationMs: Math.round(Number(process.hrtime.bigint() - startedNs) / 1_000_000),
    environmentMode: "optional_database_begin_read_only",
    stdoutLog: log,
    stderrLog: null,
    stdoutTruncated: false,
    stderrTruncated: false,
    reason,
    summary: payload ? { schema: payload.schema, target: payload.target } : null,
  };
}

function shouldUseSsl(connectionString) {
  if (process.env.PGSSL === "false") return false;
  try {
    const url = new URL(connectionString);
    if (url.searchParams.get("sslmode") === "disable") return false;
    return !["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
  } catch {
    return true;
  }
}

function connectionStringForPg(connectionString) {
  if (!shouldUseSsl(connectionString)) return connectionString;
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return connectionString;
  }
}

function describeTarget(connectionString) {
  try {
    const url = new URL(connectionString);
    const hostname = url.hostname.toLowerCase();
    return {
      kind: ["localhost", "127.0.0.1", "::1"].includes(hostname) ? "local" : "remote",
      hostFingerprint: fingerprint(hostname),
      databaseFingerprint: fingerprint(url.pathname.replace(/^\//, "")),
      ssl: shouldUseSsl(connectionString),
    };
  } catch {
    return { kind: "unparsed", hostFingerprint: null, databaseFingerprint: null, ssl: shouldUseSsl(connectionString) };
  }
}

function configurationPresence() {
  return {
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    databaseRequiredForReadiness: process.env.REQUIRE_DATABASE_FOR_READINESS === "1",
    appBaseUrlConfigured: Boolean(process.env.APP_BASE_URL),
    csrfSecretConfigured: Boolean(process.env.CSRF_SECRET),
    googleOAuthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    rateLimitStore: process.env.RATE_LIMIT_STORE || "default",
    trustProxyConfigured: Boolean(process.env.TRUST_PROXY_HOPS),
    liveVahanRefreshDisabled: process.env.VAHAN_DISABLE_LIVE_REFRESH === "1",
  };
}

function hasPositiveRowCount(value) {
  try {
    return BigInt(String(value)) > 0n;
  } catch {
    return false;
  }
}

function safeDatabaseError(error) {
  return {
    class: safeErrorToken(error?.name) || "Error",
    code: safeErrorToken(error?.code),
  };
}

function safeErrorToken(value) {
  const token = String(value ?? "");
  return /^[a-z0-9_.-]{1,64}$/i.test(token) ? token : null;
}

function fingerprint(value) {
  return value ? crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16) : null;
}

class ReadOnlyGuaranteeError extends Error {}
