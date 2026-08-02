import { query } from "./db.mjs";

const DEFAULT_TIMEZONE = process.env.TRACKED_QUERY_DEFAULT_TIMEZONE || "Asia/Calcutta";
const DEFAULT_RUN_TIME = process.env.TRACKED_QUERY_DEFAULT_RUN_TIME || "08:00";
const RUN_TIME_LOCAL_SQL = "substring(cast(run_time_local as text), 1, 5)";

export function localDateKey(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function localTimeKey(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("hour")}:${part("minute")}`;
}

export async function listTrackedQueries({ includeInactive = true, userId = null } = {}) {
  const values = [];
  const clauses = [];
  if (!includeInactive) clauses.push("active = true");
  if (userId !== null && userId !== undefined) {
    values.push(userId);
    clauses.push(`user_id = $${values.length}`);
  }
  const result = await query(
    `
      select
        id,
        user_id,
        label,
        query,
        active,
        ${RUN_TIME_LOCAL_SQL} as run_time_local,
        timezone,
        created_at,
        updated_at
      from tracked_queries
      ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
      order by active desc, id asc
    `,
    values,
  );
  return result.rows.map(normalizeTrackedQuery);
}

export async function getTrackedQuery(id, { userId = null } = {}) {
  const values = [id];
  let userClause = "";
  if (userId !== null && userId !== undefined) {
    values.push(userId);
    userClause = ` and user_id = $${values.length}`;
  }
  const result = await query(
    `
      select
        id,
        user_id,
        label,
        query,
        active,
        ${RUN_TIME_LOCAL_SQL} as run_time_local,
        timezone,
        created_at,
        updated_at
      from tracked_queries
      where id = $1${userClause}
    `,
    values,
  );
  return result.rows[0] ? normalizeTrackedQuery(result.rows[0]) : null;
}

export async function createTrackedQuery(input, { userId = null } = {}) {
  const payload = normalizeTrackedQueryInput(input, { partial: false });
  const result = await query(
    `
      insert into tracked_queries (user_id, label, query, active, run_time_local, timezone)
      values ($1, $2, $3, $4, $5::time, $6)
      returning id, user_id, label, query, active, ${RUN_TIME_LOCAL_SQL} as run_time_local, timezone, created_at, updated_at
    `,
    [
      userId,
      payload.label,
      payload.query,
      payload.active,
      payload.runTimeLocal,
      payload.timezone,
    ],
  );
  return normalizeTrackedQuery(result.rows[0]);
}

export async function updateTrackedQuery(id, input, { userId = null } = {}) {
  const payload = normalizeTrackedQueryInput(input, { partial: true });
  const fields = [];
  const values = [];
  const add = (column, value, suffix = "") => {
    values.push(value);
    fields.push(`${column} = $${values.length}${suffix}`);
  };

  if ("label" in payload) add("label", payload.label);
  if ("query" in payload) add("query", payload.query);
  if ("active" in payload) add("active", payload.active);
  if ("runTimeLocal" in payload) add("run_time_local", payload.runTimeLocal, "::time");
  if ("timezone" in payload) add("timezone", payload.timezone);
  if (!fields.length) return getTrackedQuery(id, { userId });

  values.push(id);
  const idParam = values.length;
  let userClause = "";
  if (userId !== null && userId !== undefined) {
    values.push(userId);
    userClause = ` and user_id = $${values.length}`;
  }
  const result = await query(
    `
      update tracked_queries
      set ${fields.join(", ")}, updated_at = now()
      where id = $${idParam}${userClause}
      returning id, user_id, label, query, active, ${RUN_TIME_LOCAL_SQL} as run_time_local, timezone, created_at, updated_at
    `,
    values,
  );
  return result.rows[0] ? normalizeTrackedQuery(result.rows[0]) : null;
}

export async function disableTrackedQuery(id, { userId = null } = {}) {
  return updateTrackedQuery(id, { active: false }, { userId });
}

export async function deleteTrackedQuery(id, { userId = null } = {}) {
  const existing = await getTrackedQuery(id, { userId });
  if (!existing) return null;
  const values = [id];
  let userClause = "";
  if (userId !== null && userId !== undefined) {
    values.push(userId);
    userClause = ` and user_id = $${values.length}`;
  }
  await query(
    `
      delete from tracked_queries
      where id = $1${userClause}
    `,
    values,
  );
  return existing;
}

export async function listTrackedQueryObservations(id, { from = null, to = null, limit = 120 } = {}) {
  const values = [id];
  const clauses = ["tracked_query_id = $1"];
  if (from) {
    values.push(from);
    clauses.push(`observation_date >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    clauses.push(`observation_date <= $${values.length}::date`);
  }
  values.push(Math.max(1, Math.min(Number(limit) || 120, 1000)));
  const result = await query(
    `
      select
        id,
        tracked_query_id,
        observation_date,
        total,
        daily_delta,
        weekly_delta,
        filters,
        summary,
        data_status,
        warnings,
        freshness,
        created_at,
        updated_at
      from tracked_query_observations
      where ${clauses.join(" and ")}
      order by observation_date desc
      limit $${values.length}
    `,
    values,
  );
  return result.rows.map(normalizeObservation);
}

export async function listTrackedQueryRuns(id, { from = null, to = null, limit = 120 } = {}) {
  const values = [id];
  const clauses = ["tracked_query_id = $1"];
  if (from) {
    values.push(from);
    clauses.push(`observation_date >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    clauses.push(`observation_date <= $${values.length}::date`);
  }
  values.push(Math.max(1, Math.min(Number(limit) || 120, 1000)));
  const result = await query(
    `
      select
        id,
        tracked_query_id,
        observation_date,
        status,
        started_at,
        completed_at,
        error,
        metadata
      from tracked_query_runs
      where ${clauses.join(" and ")}
      order by observation_date desc, started_at desc
      limit $${values.length}
    `,
    values,
  );
  return result.rows.map(normalizeRun);
}

export async function listDueTrackedQueries({
  date = null,
  now = new Date(),
  includeAlreadyObserved = false,
  backfillDays = 0,
} = {}) {
  const active = await listTrackedQueries({ includeInactive: false });
  const due = [];
  const normalizedBackfillDays = Math.max(0, Math.floor(Number(backfillDays) || 0));

  for (const item of active) {
    const currentTime = localTimeKey(now, item.timezone);
    const currentDate = localDateKey(now, item.timezone);
    const observationDates = date
      ? [date]
      : dateRange(addDays(currentDate, -normalizedBackfillDays), currentDate);

    for (const observationDate of observationDates) {
      if (!date && observationDate === currentDate && item.runTimeLocal > currentTime) continue;
      if (!includeAlreadyObserved && await hasObservation(item.id, observationDate)) continue;
      due.push({ ...item, observationDate });
    }
  }
  return due;
}

export async function failStaleRunningTrackedQueryRuns({
  before = new Date(Date.now() - 60 * 60 * 1000),
  error = "Tracked query run was left running past the stale-run timeout.",
} = {}) {
  const result = await query(
    `
      update tracked_query_runs
      set status = 'failed',
          completed_at = now(),
          error = $2,
          metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb
      where status = 'running'
        and started_at < $1
      returning id, tracked_query_id, observation_date, started_at
    `,
    [
      before,
      error,
      JSON.stringify({
        autoFailed: true,
        staleRunCutoff: before instanceof Date ? before.toISOString() : String(before),
      }),
    ],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    trackedQueryId: Number(row.tracked_query_id),
    observationDate: dateOnly(row.observation_date),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
  }));
}

export async function createTrackedQueryRun(trackedQueryId, observationDate, metadata = {}) {
  const result = await query(
    `
      insert into tracked_query_runs (tracked_query_id, observation_date, status, metadata)
      values ($1, $2::date, 'running', $3::jsonb)
      returning id, tracked_query_id, observation_date, status, started_at, completed_at, error, metadata
    `,
    [trackedQueryId, observationDate, JSON.stringify(metadata ?? {})],
  );
  return normalizeRun(result.rows[0]);
}

export async function completeTrackedQueryRun(id, metadata = {}) {
  const result = await query(
    `
      update tracked_query_runs
      set status = 'success', completed_at = now(), error = null, metadata = $2::jsonb
      where id = $1
      returning id, tracked_query_id, observation_date, status, started_at, completed_at, error, metadata
    `,
    [id, JSON.stringify(metadata ?? {})],
  );
  return result.rows[0] ? normalizeRun(result.rows[0]) : null;
}

export async function failTrackedQueryRun(id, error, metadata = {}) {
  const result = await query(
    `
      update tracked_query_runs
      set status = 'failed', completed_at = now(), error = $2, metadata = $3::jsonb
      where id = $1
      returning id, tracked_query_id, observation_date, status, started_at, completed_at, error, metadata
    `,
    [id, String(error?.message ?? error ?? "Tracked query failed"), JSON.stringify(metadata ?? {})],
  );
  return result.rows[0] ? normalizeRun(result.rows[0]) : null;
}

export async function upsertTrackedQueryObservation(trackedQueryId, observationDate, payload) {
  const total = Number(payload.total);
  if (!Number.isFinite(total) || total < 0) {
    throw new Error("Tracked query observation total must be a non-negative number.");
  }

  const dailyBaseline = await observationTotalForDate(trackedQueryId, addDays(observationDate, -1));
  const weeklyBaseline = await observationTotalForDate(trackedQueryId, addDays(observationDate, -7));
  const dailyDelta = dailyBaseline === null ? null : Math.round(total) - dailyBaseline;
  const weeklyDelta = weeklyBaseline === null ? null : Math.round(total) - weeklyBaseline;

  const result = await query(
    `
      insert into tracked_query_observations (
        tracked_query_id,
        observation_date,
        total,
        daily_delta,
        weekly_delta,
        filters,
        summary,
        data_status,
        warnings,
        freshness
      )
      values ($1, $2::date, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10::jsonb)
      on conflict (tracked_query_id, observation_date)
      do update set
        total = excluded.total,
        daily_delta = excluded.daily_delta,
        weekly_delta = excluded.weekly_delta,
        filters = excluded.filters,
        summary = excluded.summary,
        data_status = excluded.data_status,
        warnings = excluded.warnings,
        freshness = excluded.freshness,
        updated_at = now()
      returning
        id,
        tracked_query_id,
        observation_date,
        total,
        daily_delta,
        weekly_delta,
        filters,
        summary,
        data_status,
        warnings,
        freshness,
        created_at,
        updated_at
    `,
    [
      trackedQueryId,
      observationDate,
      Math.round(total),
      dailyDelta,
      weeklyDelta,
      JSON.stringify(payload.filters ?? {}),
      JSON.stringify(payload.summary ?? {}),
      payload.dataStatus ?? null,
      JSON.stringify(payload.warnings ?? []),
      JSON.stringify(payload.freshness ?? {}),
    ],
  );
  return normalizeObservation(result.rows[0]);
}

async function hasObservation(trackedQueryId, observationDate) {
  const result = await query(
    `
      select 1
      from tracked_query_observations
      where tracked_query_id = $1 and observation_date = $2::date
      limit 1
    `,
    [trackedQueryId, observationDate],
  );
  return result.rowCount > 0;
}

async function observationTotalForDate(trackedQueryId, observationDate) {
  const result = await query(
    `
      select total
      from tracked_query_observations
      where tracked_query_id = $1 and observation_date = $2::date
    `,
    [trackedQueryId, observationDate],
  );
  return result.rows[0] ? Number(result.rows[0].total) : null;
}

function normalizeTrackedQueryInput(input = {}, { partial }) {
  const output = {};
  if (!partial || "label" in input) {
    output.label = input.label === null || input.label === undefined ? null : String(input.label).trim() || null;
    if (output.label && output.label.length > 120) throw inputError("Tracked query label must be 120 characters or fewer.");
  }
  if (!partial || "query" in input) {
    const text = String(input.query ?? "").trim();
    if (!text) throw inputError("Tracked query text is required.");
    if (text.length > 1_000) throw inputError("Tracked query text must be 1000 characters or fewer.");
    output.query = text;
  }
  if (!partial || "active" in input) {
    output.active = "active" in input ? Boolean(input.active) : true;
  }
  if (!partial || "runTimeLocal" in input || "run_time_local" in input) {
    const value = String(input.runTimeLocal ?? input.run_time_local ?? DEFAULT_RUN_TIME).trim();
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw inputError("runTimeLocal must use a valid 24-hour HH:MM time.");
    output.runTimeLocal = value;
  }
  if (!partial || "timezone" in input) {
    output.timezone = String(input.timezone ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
    if (output.timezone.length > 100) throw inputError("Timezone must be 100 characters or fewer.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: output.timezone }).format();
    } catch {
      throw inputError("Timezone must be a valid IANA timezone.");
    }
  }
  return output;
}

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeTrackedQuery(row) {
  return {
    id: Number(row.id),
    userId: row.user_id === null || row.user_id === undefined ? null : Number(row.user_id),
    label: row.label,
    query: row.query,
    active: Boolean(row.active),
    runTimeLocal: String(row.run_time_local ?? DEFAULT_RUN_TIME).slice(0, 5),
    timezone: row.timezone,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function normalizeRun(row) {
  return {
    id: Number(row.id),
    trackedQueryId: Number(row.tracked_query_id),
    observationDate: dateOnly(row.observation_date),
    status: row.status,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    error: row.error,
    metadata: row.metadata ?? {},
  };
}

function normalizeObservation(row) {
  return {
    id: Number(row.id),
    trackedQueryId: Number(row.tracked_query_id),
    observationDate: dateOnly(row.observation_date),
    total: Number(row.total),
    dailyDelta: row.daily_delta === null ? null : Number(row.daily_delta),
    weeklyDelta: row.weekly_delta === null ? null : Number(row.weekly_delta),
    filters: row.filters ?? {},
    summary: row.summary ?? {},
    dataStatus: row.data_status,
    warnings: row.warnings ?? [],
    freshness: row.freshness ?? {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function addDays(dateKey, days) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function dateRange(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
