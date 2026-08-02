import { getPool, query } from "./db.mjs";
import { runRtoFactorAgent } from "./rto-factor-agent.mjs";

const LOCK_NAME = "vahan-ey-rto-factor-daily";
const MAX_VALIDATIONS = 500;

/**
 * Lists only work that has not yet been persisted for the latest report revision.
 * Source/event creation and public explanation approval are deliberately outside
 * this automation: both need a human reviewer.
 */
export async function listPendingRtoFactorValidations({
  limit = 200,
  queryImpl = query,
} = {}) {
  const boundedLimit = boundedInteger(limit, 1, MAX_VALIDATIONS, 200);
  const result = await queryImpl(
    `
      with latest_daily_reports as (
        select distinct on (r.state, r.rto)
               r.id as report_id,
               r.state,
               r.rto,
               r.status as report_status,
               b.id as batch_id,
               b.status as batch_status,
               b.revision as report_revision,
               b.source_checksum as report_source_checksum,
               b.source_snapshot_date
        from rto_reports r
        join rto_report_batches b on b.id = r.batch_id
        where b.cadence = 'daily'
          and b.source_run_id is not null
          and b.source_checksum ~ '^[0-9a-f]{64}$'
          and b.status in ('ready', 'ready_with_warnings', 'needs_review')
          and r.status in ('ready', 'ready_with_warnings', 'needs_review')
        order by r.state, r.rto, b.source_snapshot_date desc, b.revision desc, r.id desc
      ),
      eligible_pairs as (
        select distinct on (e.id, report.report_id)
               e.id as event_id,
               e.title as event_title,
               e.effective_start,
               report.report_id,
               report.state,
               report.rto,
               report.report_status,
               report.batch_id,
               report.batch_status,
               report.report_revision,
               report.report_source_checksum,
               report.source_snapshot_date
        from rto_factor_events e
        join rto_factor_event_targets t
          on t.event_id = e.id
         and t.target_role = 'affected'
        join latest_daily_reports report
          on (
            (t.geography_scope = 'rto' and t.state = report.state and t.rto = report.rto)
            or (t.geography_scope = 'state' and t.state = report.state)
          )
        where e.review_status = 'eligible'
          and t.geography_scope in ('rto', 'state')
          and t.oem is null
          and (t.fuel_group in ('EV', 'ICE') or t.vehicle_category in ('2W', '3W', '4W'))
          and e.effective_start <= report.source_snapshot_date
        order by e.id,
                 report.report_id,
                 case t.geography_scope when 'rto' then 2 else 1 end desc,
                 case when t.vehicle_category in ('2W', '3W', '4W') then 1 else 0 end desc,
                 case when t.fuel_group in ('EV', 'ICE') then 1 else 0 end desc
      )
      select pair.*
      from eligible_pairs pair
      where not exists (
        select 1
        from rto_factor_validations validation
        where validation.event_id = pair.event_id
          and validation.report_id = pair.report_id
          and validation.report_revision = pair.report_revision
          and validation.report_source_checksum = pair.report_source_checksum
      )
      order by pair.source_snapshot_date asc, pair.event_id asc, pair.report_id asc
      limit $1
    `,
    [boundedLimit],
  );
  return result.rows.map(normalizeCandidate);
}

export async function runPendingRtoFactorValidations({
  asOfDate = null,
  write = false,
  providerName = "none",
  env = process.env,
  limit = 200,
  dependencies = {},
} = {}) {
  const listCandidates = dependencies.listCandidates ?? listPendingRtoFactorValidations;
  const runAgent = dependencies.runAgent ?? runRtoFactorAgent;
  const candidates = await listCandidates({ limit });
  const validations = [];

  for (const candidate of candidates) {
    const candidateAsOfDate = boundedAsOfDate(asOfDate, candidate.sourceSnapshotDate);
    try {
      const result = await runAgent({
        eventId: candidate.eventId,
        reportId: candidate.reportId,
        write,
        asOfDate: candidateAsOfDate,
        providerName,
        env,
        createdByLabel: "rto-factor-daily-automation",
      });
      validations.push({
        ...candidate,
        asOfDate: candidateAsOfDate,
        outcome: "validated",
        status: result.validation?.status ?? "unknown",
        reasonCodes: result.validation?.reasonCodes ?? [],
        persistedValidationId: result.persistedValidation?.id ?? null,
        persistedExplanationId: result.persistedExplanation?.id ?? null,
        publicationStatus: result.persistedExplanation
          ? "draft_pending_human_review"
          : "not_published",
      });
    } catch (error) {
      validations.push({
        ...candidate,
        asOfDate: candidateAsOfDate,
        outcome: "error",
        status: "error",
        reasonCodes: [],
        persistedValidationId: null,
        persistedExplanationId: null,
        publicationStatus: "not_published",
        error: safeErrorMessage(error),
      });
    }
  }

  return {
    mode: write ? "write_drafts_only" : "dry_run",
    candidateCount: candidates.length,
    validationCount: validations.filter((item) => item.outcome === "validated").length,
    errorCount: validations.filter((item) => item.outcome === "error").length,
    statusCounts: countBy(validations, (item) => item.status),
    validations,
  };
}

export function assertDailyAutomationWriteEnabled(env = process.env) {
  if (String(env.FACTOR_DAILY_AUTOMATION_ENABLED ?? "0").trim() !== "1") {
    throw new Error("Daily writes require FACTOR_DAILY_AUTOMATION_ENABLED=1.");
  }
  if (String(env.FACTOR_AGENT_ENABLED ?? "0").trim() !== "1") {
    throw new Error("Daily writes require FACTOR_AGENT_ENABLED=1.");
  }
  if (String(env.FACTOR_AGENT_MODE ?? "draft_only").trim().toLowerCase() !== "draft_only") {
    throw new Error("Daily writes require FACTOR_AGENT_MODE=draft_only.");
  }
}

export async function acquireRtoFactorDailyLock(owner = "rto-factor-daily", {
  waitMs = 0,
  retryMs = 5_000,
  getPoolImpl = getPool,
} = {}) {
  const boundedWaitMs = Math.max(0, Number(waitMs) || 0);
  const boundedRetryMs = Math.max(250, Number(retryMs) || 5_000);
  const deadline = Date.now() + boundedWaitMs;
  const client = await getPoolImpl().connect();
  let releasedClient = false;
  try {
    while (true) {
      const result = await client.query(
        "select pg_try_advisory_lock(hashtext($1)) as acquired",
        [LOCK_NAME],
      );
      if (result.rows[0]?.acquired) break;
      if (Date.now() >= deadline) {
        client.release();
        releasedClient = true;
        throw new Error(`Another RTO factor daily automation is already running; ${owner} did not start.`);
      }
      await sleep(Math.min(boundedRetryMs, Math.max(1, deadline - Date.now())));
    }
  } catch (error) {
    if (!releasedClient) client.release();
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await client.query("select pg_advisory_unlock(hashtext($1))", [LOCK_NAME]).catch(() => {});
    client.release();
  };
}

function normalizeCandidate(row = {}) {
  return {
    eventId: Number(row.event_id),
    eventTitle: String(row.event_title ?? ""),
    effectiveStart: dateOnlyOrNull(row.effective_start),
    reportId: Number(row.report_id),
    state: String(row.state ?? ""),
    rto: String(row.rto ?? ""),
    reportStatus: String(row.report_status ?? ""),
    batchId: Number(row.batch_id),
    batchStatus: String(row.batch_status ?? ""),
    reportRevision: Number(row.report_revision),
    reportSourceChecksum: String(row.report_source_checksum ?? ""),
    sourceSnapshotDate: dateOnlyOrNull(row.source_snapshot_date),
  };
}

function boundedAsOfDate(requested, sourceSnapshotDate) {
  const sourceDate = dateOnlyOrNull(sourceSnapshotDate);
  const requestedDate = requested ? dateOnlyOrNull(requested) : null;
  if (!sourceDate) return requestedDate;
  if (!requestedDate || requestedDate > sourceDate) return sourceDate;
  return requestedDate;
}

function dateOnlyOrNull(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function countBy(items, keyFor) {
  return items.reduce((counts, item) => {
    const key = String(keyFor(item));
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function safeErrorMessage(error) {
  return String(error?.message ?? error ?? "Unknown error").slice(0, 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
