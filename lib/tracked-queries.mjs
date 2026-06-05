import { query } from "./db.mjs";

const DEFAULT_TIMEZONE = process.env.TRACKED_QUERY_DEFAULT_TIMEZONE || "Asia/Calcutta";
const DEFAULT_RUN_TIME = process.env.TRACKED_QUERY_DEFAULT_RUN_TIME || "08:00";

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

export async function listTrackedQueries({ includeInactive = true } = {}) {
  const result = await query(
    `
      select
        id,
        label,
        query,
        active,
        to_char(run_time_local, 'HH24:MI') as run_time_local,
        timezone,
        created_at,
        updated_at
      from tracked_queries
      ${includeInactive ? "" : "where active = true"}
      order by active desc, id asc
    `,
  );
  return result.rows.map(normalizeTrackedQuery);
}

export async function getTrackedQuery(id) {
  const result = await query(
    `
      select
        id,
        label,
        query,
        active,
        to_char(run_time_local, 'HH24:MI') as run_time_local,
        timezone,
        created_at,
        updated_at
      from tracked_queries
      where id = $1
    `,
    [id],
  );
  return result.rows[0] ? normalizeTrackedQuery(result.rows[0]) : null;
}

export async function createTrackedQuery(input) {
  const payload = normalizeTrackedQueryInput(input, { partial: false });
  const result = await query(
    `
      insert into tracked_queries (label, query, active, run_time_local, timezone)
      values ($1, $2, $3, $4::time, $5)
      returning id, label, query, active, to_char(run_time_local, 'HH24:MI') as run_time_local, timezone, created_at, updated_at
    `,
    [
      payload.label,
      payload.query,
      payload.active,
      payload.runTimeLocal,
      payload.timezone,
    ],
  );
  return normalizeTrackedQuery(result.rows[0]);
}

export async function updateTrackedQuery(id, input) {
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
  if (!fields.length) return getTrackedQuery(id);

  values.push(id);
  const result = await query(
    `
      update tracked_queries
      set ${fields.join(", ")}, updated_at = now()
      where id = $${values.length}
      returning id, label, query, active, to_char(run_time_local, 'HH24:MI') as run_time_local, timezone, created_at, updated_at
    `,
    values,
  );
  return result.rows[0] ? normalizeTrackedQuery(result.rows[0]) : null;
}

export async function disableTrackedQuery(id) {
  return updateTrackedQuery(id, { active: false });
}

export async function deleteTrackedQuery(id) {
  const existing = await getTrackedQuery(id);
  if (!existing) return null;
  await query(
    `
      delete from tracked_queries
      where id = $1
    `,
    [id],
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

export async function listDueTrackedQueries({ date = null, now = new Date(), includeAlreadyObserved = false } = {}) {
  const active = await listTrackedQueries({ includeInactive: false });
  const due = [];
  for (const item of active) {
    const observationDate = date || localDateKey(now, item.timezone);
    const currentTime = localTimeKey(now, item.timezone);
    if (item.runTimeLocal > currentTime) continue;
    if (!includeAlreadyObserved && await hasObservation(item.id, observationDate)) continue;
    due.push({ ...item, observationDate });
  }
  return due;
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
  }
  if (!partial || "query" in input) {
    const text = String(input.query ?? "").trim();
    if (!text) throw new Error("Tracked query text is required.");
    output.query = text;
  }
  if (!partial || "active" in input) {
    output.active = "active" in input ? Boolean(input.active) : true;
  }
  if (!partial || "runTimeLocal" in input || "run_time_local" in input) {
    const value = String(input.runTimeLocal ?? input.run_time_local ?? DEFAULT_RUN_TIME).trim();
    if (!/^\d{2}:\d{2}$/.test(value)) throw new Error("runTimeLocal must use HH:MM format.");
    output.runTimeLocal = value;
  }
  if (!partial || "timezone" in input) {
    output.timezone = String(input.timezone ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  }
  return output;
}

function normalizeTrackedQuery(row) {
  return {
    id: Number(row.id),
    label: row.label,
    query: row.query,
    active: Boolean(row.active),
    runTimeLocal: row.run_time_local,
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

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
